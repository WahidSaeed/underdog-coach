"""
Engine + session factory for the local-dev Postgres store (docker-compose.yml).

Sync SQLAlchemy on purpose: every route in backend/main.py is `def`, not
`async def`, and Strands agent calls are sync too - an async engine here
would be the only async code path in the whole backend for no benefit.

No Alembic: `Base.metadata.create_all` runs once at FastAPI startup
(see main.py's lifespan). Hackathon-speed tradeoff, stated explicitly -
no migration history, no safe column changes without a manual
drop/recreate during development.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.models import Base

_engine = None
_SessionLocal: sessionmaker | None = None


def _get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set - copy backend/.env.example to "
                "backend/.env and fill it in, and make sure "
                "`docker compose up -d postgres` has been run."
            )
        _engine = create_engine(database_url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def init_db() -> None:
    """Creates all tables if they don't exist yet. Called once at FastAPI startup."""
    Base.metadata.create_all(_get_engine())


def get_session() -> Session:
    """Callers are responsible for closing (use as a context manager)."""
    _get_engine()
    assert _SessionLocal is not None
    return _SessionLocal()


def database_configured() -> bool:
    return bool(os.environ.get("DATABASE_URL"))
