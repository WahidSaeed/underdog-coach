"""
Player data tool.

This is the grounding layer every agent calls into instead of guessing
football knowledge from the model's own memory. Judges will probe
"why did the agent make that call" - the answer should always trace
back to a concrete stat or trait from here, not vibes.

get_team() is the one place that decides where player data actually
comes from: the `players` Postgres table (db/models.PlayerRecord,
seeded once from data/players.json - see db/seed.py) when DATABASE_URL
is configured, otherwise the JSON file directly, so it works unmodified
on the legacy DynamoDB/in-memory deploy path too. Every other function
below reads through get_team() rather than touching a data source
directly, so they don't need to know which backend is active.
"""

import json
import random
from pathlib import Path
from typing import Optional

# Works in two layouts:
#  - local dev: repo_root/backend/tools/player_data.py -> repo_root/data/
#  - Lambda package: backend/tools/player_data.py -> backend/data/
#    (the Makefile copies data/ into backend/data/ before `sam build`)
_TOOLS_DIR = Path(__file__).resolve().parent
_CANDIDATES = [_TOOLS_DIR.parent / "data", _TOOLS_DIR.parent.parent / "data"]
DATA_DIR = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[-1])

with open(DATA_DIR / "players.json") as f:
    _PLAYER_DB = json.load(f)["teams"]

with open(DATA_DIR / "traits.json") as f:
    _TRAITS = json.load(f)


# Matchday squad size - the first 11 players in each roster (by
# roster_order in the DB, or array order in the JSON fallback) are the
# starting XI (used by tools/grid_movement.build_board), the rest are
# substitutes (agent_instruction.md follow-up: "up to 15 players on the
# bench" - scoped to 5 here, a standard modern match-day squad of 16).
STARTING_XI_SIZE = 11


def _load_team_from_db(team_id: str) -> dict:
    from db.models import PlayerRecord
    from db.session import get_session

    with get_session() as db:
        rows = (
            db.query(PlayerRecord)
            .filter_by(team_id=team_id)
            .order_by(PlayerRecord.roster_order)
            .all()
        )
    players = [{
        "id": r.id, "num": r.num, "name": r.name, "position": r.position,
        "stats": r.stats, "strengths": r.strengths, "weaknesses": r.weaknesses,
        "photo_url": r.photo_url,
    } for r in rows]
    # Team name/color are small, static metadata, not the per-player data
    # this table is about - still sourced from the JSON file even in DB
    # mode, same as before.
    meta = _PLAYER_DB[team_id]
    return {"name": meta["name"], "color": meta["color"], "players": players}


def get_team(team_id: str) -> dict:
    """Return full roster + metadata for 'blue' or 'red'."""
    from db.session import database_configured
    if database_configured():
        return _load_team_from_db(team_id)
    return _PLAYER_DB[team_id]


def get_bench(team_id: str) -> list[dict]:
    """Return the team's substitutes - every roster player past the
    starting XI, regardless of current match state (which of them are
    still available to bring on is tracked per-match, see
    db/models.py Match.bench_player_ids/subbed_off_ids)."""
    return get_team(team_id)["players"][STARTING_XI_SIZE:]


def get_starting_xi(team_id: str) -> list[dict]:
    """The 11 players tools/grid_movement.build_board is allowed to place
    on the grid. Callers must use this (not get_team(...)["players"]) when
    building a board - passing the full roster lets build_board's
    position-label fallback genuinely match a bench player instead of a
    starter whenever a formation wants more of some position than the
    starting XI has (e.g. 433 wants 3 CMs, the starting XI only has 2)."""
    return get_team(team_id)["players"][:STARTING_XI_SIZE]


def get_player(team_id: str, player_id: str) -> Optional[dict]:
    """Return a single player's stat block and traits."""
    for p in get_team(team_id)["players"]:
        if p["id"] == player_id:
            return p
    return None


def get_players_by_position(team_id: str, position: str) -> list[dict]:
    """e.g. get_players_by_position('red', 'RB') -> list of matches."""
    return [p for p in get_team(team_id)["players"] if p["position"] == position]


