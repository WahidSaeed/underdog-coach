"""
Deterministic slot-grid movement (agent_instruction.md items 2 and 4:
positions are a fixed, deterministic set - not free-hand - and moves must
be realistic, one step at a time, never a corner-to-corner jump).

Python port of the formation-slot arrays in frontend/lib/engine.ts
(LINES / xPositions / the yLines arrays in buildFormation) - cross-ref
comment on purpose, same convention this codebase already uses for
ISOLATION_RADIUS (engine.ts) / HELPER_RADIUS (board_metrics.py): keep the
two files' numbers in sync by hand.

A pawn's position is (line, slot): line 0 is always the GK's line (a
single, immobile slot - the GK never moves), line 1..N-1 are DEF/MID/FWD
in that order. Movement per turn is one step to an orthogonally/
diagonally adjacent (line, slot) - a "king move" on this fixed grid,
never further, and never onto the GK's line.

A starting XI fills every slot in every line for its formation (that's
what "count" per line means), so no slot is ever empty within a given
formation - every ordinary turn's legal move is a mutual swap between two
adjacent players (see resolve_turn_moves/plan_opponent_moves), never a
move into open space. That's intentional, not a bug: it keeps the board
a closed, fixed permutation of real starting positions
(agent_instruction.md item 2's "very precise number of positions"),
rather than pawns drifting into arbitrary empty squares.

The one exception is a formation change (build_board() re-run against a
new formation_code, gated by FORMATION_CHANGE_COOLDOWN below) - a
deliberate full reshuffle, not a "move", which is why it's rare/costly
rather than a normal turn action.
"""

from typing import Literal, TypedDict

FormationCode = Literal[
    "442", "433", "352", "532",
    "41212", "4231", "4321", "4222", "3421", "3241", "460",
]

# Line counts per formation, GK first. A formation's own outfield line
# count varies (4-2-3-1 has 4 outfield lines, 4-1-2-1-2 has 5, 4-6-0 has
# only 2 - no forward line at all) - everything below is written generic
# over len(LINES[code]) rather than assuming a fixed 4 lines.
LINES: dict[str, list[int]] = {
    "442": [1, 4, 4, 2],
    "433": [1, 4, 3, 3],
    "352": [1, 3, 5, 2],
    "532": [1, 5, 3, 2],
    "41212": [1, 4, 1, 2, 1, 2],   # GK, DEF, DM, CM x2, AM, FWD x2
    "4231": [1, 4, 2, 3, 1],       # GK, DEF, DM x2, AM x3, FWD
    "4321": [1, 4, 3, 2, 1],       # GK, DEF, MID x3, SS x2, FWD
    "4222": [1, 4, 2, 2, 2],       # GK, DEF, DM x2, AM x2, FWD x2
    "3421": [1, 3, 4, 2, 1],       # GK, DEF x3, MID x4, AM x2, FWD
    "3241": [1, 3, 2, 4, 1],       # GK, DEF x3, DM x2, AM x4, FWD
    "460": [1, 4, 6],              # GK, DEF, MID x6 - no forward line
}

# Role per line index - the last populated line is "FWD" except for 4-6-0
# (a genuine no-striker shape: its front line is still "MID"). Explicit
# per formation rather than inferred, since inferring "last line is FWD"
# is exactly wrong for 4-6-0.
FORMATION_ROLES: dict[str, list[str]] = {
    "442": ["GK", "DEF", "MID", "FWD"],
    "433": ["GK", "DEF", "MID", "FWD"],
    "352": ["GK", "DEF", "MID", "FWD"],
    "532": ["GK", "DEF", "MID", "FWD"],
    "41212": ["GK", "DEF", "MID", "MID", "MID", "FWD"],
    "4231": ["GK", "DEF", "MID", "MID", "FWD"],
    "4321": ["GK", "DEF", "MID", "MID", "FWD"],
    "4222": ["GK", "DEF", "MID", "MID", "FWD"],
    "3421": ["GK", "DEF", "MID", "MID", "FWD"],
    "3241": ["GK", "DEF", "MID", "MID", "FWD"],
    "460": ["GK", "DEF", "MID"],
}

