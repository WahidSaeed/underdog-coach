"""
Opponent Manager Agent.

Given the user's current formation and pawn positions, this agent plays
the role of the AI opponent's manager: it commits to a counter-shape and
a specific tactical instruction, grounded in the player_data tool rather
than freeform football trivia.

NOTE: This is written against the expected Strands Agents SDK shape
(Agent + @tool). Confirm exact import paths/method names against the
current Strands docs when wiring this up for real - the SDK surface
may have shifted since this was scaffolded.
"""

from strands import Agent, tool
from tools import player_data

SYSTEM_PROMPT = """
You are the opposing team's manager in a football tactics trainer.
You must commit to ONE counter-formation and ONE tactical instruction
in response to the user's team shape. Always ground your reasoning in
the specific player weaknesses returned by the scouting tools - never
invent a player attribute that isn't in the data. Keep your committed
plan to 2-3 sentences, in the voice of a manager giving instructions
to their team, not a neutral analyst.
"""


@tool
def scout_matchup(attacking_team: str, defending_team: str) -> dict:
    """Find the most exploitable attacker-vs-defender matchup on the pitch."""
    return player_data.find_exploitable_matchup(attacking_team, defending_team)


@tool
def get_roster(team_id: str) -> dict:
    """Fetch a team's full roster with stats and traits."""
    return player_data.get_team(team_id)


def build_agent() -> Agent:
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[scout_matchup, get_roster],
    )


def decide_counter_strategy(user_formation: dict, user_team_id: str, opponent_team_id: str) -> dict:
    """
    Orchestration entry point called by the backend API.

    user_formation: { "code": "4-3-3", "width_spread": 62, "avg_def_line": 71, ... }
    Returns: { "formation_code": "...", "instruction": "...", "target_matchup": {...} }
    """
    agent = build_agent()

    prompt = f"""
    The user's team ({user_team_id}) is set up in a {user_formation['code']}
    with a width spread of {user_formation['width_spread']} and an average
    defensive line height of {user_formation['avg_def_line']}.

    Use the scouting tool to find the best matchup for us ({opponent_team_id})
    to exploit, then commit to a counter-formation and one instruction.
    """

    result = agent(prompt)

    return {
        "raw_response": str(result),
        "target_matchup": player_data.find_exploitable_matchup(
            opponent_team_id, user_team_id
        ),
    }