def trait_definition(trait: str) -> Optional[str]:
    """Look up the plain-language meaning of a trait tag."""
    return _TRAITS["strengths"].get(trait) or _TRAITS["weaknesses"].get(trait)


def list_traits() -> dict:
    """{"strengths": {tag: definition}, "weaknesses": {tag: definition}} -
    the full valid tag set, for the player management UI's dropdowns
    (GET /traits) rather than hardcoding the list in the frontend too."""
    return _TRAITS


def find_exploitable_matchups(attacking_team: str, defending_team: str) -> list[dict]:
    """
    Scores every attacker-vs-defender pair between the two rosters and
    returns every mismatch with a positive score (pace mismatch, poor
    tracking back, weak in the air, etc), sorted strongest-first.

    Returning the whole ranked list (not just the winner) lets callers
    rotate through real matchups across repeated calls - see
    match_director_agent.pick_target_matchup, which uses this so
    consecutive drills don't all spotlight the identical defender.

    Restricted to the starting XI (not get_team's full 16-player roster,
    bench included): a drill's focus matchup has to name someone actually
    on the pitch at kickoff, or board_metrics.threat_cover can never find
    the "defender" on the board at all and reports worst-case isolated
    forever - permanently EXPOSED regardless of how well the user plays.
    """
    attackers = [
        p for p in get_starting_xi(attacking_team)
        if p["position"] in ("LM", "RM", "ST")
    ]
    defenders = [
        p for p in get_starting_xi(defending_team)
        if p["position"] in ("LB", "RB", "CB")
    ]

    results = []
    for a in attackers:
        for d in defenders:
            score = 0
            reasons = []
            if "electric_pace" in a["strengths"] and "slow_turning" in d["weaknesses"]:
                score += 3
                reasons.append("pace mismatch in behind")
            if "electric_pace" in a["strengths"] and "poor_tracking_back" in d["weaknesses"]:
                score += 2
                reasons.append("space in the channel when the fullback pushes on")
            if a["stats"]["pace"] - d["stats"]["pace"] > 15:
                score += 1
                reasons.append("raw pace gap")
            if score > 0:
                results.append({
                    "attacker": a["name"], "attacker_id": a["id"],
                    "defender": d["name"], "defender_id": d["id"],
                    "score": score, "reasons": reasons
                })
    # Stable sort: ties keep their original (attacker, defender) iteration
    # order, so find_exploitable_matchup below is unchanged for existing
    # callers - it's just this function's first result.
    results.sort(key=lambda m: m["score"], reverse=True)
    return results


def find_exploitable_matchup(attacking_team: str, defending_team: str) -> dict:
    """
    Core scouting primitive used by the Opponent Manager Agent: the
    single strongest matchup. Returns {} if nothing obvious.

    Deterministic on purpose - this is what the LLM's own scout_matchup
    tool calls when it wants a definitive answer. Callers picking the
    session's *ground-truth* target for a round should use
    pick_rotating_matchup below instead, or every round would name the
    identical defender (see its docstring).
    """
    matchups = find_exploitable_matchups(attacking_team, defending_team)
    return matchups[0] if matchups else {}


def pick_rotating_matchup(
    attacking_team: str, defending_team: str, exclude_defender_ids: set[str] = frozenset()
) -> dict:
    """
    Like find_exploitable_matchup, but rotates: excludes recently-targeted
    defenders when another viable candidate exists, then weights the
    remaining pool toward the stronger mismatches rather than always
    returning the single strongest pair.

    find_exploitable_matchup(s) is a pure function of the two rosters, so
    any caller that used it directly as a round's ground truth kept naming
    the identical defender every time - harmless on its own, but it fed
    ProgressAgent.recurring_weakness() two identical picks after just two
    rounds and permanently latched every later /drill onto that one
    matchup. Both the Match Director (drill design) and the Opponent
    Manager (live scouting) should call this instead.
    """
    candidates = find_exploitable_matchups(attacking_team, defending_team)
    if not candidates:
        return {}
    pool = [c for c in candidates if c["defender_id"] not in exclude_defender_ids] or candidates
    return random.choices(pool, weights=[c["score"] for c in pool], k=1)[0]
