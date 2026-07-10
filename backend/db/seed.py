"""
One-time seed of the `players` table from data/players.json, run at
FastAPI startup (see main.py's lifespan) right after init_db(). No-op if
the table already has rows - same hackathon-speed, no-migration-tool
tradeoff as db/session.py: reseeding after a data change means dropping
the table, not an upgrade path.

Assigns each of the 32 players one of the 32 cropped headshots in
frontend/public/img/players/ (p01.png..p32.png) via a single random
shuffle across both rosters combined - stable once seeded, never
re-randomized on restart.
"""

import json
import random
from pathlib import Path

from sqlalchemy import select

from db.models import PlayerRecord
from db.session import get_session

# Same two-layout convention as tools/player_data.py's DATA_DIR.
_DATA_CANDIDATES = [
    Path(__file__).resolve().parent.parent.parent / "data",
    Path(__file__).resolve().parent.parent / "data",
]
_DATA_DIR = next((p for p in _DATA_CANDIDATES if p.exists()), _DATA_CANDIDATES[-1])

PHOTO_COUNT = 32
PHOTO_URLS = [f"/img/players/p{i:02d}.png" for i in range(1, PHOTO_COUNT + 1)]


def seed_players_if_empty() -> None:
    with get_session() as db:
        if db.execute(select(PlayerRecord.id).limit(1)).first() is not None:
            return

        with open(_DATA_DIR / "players.json") as f:
            teams = json.load(f)["teams"]

        photos = PHOTO_URLS.copy()
        random.shuffle(photos)
        photo_iter = iter(photos)

        for team_id, team in teams.items():
            for order, p in enumerate(team["players"]):
                db.add(PlayerRecord(
                    id=p["id"], team_id=team_id, roster_order=order,
                    num=p["num"], name=p["name"], position=p["position"],
                    stats=p["stats"],
                    strengths=p.get("strengths", []), weaknesses=p.get("weaknesses", []),
                    photo_url=next(photo_iter, None),
                ))
        db.commit()
