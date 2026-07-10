"""
CRUD for the `players` table (db/models.PlayerRecord) - backs the player
management endpoints in main.py (POST/PATCH/DELETE /players...).

Only meaningful once DATABASE_URL is configured (db/session.database_configured) -
there's no write path for the JSON-file fallback tools/player_data.py uses
otherwise, so callers must check that first (main.py does).
"""

import random
import re
from typing import Optional

from sqlalchemy import select

from db.models import PlayerRecord
from db.seed import PHOTO_URLS
from db.session import get_session


class PlayerNotFound(Exception):
    pass


def _record_to_dict(r: PlayerRecord) -> dict:
    return {
        "id": r.id, "team_id": r.team_id, "num": r.num, "name": r.name,
        "position": r.position, "stats": r.stats,
        "strengths": r.strengths, "weaknesses": r.weaknesses,
        "photo_url": r.photo_url,
    }


def _next_id(db, team_id: str) -> str:
    """b1..b16 / r1..r16 today - the next id is prefix + (highest existing
    numeric suffix for this team + 1), so ids stay unique and sortable
    even after deletes leave gaps."""
    prefix = team_id[0]
    rows = db.execute(select(PlayerRecord.id).filter_by(team_id=team_id)).scalars().all()
    highest = 0
    for pid in rows:
        m = re.match(rf"^{prefix}(\d+)$", pid)
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{prefix}{highest + 1}"


def create_player(
    *, team_id: str, num: int, name: str, position: str,
    stats: dict, strengths: list[str] | None = None, weaknesses: list[str] | None = None,
) -> dict:
    """New players are always appended after the current roster (so they
    land on the bench, not the starting XI - see
    tools/player_data.STARTING_XI_SIZE) and get a random photo from the
    same 32-headshot pool db/seed.py assigns from at initial seed time."""
    with get_session() as db:
        max_order = db.execute(
            select(PlayerRecord.roster_order).filter_by(team_id=team_id).order_by(PlayerRecord.roster_order.desc()).limit(1)
        ).scalar()
        record = PlayerRecord(
            id=_next_id(db, team_id), team_id=team_id,
            roster_order=(max_order or -1) + 1,
            num=num, name=name, position=position, stats=stats,
            strengths=strengths or [], weaknesses=weaknesses or [],
            photo_url=random.choice(PHOTO_URLS),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _record_to_dict(record)


def update_player(
    player_id: str, *, num: Optional[int] = None, name: Optional[str] = None,
    position: Optional[str] = None, stats: Optional[dict] = None,
    strengths: Optional[list[str]] = None, weaknesses: Optional[list[str]] = None,
) -> dict:
    """Only overwrites fields actually passed - None means "leave as is",
    not "clear it" (strengths/weaknesses use None the same way; pass an
    empty list to actually clear one)."""
    with get_session() as db:
        record = db.get(PlayerRecord, player_id)
        if record is None:
            raise PlayerNotFound(player_id)
        if num is not None:
            record.num = num
        if name is not None:
            record.name = name
        if position is not None:
            record.position = position
        if stats is not None:
            record.stats = stats
        if strengths is not None:
            record.strengths = strengths
        if weaknesses is not None:
            record.weaknesses = weaknesses
        db.commit()
        db.refresh(record)
        return _record_to_dict(record)


def delete_player(player_id: str) -> None:
    with get_session() as db:
        record = db.get(PlayerRecord, player_id)
        if record is None:
            raise PlayerNotFound(player_id)
        db.delete(record)
        db.commit()
