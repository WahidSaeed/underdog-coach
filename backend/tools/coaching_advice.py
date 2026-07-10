"""
Concrete "what to do next" suggestions - when a turn grades badly, the
coach must not just describe the problem, it must show the user a real,
legal move that improves it.

Deterministic, no LLM: brute-forces every legal one-swap move available
to blue (tools/grid_movement.legal_neighbors already keeps this small -
each player only has a handful of adjacent teammates) and picks whichever
swap most improves this turn's tools/scoring.score_turn delta, using
tools/rules_engine.evaluate_turn as the same ground truth the coach is
graded against. Same "ground truth computed in code, handed to the LLM to
narrate" pattern as everywhere else in this codebase - the model never
invents the fix, it just explains the one this module already found.
"""

from typing import TypedDict

from tools import grid_movement, player_data, rules_engine, scoring


class SuggestedFix(TypedDict):
    player_id_a: str
    player_id_b: str
    player_a_name: str
    player_b_name: str
    score_improvement: int


def _swap(board: list[dict], formation_code: str, side: str, a: dict, b: dict) -> list[dict]:
    by_id = {p["player_id"]: dict(p) for p in board}
    na, nb = by_id[a["player_id"]], by_id[b["player_id"]]
    ax, ay = grid_movement.slot_to_xy(formation_code, side, b["line"], b["slot"])
    bx, by_ = grid_movement.slot_to_xy(formation_code, side, a["line"], a["slot"])
    na["line"], na["slot"], na["x"], na["y"] = b["line"], b["slot"], ax, ay
    nb["line"], nb["slot"], nb["x"], nb["y"] = a["line"], a["slot"], bx, by_
    return list(by_id.values())


def suggest_best_swap(
    formation_code: str, team_id: str, blue_board: list[dict], red_board: list[dict], focus_matchup: dict | None
) -> SuggestedFix | None:
    """
    Tries every legal swap available to `team_id`'s (always "blue" today)
    outfield players and returns whichever one most improves this turn's
    finding-based score, or None if no single swap helps (the board is
    already as good as a swap can make it - a real "nothing to fix" turn,
    or a problem only a formation change could address).
    """
    baseline_findings = rules_engine.evaluate_turn(blue_board, red_board, focus_matchup)
    baseline_delta = scoring.score_turn(baseline_findings, verdict=None)["delta"]

    board_by_slot = {(p["line"], p["slot"]): p for p in blue_board}
    seen_pairs: set[frozenset] = set()
    best: tuple[int, dict, dict] | None = None

    for p in blue_board:
        if p["role"] == "GK":
            continue
        for nl, ns in grid_movement.legal_neighbors(formation_code, p["line"], p["slot"], p["role"]):
            neighbor = board_by_slot.get((nl, ns))
            if neighbor is None or neighbor["role"] == "GK":
                continue
            pair_key = frozenset((p["player_id"], neighbor["player_id"]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            candidate_board = _swap(blue_board, formation_code, "blue", p, neighbor)
            findings = rules_engine.evaluate_turn(candidate_board, red_board, focus_matchup)
            delta = scoring.score_turn(findings, verdict=None)["delta"]
            improvement = delta - baseline_delta
            if improvement > 0 and (best is None or improvement > best[0]):
                best = (improvement, p, neighbor)

    if best is None:
        return None

    improvement, a, b = best
    a_info = player_data.get_player(team_id, a["player_id"])
    b_info = player_data.get_player(team_id, b["player_id"])
    return {
        "player_id_a": a["player_id"],
        "player_id_b": b["player_id"],
        "player_a_name": a_info["name"] if a_info else a["player_id"],
        "player_b_name": b_info["name"] if b_info else b["player_id"],
        "score_improvement": improvement,
    }
