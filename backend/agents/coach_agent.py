"""
Coach Agent.

Takes the user's formation, the opponent's committed counter-strategy,
and the roster data, then produces plain-language coaching feedback
that names specific players and their traits - this is what makes the
advice feel like real coaching instead of generic tactics platitudes.
"""

from typing import Literal

from pydantic import BaseModel, Field
from strands import Agent, tool

from agents.model_config import build_model, tool_call_names
from tools import player_data

SYSTEM_PROMPT = """
You are a football tactics coach speaking directly to an amateur coach
or young player. Explain tactical decisions in plain, encouraging
language - never jargon-only. Always reference specific players by
name and their concrete strengths/weaknesses from the data tools, never
generic statements like "your defense is weak." Structure feedback as:
(1) what the opponent is about to exploit and why, (2) one concrete
adjustment the user could make. Keep it to 3-4 sentences.
"""


@tool
def get_player_traits(team_id: str, player_id: str) -> dict:
    """Look up a specific player's stat block and strength/weakness tags."""
    return player_data.get_player(team_id, player_id)


@tool
def explain_trait(trait: str) -> str:
    """Return the plain-language definition of a trait tag."""
    return player_data.trait_definition(trait) or "unknown trait"


class CoachVerdict(BaseModel):
    verdict: Literal["SOLVED", "PARTIAL", "EXPOSED"] = Field(
        description="Grade of the user's adjustment against the drill's coaching goal."
    )
    feedback: str = Field(description="3-4 sentence explanation, must cite the cover metrics.")


def build_agent() -> Agent:
    return Agent(
        # Bumped from 350: graded mode also fills the CoachVerdict structured
        # output on top of the 3-4 sentence feedback - same truncation risk
        # the Opponent Manager hit at a lower budget.
        model=build_model(max_tokens=600, temperature=0.6),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_player_traits, explain_trait],
    )


def _derive_verdict(metrics: dict) -> str:
    if metrics.get("isolated"):
        return "EXPOSED"
    if metrics.get("helpers_within_15", 0) >= 2 and metrics.get("attacker_marked"):
        return "SOLVED"
    return "PARTIAL"


def heuristic_fallback(matchup: dict, metrics: dict | None = None) -> dict:
    """Fully offline degrade path used when Bedrock is unreachable."""
    if matchup:
        reasons = ", ".join(matchup.get("reasons", [])) or "a mismatch our scouts flagged"
        text = (
            f"{matchup['defender']} is exposed here - {reasons}. Tuck a "
            f"midfielder into that channel, or switch to a back five for cover."
        )
    else:
        text = "No obvious mismatch for them right now - your shape is holding. Well done."
    verdict = _derive_verdict(metrics) if metrics is not None else None
    return {"text": text, "tool_calls": [], "verdict": verdict}


def generate_feedback(
    user_team_id: str,
    opponent_strategy: dict,
    matchup: dict,
    drill: dict | None = None,
    metrics: dict | None = None,
) -> dict:
    """
    user_team_id: "blue"
    opponent_strategy: { "formation_code", "instruction", "narrative" } - the
        opponent agent's committed plan (see opponent_manager_agent.decide_counter_strategy)
    matchup: the target_matchup dict (attacker/defender names + ids + reasons)
    drill: optional { "scenario", "coaching_goal", "focus_matchup" } from a
        prior POST /drill call - when present (with metrics), feedback is
        graded against the drill's goal instead of just advised.
    metrics: optional deterministic cover metrics (board_metrics.threat_cover)
        for the drill's focus matchup - the verdict must be grounded in these.

    Returns: { "text": str, "verdict": "SOLVED"|"PARTIAL"|"EXPOSED"|None, "tool_calls": list[str] }
    """
    agent = build_agent()

    base_prompt = f"""
    The opponent has committed to this plan: {opponent_strategy.get('narrative')}
    Their instruction to the team: {opponent_strategy.get('instruction')}

    The specific matchup they're targeting: {matchup}
    """

    if drill and metrics is not None:
        prompt = base_prompt + f"""
        This is a training drill. Coaching goal: {drill.get('coaching_goal')}
        Live cover metrics on the targeted matchup, computed from actual
        pawn positions on the board: {metrics}

        Grade the user's adjustment against the goal. SOLVED = the threat is
        neutralized per the metrics; PARTIAL = improved but still exposed;
        EXPOSED = the mismatch still stands. Your verdict must be consistent
        with the metrics - never claim cover that isn't there. Explain the
        grade to the user coaching {user_team_id}, citing the metrics.
        """
        result = agent(
            prompt,
            structured_output_model=CoachVerdict,
            structured_output_prompt=(
                "Grade the verdict now. No analysis, headers, or commentary - "
                "fill in the fields directly."
            ),
        )
        graded = result.structured_output
        # Same convention as the other agents: drop the structured-output
        # pseudo-tool-call from the observability feed.
        tool_calls = [name for name in tool_call_names(result) if name != CoachVerdict.__name__]
        if graded is not None:
            return {"text": graded.feedback, "verdict": graded.verdict, "tool_calls": tool_calls}
        fallback = heuristic_fallback(matchup, metrics)
        fallback["text"] = str(result) or fallback["text"]
        fallback["tool_calls"] = tool_calls
        return fallback

    # No drill active (or no metrics yet) - today's ungraded advice.
    prompt = base_prompt + f"""
    Explain this to the user coaching {user_team_id}, and suggest one
    concrete adjustment (a formation tweak, a positional instruction,
    or a substitution) that would neutralize it.
    """
    result = agent(prompt)
    return {"text": str(result), "verdict": None, "tool_calls": tool_call_names(result)}