# Same shape as frontend/lib/engine.ts's POS_BY_LINE - which real position
# label fills each slot, used only to pick a sensible starting player per
# slot in build_board() below. Roster position labels are limited to
# {GK,RB,CB,LB,RM,CM,LM,ST} (data/players.json), so these are best-effort
# hints, not exact real-world labels for every line (e.g. a "DM" line just
# reuses "CM") - build_board() falls back to the next unplaced player when
# a wanted label isn't found, so an imperfect label never breaks anything.
POS_BY_LINE: dict[str, list[list[str]]] = {
    "442": [["GK"], ["RB", "CB", "CB", "LB"], ["RM", "CM", "CM", "LM"], ["ST", "ST"]],
    "433": [["GK"], ["RB", "CB", "CB", "LB"], ["CM", "CM", "CM"], ["RM", "ST", "LM"]],
    "352": [["GK"], ["CB", "CB", "CB"], ["RM", "CM", "CM", "CM", "LM"], ["ST", "ST"]],
    "532": [["GK"], ["RB", "CB", "CB", "CB", "LB"], ["CM", "CM", "CM"], ["ST", "ST"]],
    "41212": [["GK"], ["RB", "CB", "CB", "LB"], ["CM"], ["CM", "CM"], ["CM"], ["ST", "ST"]],
    "4231": [["GK"], ["RB", "CB", "CB", "LB"], ["CM", "CM"], ["RM", "CM", "LM"], ["ST"]],
    "4321": [["GK"], ["RB", "CB", "CB", "LB"], ["CM", "CM", "CM"], ["ST", "ST"], ["ST"]],
    "4222": [["GK"], ["RB", "CB", "CB", "LB"], ["CM", "CM"], ["RM", "LM"], ["ST", "ST"]],
    "3421": [["GK"], ["CB", "CB", "CB"], ["RM", "CM", "CM", "LM"], ["ST", "ST"], ["ST"]],
    "3241": [["GK"], ["CB", "CB", "CB"], ["CM", "CM"], ["RM", "ST", "LM", "ST"], ["ST"]],
    "460": [["GK"], ["RB", "CB", "CB", "LB"], ["RM", "CM", "CM", "CM", "LM", "ST"]],
}

# Blue attacks toward decreasing y (up the pitch); red attacks toward
# increasing y - same sign convention as frontend/lib/engine.ts's
# buildFormation/applyPostureShift comments ("gotcha #1"). Only the GK's
# line and the deepest/most-advanced outfield line are fixed per side;
# everything in between is spread evenly by _line_y_positions() below so
# formations with more or fewer outfield lines than the original 4 still
# get sensible spacing.
#
# ADVANCED_Y deliberately crosses well past the halfway line (50) for both
# sides - a real front line plays high up the opponent's third, not parked
# on the centre circle. Previously ADVANCED_Y stopped at 49/51 (right at
# halfway), which kept every formation confined to its own half regardless
# of formation/tactics; this is the permanent fix, not a lever.
GK_Y = {"blue": 93, "red": 7}
DEEP_Y = {"blue": 78, "red": 22}
ADVANCED_Y = {"blue": 14, "red": 86}

MAX_MOVES_PER_TURN = 2

# A formation change reshapes the user's entire grid at once - a real
# system change, not a single realistic move (item 4), so it's gated
# behind a cooldown rather than freely repeatable every turn. Turns
# elapsed, not wall-clock time: usable again once
# turn_count - formation_changed_at_turn >= this value.
FORMATION_CHANGE_COOLDOWN = 5

# IFAB's modern law-of-the-game substitution limit (also what the 2022
# World Cup used in normal time) - a hard cap per match, not per turn.
MAX_SUBSTITUTIONS = 5

