"""
Coach Agent.

Takes the user's formation, the opponent's committed counter-strategy,
and the roster data, then produces plain-language coaching feedback
that names specific players and their traits - this is what makes the
advice feel like real coaching instead of generic tactics platitudes.
"""

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


def build_agent() -> Agent:
    return Agent(
        model=build_model(max_tokens=350, temperature=0.6),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_player_traits, explain_trait],
    )


def heuristic_fallback(matchup: dict) -> dict:
    """Fully offline degrade path used when Bedrock is unreachable."""
    if matchup:
        reasons = ", ".join(matchup.get("reasons", [])) or "a mismatch our scouts flagged"
        text = (
            f"{matchup['defender']} is exposed here - {reasons}. Tuck a "
            f"midfielder into that channel, or switch to a back five for cover."
        )
    else:
        text = "No obvious mismatch for them right now - your shape is holding. Well done."
    return {"text": text, "tool_calls": []}


def generate_feedback(user_team_id: str, opponent_strategy: dict, matchup: dict) -> dict:
    """
    user_team_id: "blue"
    opponent_strategy: { "formation_code", "instruction", "narrative" } - the
        opponent agent's committed plan (see opponent_manager_agent.decide_counter_strategy)
    matchup: the target_matchup dict (attacker/defender names + ids + reasons)

    Returns: { "text": str, "tool_calls": list[str] }
    """
    agent = build_agent()

    prompt = f"""
    The opponent has committed to this plan: {opponent_strategy.get('narrative')}
    Their instruction to the team: {opponent_strategy.get('instruction')}

    The specific matchup they're targeting: {matchup}

    Explain this to the user coaching {user_team_id}, and suggest one
    concrete adjustment (a formation tweak, a positional instruction,
    or a substitution) that would neutralize it.
    """

    result = agent(prompt)
    return {"text": str(result), "tool_calls": tool_call_names(result)}
