"""
Match Director Agent.

Orchestrates a training drill using the agents-as-tools pattern: it can
scout the pitch for a matchup, then delegates the actual scenario prose
to the Scenario agent (in-process, or once SCENARIO_AGENT_RUNTIME_ARN is
set, hosted on Bedrock AgentCore Runtime) as a second, nested tool. This
is the multi-agent orchestration story - a real agent-to-agent data
dependency, not just the backend chaining fixed calls.

Like the Opponent Manager, the matchup actually returned to the frontend
(`focus_matchup`) is computed deterministically before the agent runs and
handed to it as ground truth - so the UI's highlighted pawns can never
disagree with what the narrative claims, even though the agent also has
a tool to check this data itself.

Session memory (recurring_weakness) is read directly rather than exposed
as a tool call: an earlier version gave the Director a get_recent_rounds
tool, but that extra round-trip pushed measured latency to ~29s against
POST /drill sitting behind API Gateway's hard ~29s integration ceiling -
too close to risk. Injecting the memory check into the prompt keeps the
same "adaptive drill" story for one fewer LLM round-trip.
"""

from pydantic import BaseModel, Field
from strands import Agent, tool

from agents import scenario_client
from agents.model_config import build_model, tool_call_names
from agents.opponent_manager_agent import DEFAULT_FORMATION, VALID_FORMATIONS
from tools import player_data

DEFAULT_DIFFICULTY = "medium"

SYSTEM_PROMPT = """
You design one training drill per request for an amateur football coach.
You will be told whether this session has a recurring weakness on record;
if so, the drill MUST target it - say so directly in focus_note. If not,
build the drill around the scouting report you're given, or call the
scouting tool yourself if none was provided. Then delegate the scenario
writing to the scenario tool, passing the matchup you chose as the focus.
Ground everything in real player data; never invent an attribute that
isn't in the data.

The numeric fields (score, minute) and formation are the source of truth -
the scenario text must agree with them.

Do not write any analysis, headers, or commentary in your reply - use
the tools, then go directly to filling in the drill brief. coaching_goal
and focus_note must each be one sentence; scenario must be 2-3 sentences.
"""


class DrillBrief(BaseModel):
    scenario: str = Field(description="2-3 sentence live-game situation (score, time, momentum).")
    coaching_goal: str = Field(description="One sentence: what the user should try to achieve.")
    focus_note: str = Field(
        description="One sentence: why this drill, referencing the matchup or recurring mistake."
    )
    opponent_formation_code: str = Field(
        description="Opponent shape for this situation. One of: 442, 433, 352, 532."
    )
    user_goals: int = Field(description="User team's current goals in the scenario, 0-9.")
    opponent_goals: int = Field(description="Opponent's current goals, 0-9.")
    minute: int = Field(description="Match minute the scenario starts at, 1-90.")


def _build_tools(session, user_team_id: str, opponent_team_id: str, difficulty: str, remote_flag: dict):
    @tool
    def scout_matchup(attacking_team: str, defending_team: str) -> dict:
        """Find the most exploitable attacker-vs-defender matchup on the pitch."""
        return player_data.find_exploitable_matchup(attacking_team, defending_team)

    @tool
    def generate_scenario(focus: str) -> str:
        """Delegate to the Scenario agent: writes a live-game situation around `focus`."""
        rosters = {
            user_team_id: player_data.get_team(user_team_id),
            opponent_team_id: player_data.get_team(opponent_team_id),
        }
        text, used_remote = scenario_client.generate(
            focus=focus,
            difficulty=difficulty,
            team_a=opponent_team_id,
            team_b=user_team_id,
            rosters=rosters,
            session_id=session.session_id,
        )
        remote_flag["used_remote"] = used_remote
        return text

    return [scout_matchup, generate_scenario]


def build_agent(tools) -> Agent:
    return Agent(
        # DrillBrief is now three short sentences plus four small structured
        # fields - 450 gives that headroom without brushing the 29s ceiling
        # (gotcha: if the Director starts flubbing fields, tighten the
        # prompt or drop `minute` before raising this further).
        model=build_model(max_tokens=450, temperature=0.7),
        system_prompt=SYSTEM_PROMPT,
        tools=tools,
    )