Move = TypedDict("Move", {
    "player_id": str,
    "from_line": int, "from_slot": int,
    "to_line": int, "to_slot": int,
    "from_x": float, "from_y": float,
    "to_x": float, "to_y": float,
})


def _x_positions(count: int) -> list[float]:
    if count == 1:
        return [50.0]
    margin = 10
    step = (100 - 2 * margin) / (count - 1)
    return [round(margin + i * step) for i in range(count)]


def _line_y_positions(side: str, num_lines: int) -> list[float]:
    """Y coordinate per line index (0 = GK) for a formation with
    `num_lines` total lines - outfield lines are spread evenly between
    DEEP_Y and ADVANCED_Y, generalizing the original fixed 4-line
    [GK, DEF, MID, FWD] spacing to formations with more or fewer outfield
    groups (e.g. 4-1-2-1-2's five, 4-6-0's two)."""
    outfield_count = num_lines - 1
    if outfield_count <= 0:
        return [GK_Y[side]]
    deep, advanced = DEEP_Y[side], ADVANCED_Y[side]
    if outfield_count == 1:
        ys = [(deep + advanced) / 2]
    else:
        step = (advanced - deep) / (outfield_count - 1)
        ys = [deep + i * step for i in range(outfield_count)]
    return [GK_Y[side]] + ys


def slot_to_xy(formation_code: str, side: str, line: int, slot: int) -> tuple[float, float]:
    lines = LINES[formation_code]
    xs = _x_positions(lines[line])
    ys = _line_y_positions(side, len(lines))
    return xs[slot], ys[line]


def formation_change_available(turn_count: int, formation_changed_at_turn: int | None) -> tuple[bool, int | None]:
    """
    Whether a formation change is usable right now, given the match's
    current turn_count and the turn it was last used (None = never used).
    Returns (available, available_at_turn) - available_at_turn is the
    turn_count at which it next becomes usable (None if already available).
    """
    if formation_changed_at_turn is None:
        return True, None
    available_at = formation_changed_at_turn + FORMATION_CHANGE_COOLDOWN
    if turn_count >= available_at:
        return True, None
    return False, available_at


def substitute_player(board: list[dict], player_id_out: str, player_id_in: str) -> list[dict] | None:
    """
    Like-for-like substitution: player_id_in takes over player_id_out's
    exact (line, slot, role, x, y) - no reshuffle, unlike a formation
    change. Returns None if player_id_out isn't actually on this board.
    """
    new_board = []
    replaced = False
    for p in board:
        if p["player_id"] == player_id_out:
            new_board.append({**p, "player_id": player_id_in})
            replaced = True
        else:
            new_board.append(dict(p))
    return new_board if replaced else None


def build_board(formation_code: str, roster: list[dict], side: str) -> list[dict]:
    """
    Starting-position board for a fresh match, or a full reshuffle when
    the user spends a formation change mid-match (see
    formation_change_available above): places `roster` (a team's player
    list from tools/player_data.get_team) onto the fixed slot grid for
    `formation_code`, matching real positions to slots where possible
    (same best-effort/fallback algorithm as frontend/lib/engine.ts's
    buildFormation - pick the first roster player whose `position` matches
    the slot's wanted label, else fall back to the next unplaced player).

    Returns [{"player_id", "role", "line", "slot", "x", "y"}, ...].
    """
    lines = LINES[formation_code]
    pos_lines = POS_BY_LINE[formation_code]
    roles = FORMATION_ROLES[formation_code]
    ys = _line_y_positions(side, len(lines))
    gk = next(p for p in roster if p["position"] == "GK")
    pool = [p for p in roster if p["position"] != "GK"]

    board: list[dict] = []
    for li, count in enumerate(lines):
        xs = _x_positions(count)
        wanted = pos_lines[li]
        for i in range(count):
            if li == 0:
                player = gk
            else:
                idx = next((j for j, p in enumerate(pool) if p["position"] == wanted[i]), None)
                if idx is None:
                    idx = 0
                player = pool.pop(idx)
            board.append({
                "player_id": player["id"], "role": roles[li],
                "line": li, "slot": i,
                "x": xs[i], "y": ys[li],
            })
    return board


