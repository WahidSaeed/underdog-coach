"""
Scenario Agent + Progress Agent.

Kept in one file since both are relatively thin compared to the
Opponent Manager and Coach agents - split them out once real logic
grows past a screen or two.
"""

import os
from strands import Agent, tool

from agents.model_config import build_model
from tools import player_data

# ---------------------------------------------------------------------
# Scenario Agent: generates the match situation, difficulty-scaled and
# matchup-aware (e.g. deliberately building a scenario around a known
# weakness so the session has a teaching point, not just random noise).
# ---------------------------------------------------------------------

SCENARIO_PROMPT = """
You generate short football match scenarios for a tactics trainer.
Given the two rosters, pick one real matchup (a specific attacker vs
a specific defender) as the teaching focus, and describe a live-game
situation (score, time remaining, momentum) that puts pressure on that
matchup. Keep it to 2 sentences. Do not invent player attributes -
only use what the roster tools return.
"""


@tool
def get_roster(team_id: str) -> dict:
    return player_data.get_team(team_id)


def build_scenario_agent() -> Agent:
    return Agent(
        # 320 not 200: measured the model occasionally ignore "keep it to 2
        # sentences" and produce a longer, markdown-formatted reply, which at
        # 200 hit Strands' MaxTokensReachedException (a hard error, not a
        # graceful truncation) rather than just running long.
        model=build_model(max_tokens=320, temperature=0.8),
        system_prompt=SCENARIO_PROMPT,
        tools=[get_roster],
    )


def generate_scenario(focus: str, difficulty: str, team_a: str, team_b: str) -> str:
    """
    In-process scenario generation - the local mode of scenario_client.generate()
    (no SCENARIO_AGENT_RUNTIME_ARN set) and the last-resort path if the
    remote AgentCore call throws. `focus` names the matchup to build the
    situation around, matching what the AgentCore container expects too.
    """
    agent = build_scenario_agent()
    prompt = f"Generate a {difficulty} scenario for {team_a} vs {team_b}, focused on: {focus}."
    return str(agent(prompt))


# ---------------------------------------------------------------------
# Progress Agent: session memory. In the real deployment this reads/
# writes Bedrock AgentCore session state; here it's a minimal in-memory
# stand-in so the interface is clear.
# ---------------------------------------------------------------------

class ProgressAgent:
    """
    Tracks recurring patterns across a coaching session so feedback
    gets more personalized over time (e.g. "you keep leaving your
    weak-foot-only winger isolated on his strong side").
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.history: list[dict] = []
        self.drill_history: list[dict] = []

    def log_round(self, formation_code: str, exploited_matchup: dict):
        self.history.append({
            "formation": formation_code,
            "matchup": exploited_matchup,
        })

    def recurring_weakness(self) -> dict | None:
        """Returns the matchup that has been exploited more than once, if any."""
        seen = {}
        for round_data in self.history:
            key = round_data["matchup"].get("defender_id")
            if not key:
                continue
            seen[key] = seen.get(key, 0) + 1
            if seen[key] >= 2:
                return round_data["matchup"]
        return None

    def record_drill(self, matchup: dict):
        """
        Tracks which defender each `/drill` call has spotlighted. Used
        by match_director_agent.pick_target_matchup so a fresh session
        doesn't get the same matchup on every consecutive drill -
        find_exploitable_matchups is a pure function of the two
        rosters and would otherwise pick the identical strongest pair
        every time, which reads as a static/broken demo.
        """
        if matchup:
            self.drill_history.append(matchup)

    def recent_drill_defenders(self, n: int = 2) -> set:
        return {m["defender_id"] for m in self.drill_history[-n:] if m.get("defender_id")}

    def recent_round_defenders(self, n: int = 1) -> set:
        """
        Defenders the Opponent Manager has targeted in the last n
        /opponent rounds (self.history, populated by log_round) - mirrors
        recent_drill_defenders but for live-scouting rounds rather than
        drill design. Without this, decide_counter_strategy calling
        find_exploitable_matchup directly named the identical defender on
        every round (it's a pure function of two static rosters), which
        fed recurring_weakness() two identical picks after just two
        rounds and falsely locked every later drill onto that one matchup.
        """
        return {
            r["matchup"].get("defender_id")
            for r in self.history[-n:]
            if r.get("matchup", {}).get("defender_id")
        }


class DynamoProgressAgent(ProgressAgent):
    """
    Same interface as ProgressAgent, but persists round history to the
    SessionTable created by template.yaml, so a coaching relationship
    survives across separate requests/deploys instead of living only in
    Lambda's ephemeral memory. Swap this whole class out for Bedrock
    AgentCore session state once that's wired up.
    """

    def __init__(self, session_id: str, table_name: str):
        super().__init__(session_id)
        import boto3
        self._table = boto3.resource("dynamodb").Table(table_name)
        existing = self._table.get_item(Key={"sessionId": session_id}).get("Item")
        if existing:
            self.history = existing.get("history", [])
            self.drill_history = existing.get("drill_history", [])

    def _save(self):
        self._table.put_item(Item={
            "sessionId": self.session_id,
            "history": self.history,
            "drill_history": self.drill_history,
        })

    def log_round(self, formation_code: str, exploited_matchup: dict):
        super().log_round(formation_code, exploited_matchup)
        self._save()

    def record_drill(self, matchup: dict):
        super().record_drill(matchup)
        self._save()


def get_progress_agent(session_id: str):
    """
    Factory used by main.py. Returns a DynamoDB-backed agent when
    SESSION_TABLE is set (the Lambda deployment sets this via
    template.yaml), otherwise an in-memory one for local dev.
    """
    table_name = os.environ.get("SESSION_TABLE")
    if table_name:
        return DynamoProgressAgent(session_id, table_name)
    return ProgressAgent(session_id)
