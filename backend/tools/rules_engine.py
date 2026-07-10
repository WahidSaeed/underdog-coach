"""
Full tactical rules engine (agent_instruction.md item 7: "apply all the
real football rules... the goal is to teach the user how to become a
football strategist").

Deterministic, no LLM - same ground-truth-computed-in-code philosophy as
board_metrics.py (which this module extends and reuses rather than
replacing: the focus-matchup marking check still runs through
board_metrics.threat_cover). Findings here are never move-blocking -
grid_movement.validate_move is the only hard legality check in the
system. These are graded/coaching signals, hand these to coach_agent as
grounding text alongside `metrics`.

Convention: `severity` is always from blue's (the human learner's)
perspective - "good" means good news for blue, "bad" means bad news for
blue, regardless of which team the finding is actually about.
"""

import math
from typing import Literal, TypedDict

from tools import board_metrics

Severity = Literal["good", "neutral", "bad"]

BROKEN_LINE_SPREAD = 12
# Same number main.py._compute_emotion already used for blue's high-line
# read; mirrored across the halfway line (100 - 68) for red.
HIGH_LINE_THRESHOLD = {"blue": 68, "red": 32}

# Same fixed-grid calibration reasoning as board_metrics.HELPER_RADIUS/
# MARK_RADIUS - adjacent grid squares are 16-40 units apart, so tighter
# free-drag-era radii would make these findings unreachable.
PRESS_RADIUS = 20
PASS_OUT_RADIUS = 30

# A red attacker still sitting in their own half isn't a live threat -
# checking marking against the whole opposing roster regardless of
# position made every turn read as a five-way marking failure no single
# swap could ever fix (11 blue players can't stand next to 10 spread-out
# red players at once). Only players who've actually advanced past
# halfway count, plus the live target_matchup attacker regardless of
# position (that's the designated teaching focus).
ATTACKING_HALF_Y = 50


class RuleFinding(TypedDict):
    name: str
    team: str
    player_ids: list[str]
    severity: Severity
    message: str


def _dist(a: dict, b: dict) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def _outfield(pawns: list[dict]) -> list[dict]:
    return [p for p in pawns if p.get("role") != "GK"]


def offside_line(defending_pawns: list[dict], defending_side: str) -> float:
    """Y of the second-deepest outfield player (GK excluded) - the
    classic 'second-last defender' offside line, approximated over all
    outfield roles since a tracking-back midfielder can be the last line
    too, not just a nominal DEF."""
    outfield = _outfield(defending_pawns)
    if len(outfield) < 2:
        # Not enough defenders on record to define a line - nobody can be
        # sprung offside against an undefined line.
        return float("inf") if defending_side == "blue" else float("-inf")
    if defending_side == "blue":
        ys = sorted((p["y"] for p in outfield), reverse=True)  # deepest = highest y
    else:
        ys = sorted(p["y"] for p in outfield)  # deepest = lowest y
    return ys[1]


def offside_findings(
    attacking_pawns: list[dict], defending_pawns: list[dict], attacking_team: str
) -> list[RuleFinding]:
    """One 'offside_position' finding per attacking outfield pawn
    positioned beyond the defending side's offside line. Informational/
    graded only - this is a positions board, not a live play-and-whistle
    sim, so it never blocks a move."""
    defending_side = "blue" if attacking_team == "red" else "red"
    line = offside_line(defending_pawns, defending_side)
    findings: list[RuleFinding] = []
    for p in _outfield(attacking_pawns):
        beyond = p["y"] > line if defending_side == "blue" else p["y"] < line
        if not beyond:
            continue
        # An offside RED attacker is good news for blue (the threat doesn't
        # actually exist); an offside BLUE attacker is a wasted run.
        severity: Severity = "good" if attacking_team == "red" else "bad"
        findings.append({
            "name": "offside_position", "team": attacking_team,
            "player_ids": [p["player_id"]], "severity": severity,
            "message": f"{p['player_id']} is in an offside position - no real threat from there.",
        })
    return findings


def marking_findings(
    blue_pawns: list[dict], red_pawns: list[dict], target_matchup: dict | None = None
) -> list[RuleFinding]:
    """Generalizes board_metrics.threat_cover beyond the drill's one focus
    matchup: every *dangerous* red attacker (past halfway, or the live
    target_matchup attacker regardless of position - see ATTACKING_HALF_Y)
    with no blue player within MARK_RADIUS, and every blue defender with
    no blue teammate within HELPER_RADIUS. Reuses those two existing
    constants so the numbers stay one source of truth."""
    findings: list[RuleFinding] = []
    focus_attacker_id = target_matchup.get("attacker_id") if target_matchup else None

    for attacker in _outfield(red_pawns):
        dangerous = attacker["y"] > ATTACKING_HALF_Y or attacker["player_id"] == focus_attacker_id
        if not dangerous:
            continue
        if not any(_dist(attacker, b) <= board_metrics.MARK_RADIUS for b in blue_pawns):
            findings.append({
                "name": "unmarked_attacker", "team": "red",
                "player_ids": [attacker["player_id"]], "severity": "bad",
                "message": f"{attacker['player_id']} has no blue player within marking distance.",
            })

    for defender in (p for p in blue_pawns if p.get("role") == "DEF"):
        teammates = [b for b in blue_pawns if b["player_id"] != defender["player_id"] and b.get("role") != "GK"]
        if not any(_dist(defender, t) <= board_metrics.HELPER_RADIUS for t in teammates):
            findings.append({
                "name": "isolated_defender", "team": "blue",
                "player_ids": [defender["player_id"]], "severity": "bad",
                "message": f"{defender['player_id']} has no covering teammate nearby.",
            })

    return findings


