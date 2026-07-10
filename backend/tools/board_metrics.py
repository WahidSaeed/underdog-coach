"""
Deterministic cover metrics for a drill in progress.

Plain functions, no LLM - grading a user's fix must trace to real pawn
coordinates, not a model grading its own homework. See
docs/BRIEFING-drill-board-staging.md 4b.
"""

import math

from tools import player_data

# Calibrated for the fixed slot grid (tools/grid_movement.py), not free
# pixel coordinates - adjacent grid squares are themselves 16-40 units
# apart (e.g. two adjacent defenders in a back-4 are ~27 apart), so the
# old free-drag-era radii (15/10) made every formation read as
# permanently isolated regardless of the user's actual setup. These
# values are picked so same-line and diagonal-adjacent squares count as
# "close" while the far side of the pitch does not.
#
# MARK_RADIUS is kept close to its original, geometrically-real value -
# see agents/coach_agent.py's SOLVED_LUCK_RATE for the actual demo-mode
# generosity (agent_instruction.md follow-up: "design the game to have
# around 10 to 13 out of 15 be SOLVED with a good score"). A pure radius
# bump turned out to be too blunt an instrument for that: since the
# opponent only advances 1-2 pawns per turn, whichever side of the
# threshold a given formation/matchup starts on tends to stick for the
# whole match (attacker distance barely changes turn to turn), so radius
# tuning alone produced all-SOLVED or all-PARTIAL matches depending on
# formation luck, never the desired mixed spread across the two.
#
# HELPER_RADIUS specifically has to clear 40 - a back-three's three DEF
# slots sit 40 units apart (fewer defenders spread across the same
# width), so at the old 30 every back-three formation had a defender
# with literally zero teammates within range on kickoff, before the user
# ever did anything - guaranteed EXPOSED regardless of play, not a real
# signal of a bad setup.
HELPER_RADIUS = 45
MARK_RADIUS = 24


def _dist(a: dict, b: dict) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def threat_cover(board: dict, focus_matchup: dict) -> dict:
    """
    How well the focus defender is protected right now.

    board: {"blue": [{"id","x","y"}, ...], "red": [...]}
    focus_matchup: the drill's {attacker_id, defender_id, ...}

    Returns e.g. {"helpers_within_15": 2, "nearest_helper_dist": 8.4,
                  "attacker_marked": True, "isolated": False}
    """
    blue = board.get("blue", [])
    red = board.get("red", [])

    defender = next((p for p in blue if p["id"] == focus_matchup.get("defender_id")), None)
    attacker = next((p for p in red if p["id"] == focus_matchup.get("attacker_id")), None)

    # Ids can drift between the drill's roster ids and the board payload in
    # principle (see briefing gotcha #3) - treat an unfindable defender as
    # worst-case isolated rather than silently reporting good cover.
    if defender is None:
        return {"helpers_within_15": 0, "nearest_helper_dist": None, "attacker_marked": False, "isolated": True}

    helper_dists = []
    for p in blue:
        if p["id"] == defender["id"]:
            continue
        info = player_data.get_player("blue", p["id"])
        if info and info["position"] == "GK":
            continue
        d = _dist(p, defender)
        if d <= HELPER_RADIUS:
            helper_dists.append(d)

    attacker_marked = attacker is not None and any(_dist(p, attacker) <= MARK_RADIUS for p in blue)

    return {
        "helpers_within_15": len(helper_dists),
        "nearest_helper_dist": round(min(helper_dists), 1) if helper_dists else None,
        "attacker_marked": attacker_marked,
        "isolated": len(helper_dists) == 0,
    }
