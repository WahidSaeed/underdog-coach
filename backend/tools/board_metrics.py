"""
Deterministic cover metrics for a drill in progress.

Plain functions, no LLM - grading a user's fix must trace to real pawn
coordinates, not a model grading its own homework. See
docs/BRIEFING-drill-board-staging.md 4b.
"""

import math

from tools import player_data

HELPER_RADIUS = 15
MARK_RADIUS = 10


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
