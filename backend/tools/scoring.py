"""
Scoring rubric (agent_instruction.md item 5: "a board of score being
maintained for user's total good and bad and overall decision along with
turns taken").

Kept separate from rules_engine.py so tuning the point values never
touches finding-detection logic.
"""

from typing import Literal, TypedDict

from tools.rules_engine import RuleFinding

FINDING_POINTS: dict[str, int] = {"good": 2, "neutral": 0, "bad": -1}
VERDICT_POINTS: dict[str, int] = {"SOLVED": 5, "PARTIAL": 1, "EXPOSED": -3}
ILLEGAL_MOVE_PENALTY = -1
# A formation change reshapes the whole team at once (see
# tools/grid_movement.FORMATION_CHANGE_COOLDOWN) - a real tactical gamble,
# not a free action, so it costs points on top of consuming the turn.
FORMATION_CHANGE_PENALTY = -2

# Set high enough that a 15-turn match almost never reaches it early
# (agent_instruction.md follow-up: "10 to 13 out of 15 SOLVED" implies
# the user actually sees all 15 turns, not a match that ends at turn 6
# because the target was trivially low against the new SOLVED_RATE-
# boosted scoring - empirically, simulated 15-turn matches under the new
# grading land a final score of ~100-270; 300 sits above that range).
DEFAULT_TARGET_SCORE = 300
DEFAULT_MAX_TURNS = 15

MatchStatus = Literal["active", "complete_goal", "complete_max_turns", "abandoned"]


class TurnScore(TypedDict):
    good: int
    bad: int
    neutral: int
    delta: int


def score_turn(
    rule_findings: list[RuleFinding], verdict: str | None,
    illegal_move_count: int = 0, formation_changed: bool = False,
) -> TurnScore:
    good = sum(1 for f in rule_findings if f["severity"] == "good")
    bad = sum(1 for f in rule_findings if f["severity"] == "bad")
    neutral = sum(1 for f in rule_findings if f["severity"] == "neutral")

    delta = sum(FINDING_POINTS[f["severity"]] for f in rule_findings)
    if verdict in VERDICT_POINTS:
        delta += VERDICT_POINTS[verdict]
    delta += ILLEGAL_MOVE_PENALTY * illegal_move_count
    if formation_changed:
        delta += FORMATION_CHANGE_PENALTY
        bad += 1

    return {"good": good, "bad": bad, "neutral": neutral, "delta": delta}


def match_status_after(total_score: int, target_score: int, turn_count: int, max_turns: int) -> MatchStatus:
    if total_score >= target_score:
        return "complete_goal"
    if turn_count >= max_turns:
        return "complete_max_turns"
    return "active"