def legal_neighbors(formation_code: str, line: int, slot: int, role: str) -> list[tuple[int, int]]:
    """King-adjacency on the fixed grid. GK (role == 'GK') never moves.
    Line 0 (the GK's line) is never a legal destination for anyone else."""
    if role == "GK":
        return []
    lines = LINES[formation_code]
    n_lines = len(lines)
    out: set[tuple[int, int]] = set()
    for dl in (-1, 0, 1):
        for ds in (-1, 0, 1):
            if dl == 0 and ds == 0:
                continue
            nl = line + dl
            if nl <= 0 or nl >= n_lines:
                continue
            ns = slot + ds
            if ns < 0 or ns >= lines[nl]:
                continue
            out.add((nl, ns))
    return sorted(out)


def validate_move(
    formation_code: str, role: str, from_line: int, from_slot: int, to_line: int, to_slot: int
) -> tuple[bool, str | None]:
    """Hard legality check - the only hard block in the whole rules stack
    (tactical rule findings in rules_engine.py are graded, never blocking).
    Does NOT check slot occupancy - see resolve_turn_moves/plan_opponent_moves
    below, which handle occupancy (including mutual swaps) against a live
    board."""
    if role == "GK":
        return False, "gk_immobile"
    lines = LINES.get(formation_code)
    if lines is None:
        return False, "invalid_formation"
    if to_line <= 0 or to_line >= len(lines) or to_slot < 0 or to_slot >= lines[to_line]:
        return False, "slot_out_of_range"
    if (to_line, to_slot) not in legal_neighbors(formation_code, from_line, from_slot, role):
        return False, "not_adjacent"
    return True, None


def _make_move_record(formation_code: str, side: str, pawn: dict, to_line: int, to_slot: int) -> Move:
    to_x, to_y = slot_to_xy(formation_code, side, to_line, to_slot)
    return {
        "player_id": pawn["player_id"],
        "from_line": pawn["line"], "from_slot": pawn["slot"],
        "to_line": to_line, "to_slot": to_slot,
        "from_x": pawn["x"], "from_y": pawn["y"],
        "to_x": to_x, "to_y": to_y,
    }