def heuristic_fallback(user_team_id: str, opponent_team_id: str, target_matchup: dict) -> dict:
    """Fully offline degrade path used when Bedrock is unreachable or misbehaves."""
    if target_matchup:
        scenario = (
            f"Stoppage time, one goal in it. {target_matchup['attacker']} is drifting wide, "
            f"looking to isolate {target_matchup['defender']}."
        )
        coaching_goal = (
            f"Get {target_matchup['attacker']} into that space before "
            f"{target_matchup['defender']} recovers."
        )
        reasons = ", ".join(target_matchup.get("reasons", [])) or "a mismatch our scouts flagged"
        focus_note = f"{target_matchup['defender']} is the weak link today - {reasons}."
    else:
        scenario = "Level scoreline, midway through the second half - both sides probing for an opening."
        coaching_goal = "Hold your shape and force the mistake."
        focus_note = "No standout mismatch scouted today - work on shape discipline."
    return {
        "scenario": scenario,
        "coaching_goal": coaching_goal,
        "focus_note": focus_note,
        "focus_matchup": target_matchup,
        # "chasing the game" is the most motivating default for a drill.
        "opponent_formation_code": DEFAULT_FORMATION,
        "user_goals": 0,
        "opponent_goals": 1,
        "minute": 78,
        "tool_calls": [],
        "structured_ok": False,
    }


def design_drill(session, user_team_id: str, opponent_team_id: str, difficulty: str = DEFAULT_DIFFICULTY) -> dict:
    """
    Orchestration entry point called by the backend API.

    session: a ProgressAgent/DynamoProgressAgent instance for this session_id.
    Returns: { scenario, coaching_goal, focus_note, focus_matchup, tool_calls, structured_ok }
    """
    recurring = session.recurring_weakness()
    target_matchup = recurring or player_data.find_exploitable_matchup(opponent_team_id, user_team_id)

    remote_flag = {"used_remote": False}
    tools = _build_tools(session, user_team_id, opponent_team_id, difficulty, remote_flag)
    agent = build_agent(tools)

    memory_note = (
        f"Recurring weakness on record for this session: {recurring}. The drill must target it."
        if recurring
        else "No recurring weakness on record for this session yet."
    )

    prompt = f"""
    Design a training drill for the coach of {user_team_id}, playing against
    {opponent_team_id}, difficulty {difficulty}.

    {memory_note}

    Scouting report - build the drill around this matchup unless the
    recurring weakness above overrides it:
    {target_matchup if target_matchup else "No standout mismatch - use the scouting tool yourself."}

    Call generate_scenario with a short focus phrase naming the matchup to
    get the live-game situation text, and build the drill brief from its
    output.
    """

    result = agent(
        prompt,
        structured_output_model=DrillBrief,
        structured_output_prompt=(
            "Fill in the drill brief now. No analysis, headers, or commentary - "
            "fill in the fields directly."
        ),
    )
    brief = result.structured_output
    # Same convention as the Opponent Manager: the structured-output fill
    # shows up as a pseudo-tool-call named after the model class - drop it
    # so the observability feed only shows real tool actions.
    tool_calls = [name for name in tool_call_names(result) if name != DrillBrief.__name__]
    if remote_flag["used_remote"]:
        tool_calls = [
            "generate_scenario [AgentCore Runtime]" if name == "generate_scenario" else name
            for name in tool_calls
        ]

    if brief is not None:
        formation = brief.opponent_formation_code if brief.opponent_formation_code in VALID_FORMATIONS else DEFAULT_FORMATION
        return {
            "scenario": brief.scenario,
            "coaching_goal": brief.coaching_goal,
            "focus_note": brief.focus_note,
            "focus_matchup": target_matchup,
            # Never trust the model's arithmetic - clamp to the ranges the
            # UI can render.
            "opponent_formation_code": formation,
            "user_goals": max(0, min(9, brief.user_goals)),
            "opponent_goals": max(0, min(9, brief.opponent_goals)),
            "minute": max(1, min(90, brief.minute)),
            "tool_calls": tool_calls,
            "structured_ok": True,
        }

    fallback = heuristic_fallback(user_team_id, opponent_team_id, target_matchup)
    fallback["tool_calls"] = tool_calls
    return fallback
