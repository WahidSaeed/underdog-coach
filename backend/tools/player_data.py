"""
Player data tool.

This is the grounding layer every agent calls into instead of guessing
football knowledge from the model's own memory. Judges will probe
"why did the agent make that call" - the answer should always trace
back to a concrete stat or trait from here, not vibes.

Swap the JSON file read for a DynamoDB table read for the real deployment;
the function signatures below are what the agents depend on, so the
storage backend underneath can change without touching agent code.
"""

import json
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


def get_team(team_id: str) -> dict:
    """Return full roster + metadata for 'blue' or 'red'."""
    return _PLAYER_DB[team_id]


def get_player(team_id: str, player_id: str) -> Optional[dict]:
    """Return a single player's stat block and traits."""
    for p in _PLAYER_DB[team_id]["players"]:
        if p["id"] == player_id:
            return p
    return None

def get_players_by_position(team_id: str, position: str) -> list[dict]:
    """e.g. get_players_by_position('red', 'RB') -> list of matches."""
    return [p for p in _PLAYER_DB[team_id]["players"] if p["position"] == position]


def trait_definition(trait: str) -> Optional[str]:
    """Look up the plain-language meaning of a trait tag."""
    return _TRAITS["strengths"].get(trait) or _TRAITS["weaknesses"].get(trait)


def find_exploitable_matchup(attacking_team: str, defending_team: str) -> dict:
    """
    Core scouting primitive used by the Opponent Manager Agent.

    Looks for defenders on defending_team who are tagged with a
    weakness a winger/forward on attacking_team can exploit
    (pace mismatch, poor tracking back, weak in the air, etc).
    Returns the strongest matchup found, or {} if nothing obvious.
    """
    attackers = [
        p for p in _PLAYER_DB[attacking_team]["players"]
        if p["position"] in ("LM", "RM", "ST")
    ]
    defenders = [
        p for p in _PLAYER_DB[defending_team]["players"]
        if p["position"] in ("LB", "RB", "CB")
    ]

    best = {}
    best_score = -1
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
            if score > best_score:
                best_score = score
                best = {
                    "attacker": a["name"], "attacker_id": a["id"],
                    "defender": d["name"], "defender_id": d["id"],
                    "score": score, "reasons": reasons
                }
    return best if best_score > 0 else {}