def plan_opponent_moves(
    formation_code: str,
    red_pawns: list[dict],
    target_matchup: dict | None,
    blue_pawns: list[dict],
    max_moves: int = MAX_MOVES_PER_TURN,
) -> list[Move]:
    """
    Deterministically advances up to `max_moves` red pawns one legal step
    each, biased toward closing the target_matchup's attacker onto the
    defender's (line, slot). Legal by construction - every candidate is
    drawn from legal_neighbors(), so this never needs to be validated
    against validate_move() afterward.

    A starting XI fills every slot on its own formation's grid, so a
    pawn's cheapest useful neighbor is very often occupied by a teammate
    on kickoff - this also considers a mutual swap (the occupying
    teammate's own legal_neighbors includes the mover's current slot) so
    the opponent isn't stuck immobile turn one; a swap displaces two
    players and so costs both of this call's max_moves budget.

    The opponent's *exact* pawn destinations are decided here, in code,
    not by the LLM - opponent_manager_agent still commits the strategic
    formation/instruction/narrative (the "why"), this decides "where",
    guaranteeing legality without validating the model's own coordinate
    guesses (same ground-truth-computed-in-code philosophy as
    board_metrics.py/rules_engine.py, extended to pawn placement too).

    red_pawns / blue_pawns: [{"player_id", "role", "line", "slot", "x", "y"}, ...]
    """
    pawns_by_id = {p["player_id"]: dict(p) for p in red_pawns}
    slot_owner = {(p["line"], p["slot"]): p["player_id"] for p in pawns_by_id.values()}

    priority_ids: list[str] = []
    if target_matchup and target_matchup.get("attacker_id") in pawns_by_id:
        priority_ids.append(target_matchup["attacker_id"])
    for p in red_pawns:
        if p["player_id"] not in priority_ids and p.get("role") != "GK":
            priority_ids.append(p["player_id"])

    defender = None
    if target_matchup:
        defender = next(
            (b for b in blue_pawns if b["player_id"] == target_matchup.get("defender_id")), None
        )
    target = (defender["line"], defender["slot"]) if defender is not None else None

    moves: list[Move] = []
    moved_ids: set[str] = set()

    for player_id in priority_ids:
        if len(moved_ids) >= max_moves or player_id in moved_ids:
            continue
        pawn = pawns_by_id[player_id]
        if pawn.get("role") == "GK":
            continue

        goal = target if target is not None else (len(LINES[formation_code]) - 1, pawn["slot"])
        neighbors = sorted(
            legal_neighbors(formation_code, pawn["line"], pawn["slot"], pawn.get("role", "")),
            key=lambda n: abs(n[0] - goal[0]) + abs(n[1] - goal[1]),
        )

        for to_line, to_slot in neighbors:
            occupant_id = slot_owner.get((to_line, to_slot))

            if occupant_id is None:
                orig = (pawn["line"], pawn["slot"])
                moves.append(_make_move_record(formation_code, "red", pawn, to_line, to_slot))
                del slot_owner[orig]
                pawn["line"], pawn["slot"] = to_line, to_slot
                pawn["x"], pawn["y"] = slot_to_xy(formation_code, "red", to_line, to_slot)
                slot_owner[(to_line, to_slot)] = player_id
                moved_ids.add(player_id)
                break

            if occupant_id == player_id or occupant_id in moved_ids or len(moved_ids) + 2 > max_moves:
                continue
            occupant = pawns_by_id[occupant_id]
            if occupant.get("role") == "GK":
                continue
            mover_slot = (pawn["line"], pawn["slot"])
            if mover_slot not in legal_neighbors(formation_code, occupant["line"], occupant["slot"], occupant["role"]):
                continue

            # Mutual swap: occupant's own neighbors include the mover's
            # current slot, so both halves are individually legal.
            occ_orig = (occupant["line"], occupant["slot"])
            moves.append(_make_move_record(formation_code, "red", pawn, to_line, to_slot))
            moves.append(_make_move_record(formation_code, "red", occupant, mover_slot[0], mover_slot[1]))
            pawn["line"], pawn["slot"] = to_line, to_slot
            pawn["x"], pawn["y"] = slot_to_xy(formation_code, "red", to_line, to_slot)
            occupant["line"], occupant["slot"] = mover_slot
            occupant["x"], occupant["y"] = slot_to_xy(formation_code, "red", mover_slot[0], mover_slot[1])
            slot_owner[occ_orig] = player_id
            slot_owner[mover_slot] = occupant_id
            moved_ids.add(player_id)
            moved_ids.add(occupant_id)
            break

    return moves


