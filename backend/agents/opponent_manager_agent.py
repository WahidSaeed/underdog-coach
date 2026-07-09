"""
Opponent Manager Agent.

Given the user's current formation and pawn positions, this agent plays
the role of the AI opponent's manager: it commits to a counter-shape and
a specific tactical instruction, grounded in the player_data tool rather
than freeform football trivia.

The deterministic scouting result (player_data.find_exploitable_matchup)
is computed first and handed to the agent as the scouting report its plan
must be built around, then returned unchanged as `target_matchup` - so the
agent's narrative and the data-backed matchup can never disagree, and the
UI always gets stable player ids to highlight.
"""

from pydantic import BaseModel, Field
from strands import Agent, tool

from agents.model_config import build_model, tool_call_names
from tools import player_data

VALID_FORMATIONS = {"442", "433", "352", "532"}
DEFAULT_FORMATION = "433"

SYSTEM_PROMPT = """
You are the opposing team's manager in a football tactics trainer.
You must commit to ONE counter-formation and ONE tactical instruction
in response to the user's team shape. You will be given a scouting
report identifying the best matchup to exploit - build your plan around
it. Always ground your reasoning in the specific player weaknesses
returned by the scouting tools - never invent a player attribute that
isn't in the data. Speak in the voice of a manager giving instructions
to their team, not a neutral analyst.

Do not write any analysis, headers, or commentary in your reply - use
the tools if needed, then go directly to committing your plan. Your
entire committed plan (the narrative field) must be 2-3 sentences.
"""


@tool
def scout_matchup(attacking_team: str, defending_team: str) -> dict:
    """Find the most exploitable attacker-vs-defender matchup on the pitch."""
    return player_data.find_exploitable_matchup(attacking_team, defending_team)


@tool
def get_roster(team_id: str) -> dict:
    """Fetch a team's full roster with stats and traits."""
    return player_data.get_team(team_id)


class OpponentPlan(BaseModel):
    formation_code: str = Field(
        description="The counter-formation you're committing to. Must be one of: 442, 433, 352, 532."
    )
    instruction: str = Field(description="One sentence tactical instruction, in your voice as manager.")
    narrative: str = Field(description="The full committed plan, 2-3 sentences, for the team feed.")


def build_agent() -> Agent:
    return Agent(
        # Higher than the coach agent's budget: this agent's turns include
        # tool calls plus filling the OpponentPlan structured output, and
        # got truncated mid-structured-output at 400 during testing.
        model=build_model(max_tokens=800, temperature=0.7),
        system_prompt=SYSTEM_PROMPT,
        tools=[scout_matchup, get_roster],
    )


def _formation_label(code: str) -> str:
    return "-".join(code)


def heuristic_fallback(user_formation: dict, target_matchup: dict) -> dict:
    """Fully offline degrade path used when Bedrock is unreachable or misbehaves."""
    label = _formation_label(DEFAULT_FORMATION)
    if target_matchup:
        narrative = (
            f"We're shifting to a {label}. {target_matchup['attacker']} will hunt "
            f"{target_matchup['defender']} - {', '.join(target_matchup['reasons'])}."
        )
        instruction = f"Get at {target_matchup['defender']} early and often."
    else:
        narrative = f"We're reshaping into a {label} to probe for gaps."
        instruction = "Press high and force mistakes."
    return {
        "formation_code": DEFAULT_FORMATION,
        "instruction": instruction,
        "narrative": narrative,
        "raw_response": narrative,
        "target_matchup": target_matchup,
        "tool_calls": [],
        "structured_ok": False,
    }


def decide_counter_strategy(
    user_formation: dict,
    user_team_id: str,
    opponent_team_id: str,
    drill: dict | None = None,
    metrics: dict | None = None,
) -> dict:
    """
    Orchestration entry point called by the backend API.

    user_formation: { "code": "4-3-3", "width_spread": 62, "avg_def_line": 71 }
    drill: optional { "scenario": str, "coaching_goal": str, "focus_matchup": dict }
        from a prior POST /drill call - when present, the Match Director's
        situation is the context the plan must be committed within.
    metrics: optional deterministic cover metrics (board_metrics.threat_cover)
        for the drill's focus matchup - real scouting facts, not vibes.
    Returns: { formation_code, instruction, narrative, raw_response,
               target_matchup, tool_calls, structured_ok }
    """
    target_matchup = player_data.find_exploitable_matchup(opponent_team_id, user_team_id)
    agent = build_agent()

    scouting_report = target_matchup if target_matchup else "No standout mismatch - use the scouting tool yourself."
    drill_context = (
        f"The match situation: {drill['scenario']} Coaching goal: {drill['coaching_goal']} "
        "Plan your counter within this situation.\n"
        if drill
        else ""
    )
    if metrics is not None:
        drill_context += (
            f"Live cover on the targeted matchup: {metrics}. "
            "Decide whether the original exploit still works, or commit to a different plan.\n"
        )
    prompt = f"""
    {drill_context}The user's team ({user_team_id}) is set up in a {user_formation['code']}
    with a width spread of {user_formation['width_spread']} and an average
    defensive line height of {user_formation['avg_def_line']}.

    Scouting report - build your committed plan around this matchup:
    {scouting_report}

    Use the roster tool to confirm any player details you reference, then
    commit to ONE counter-formation (must be one of 442, 433, 352, 532),
    ONE tactical instruction, and a short narrative explaining the plan.
    """

    result = agent(
        prompt,
        structured_output_model=OpponentPlan,
        structured_output_prompt=(
            "Commit to the plan now. No analysis, headers, or commentary - "
            "fill in the fields directly."
        ),
    )
    plan = result.structured_output
    # Strands records the structured-output fill itself as a "tool call"
    # (its name is the model's class name) - drop it so the observability
    # feed only shows real scouting actions, not the output-shaping step.
    tool_calls = [name for name in tool_call_names(result) if name != OpponentPlan.__name__]

    if plan is not None and plan.formation_code in VALID_FORMATIONS:
        return {
            "formation_code": plan.formation_code,
            "instruction": plan.instruction,
            "narrative": plan.narrative,
            "raw_response": str(result),
            "target_matchup": target_matchup,
            "tool_calls": tool_calls,
            "structured_ok": True,
        }

    # Structured output missing, or the model picked a formation the UI
    # can't render - keep the agent's prose but force a safe formation.
    fallback = heuristic_fallback(user_formation, target_matchup)
    fallback["narrative"] = str(result) or fallback["narrative"]
    fallback["raw_response"] = str(result)
    fallback["tool_calls"] = tool_calls
    return fallback