def defensive_line_findings(team_pawns: list[dict], team_id: str) -> list[RuleFinding]:
    """'broken_defensive_line' if the DEF line's y-spread is too wide (a
    gap a runner can exploit); 'high_defensive_line' if the DEF line's
    average y has pushed past the 'space in behind' threshold."""
    defenders = [p for p in team_pawns if p.get("role") == "DEF"]
    findings: list[RuleFinding] = []
    if len(defenders) >= 2:
        ys = [p["y"] for p in defenders]
        spread = max(ys) - min(ys)
        if spread > BROKEN_LINE_SPREAD:
            # A broken red line is good for blue (exploitable); a broken
            # blue line is bad for blue (their own defense is exposed).
            severity: Severity = "good" if team_id == "red" else "bad"
            findings.append({
                "name": "broken_defensive_line", "team": team_id,
                "player_ids": [p["player_id"] for p in defenders], "severity": severity,
                "message": f"{team_id}'s back line is stretched ({round(spread)} spread) - a gap to attack.",
            })

        avg_y = sum(ys) / len(ys)
        threshold = HIGH_LINE_THRESHOLD[team_id]
        is_high = avg_y < threshold if team_id == "blue" else avg_y > threshold
        if is_high:
            severity = "bad" if team_id == "blue" else "good"
            findings.append({
                "name": "high_defensive_line", "team": team_id,
                "player_ids": [p["player_id"] for p in defenders], "severity": severity,
                "message": f"{team_id}'s defensive line is pushed high - vulnerable to a ball in behind.",
            })
    return findings


def pressing_trap_findings(
    pressing_pawns: list[dict], pressed_pawns: list[dict], pressing_team_id: str
) -> list[RuleFinding]:
    """'pressing_trap_risk' on any pressed-team defender surrounded by
    >=2 pressing opponents within PRESS_RADIUS with fewer than 2 own
    teammates within PASS_OUT_RADIUS to play out to - the deterministic
    proxy for 'no easy out-ball under a coordinated press'."""
    pressed_team_id = "blue" if pressing_team_id == "red" else "red"
    findings: list[RuleFinding] = []
    for defender in (p for p in pressed_pawns if p.get("role") == "DEF"):
        pressers = sum(1 for a in pressing_pawns if a.get("role") in ("MID", "FWD") and _dist(a, defender) <= PRESS_RADIUS)
        if pressers < 2:
            continue
        outlets = sum(
            1 for t in pressed_pawns
            if t["player_id"] != defender["player_id"] and t.get("role") != "GK"
            and _dist(t, defender) <= PASS_OUT_RADIUS
        )
        if outlets < 2:
            severity: Severity = "bad" if pressed_team_id == "blue" else "good"
            findings.append({
                "name": "pressing_trap_risk", "team": pressed_team_id,
                "player_ids": [defender["player_id"]], "severity": severity,
                "message": f"{defender['player_id']} is pressed by {pressers} with no easy way out.",
            })
    return findings


def evaluate_turn(
    blue_pawns: list[dict], red_pawns: list[dict], focus_matchup: dict | None
) -> list[RuleFinding]:
    """Aggregator: the single list handed to coach_agent as ground truth,
    exactly like `metrics` is today. Called from the turn-finalizing
    endpoint and persisted into turns.rule_findings."""
    findings: list[RuleFinding] = []

    if focus_matchup:
        board = {
            "blue": [{"id": p["player_id"], "x": p["x"], "y": p["y"]} for p in blue_pawns],
            "red": [{"id": p["player_id"], "x": p["x"], "y": p["y"]} for p in red_pawns],
        }
        cover = board_metrics.threat_cover(board, focus_matchup)
        defender_id = focus_matchup.get("defender_id")
        attacker_id = focus_matchup.get("attacker_id")
        if cover["isolated"] and defender_id:
            findings.append({
                "name": "isolated_defender", "team": "blue", "player_ids": [defender_id], "severity": "bad",
                "message": f"{defender_id} has no cover on the targeted matchup.",
            })
        if cover["attacker_marked"] and attacker_id:
            findings.append({
                "name": "attacker_marked", "team": "blue", "player_ids": [attacker_id], "severity": "good",
                "message": f"{attacker_id} is marked - the targeted threat is covered.",
            })

    findings += offside_findings(red_pawns, blue_pawns, attacking_team="red")
    findings += offside_findings(blue_pawns, red_pawns, attacking_team="blue")
    findings += marking_findings(blue_pawns, red_pawns, target_matchup=focus_matchup)
    findings += defensive_line_findings(blue_pawns, "blue")
    findings += defensive_line_findings(red_pawns, "red")
    findings += pressing_trap_findings(red_pawns, blue_pawns, pressing_team_id="red")
    findings += pressing_trap_findings(blue_pawns, red_pawns, pressing_team_id="blue")

    return findings