def resolve_turn_moves(
    formation_code: str, board: list[dict], proposed_moves: list[dict], side: str = "blue",
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Validates a batch of user-submitted moves against a live board.
    proposed_moves: [{"player_id", "to_line", "to_slot"}, ...]

    Each move must land on an empty slot, or be one half of a mutual swap
    (the other pawn's move in the same batch trades back into the mover's
    current slot) - see plan_opponent_moves' docstring for why swaps are
    necessary at all on a fully-packed starting grid. Up to
    MAX_MOVES_PER_TURN players may be displaced per turn (a swap displaces
    two, so at most one swap OR up to MAX_MOVES_PER_TURN independent moves).

    Returns (accepted_moves, rejected_moves, new_board) where
    accepted_moves/rejected_moves are UI-facing dicts
    ({"player_id","from","to"} / {"player_id","reason"}).
    """
    board_by_id = {p["player_id"]: dict(p) for p in board}
    proposed = {m["player_id"]: m for m in proposed_moves}

    accepted: list[dict] = []
    rejected: list[dict] = []
    handled: set[str] = set()
    moved_count = 0

    for m in proposed_moves:
        if m["player_id"] not in board_by_id:
            rejected.append({"player_id": m["player_id"], "reason": "unknown_player"})
            handled.add(m["player_id"])

    for player_id, mv in proposed.items():
        if player_id in handled:
            continue
        if moved_count >= MAX_MOVES_PER_TURN:
            rejected.append({"player_id": player_id, "reason": "turn_move_limit_exceeded"})
            handled.add(player_id)
            continue

        pawn = board_by_id[player_id]
        ok, reason = validate_move(formation_code, pawn["role"], pawn["line"], pawn["slot"], mv["to_line"], mv["to_slot"])
        if not ok:
            rejected.append({"player_id": player_id, "reason": reason})
            handled.add(player_id)
            continue

        occupant_id = next(
            (pid for pid, p in board_by_id.items()
             if pid != player_id and p["line"] == mv["to_line"] and p["slot"] == mv["to_slot"]),
            None,
        )

        if occupant_id is None:
            to_x, to_y = slot_to_xy(formation_code, side, mv["to_line"], mv["to_slot"])
            accepted.append({
                "player_id": player_id,
                "from": {"line": pawn["line"], "slot": pawn["slot"]},
                "to": {"line": mv["to_line"], "slot": mv["to_slot"]},
            })
            pawn["line"], pawn["slot"], pawn["x"], pawn["y"] = mv["to_line"], mv["to_slot"], to_x, to_y
            handled.add(player_id)
            moved_count += 1
            continue

        occupant_move = proposed.get(occupant_id)
        occupant_pawn = board_by_id[occupant_id]
        is_swap = (
            occupant_move is not None
            and occupant_id not in handled
            and occupant_move["to_line"] == pawn["line"] and occupant_move["to_slot"] == pawn["slot"]
        )
        if not is_swap or moved_count + 2 > MAX_MOVES_PER_TURN:
            rejected.append({"player_id": player_id, "reason": "slot_occupied"})
            handled.add(player_id)
            continue

        ok2, reason2 = validate_move(
            formation_code, occupant_pawn["role"], occupant_pawn["line"], occupant_pawn["slot"],
            occupant_move["to_line"], occupant_move["to_slot"],
        )
        if not ok2:
            rejected.append({"player_id": player_id, "reason": "slot_occupied"})
            rejected.append({"player_id": occupant_id, "reason": reason2})
            handled.add(player_id)
            handled.add(occupant_id)
            continue

        orig_a = (pawn["line"], pawn["slot"])
        orig_b = (occupant_pawn["line"], occupant_pawn["slot"])
        ax, ay = slot_to_xy(formation_code, side, mv["to_line"], mv["to_slot"])
        bx, by = slot_to_xy(formation_code, side, orig_a[0], orig_a[1])
        accepted.append({"player_id": player_id, "from": {"line": orig_a[0], "slot": orig_a[1]}, "to": {"line": mv["to_line"], "slot": mv["to_slot"]}})
        accepted.append({"player_id": occupant_id, "from": {"line": orig_b[0], "slot": orig_b[1]}, "to": {"line": orig_a[0], "slot": orig_a[1]}})
        pawn["line"], pawn["slot"], pawn["x"], pawn["y"] = mv["to_line"], mv["to_slot"], ax, ay
        occupant_pawn["line"], occupant_pawn["slot"], occupant_pawn["x"], occupant_pawn["y"] = orig_a[0], orig_a[1], bx, by
        handled.add(player_id)
        handled.add(occupant_id)
        moved_count += 2

    return accepted, rejected, list(board_by_id.values())
