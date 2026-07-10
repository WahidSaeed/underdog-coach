"""
SQLAlchemy models for the turn-based game state.

Two tables: `matches` (one bounded, goal-based playthrough) and `turns`
(one row per turn of that playthrough - board snapshots, rule findings,
coach feedback). See docs/... - the informal source of truth is
agent_instruction.md items 2, 3, 5, 6, 7.

Positions are stored as JSONB per-turn snapshots rather than a normalized
`positions` table: nothing in this app ever needs a cross-turn SQL query,
only "load this turn's board" - JSONB is simpler and sufficient.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Boolean, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MATCH_STATUSES = ("active", "complete_goal", "complete_max_turns", "abandoned")


class Base(DeclarativeBase):
    pass


class PlayerRecord(Base):
    """
    The roster - seeded once from data/players.json (see db/seed.py) and
    read from here for the rest of the app's life once DATABASE_URL is
    configured (tools/player_data.py falls back to the JSON file only
    when it isn't). roster_order preserves the original array order,
    since tools/player_data.STARTING_XI_SIZE (the first 11) vs bench (the
    rest) depends on it and a DB table has no inherent row order.

    photo_url is assigned once at seed time, randomly, from the cropped
    headshots in frontend/public/img/players/ (see db/seed.py) - stable
    afterward, not re-randomized on every request.
    """

    __tablename__ = "players"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team_id: Mapped[str] = mapped_column(String, index=True)
    roster_order: Mapped[int] = mapped_column(Integer)

    num: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    position: Mapped[str] = mapped_column(String)
    stats: Mapped[dict] = mapped_column(JSONB)
    strengths: Mapped[list] = mapped_column(JSONB, default=list)
    weaknesses: Mapped[list] = mapped_column(JSONB, default=list)
    photo_url: Mapped[str | None] = mapped_column(String, nullable=True)


class SessionRound(Base):
    """
    Legacy round/drill history for the free-play /drill + /opponent +
    /coach-feedback flow (unbounded, no target_score/max_turns) - the
    Postgres mirror of what DynamoProgressAgent stored as JSON blobs on a
    single row. Deliberately separate from Match/Turn below: those model
    one bounded, goal-based playthrough (agent_instruction.md items 2/3/5),
    this models the older "keep playing forever" session memory that
    recurring_weakness() reads across many /drill calls under one
    session_id. Kept only so the legacy deploy path (template.yaml,
    DynamoDB) and this local Postgres path behave identically.
    """

    __tablename__ = "session_rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String)  # "round" | "drill"
    formation_code: Mapped[str | None] = mapped_column(String, nullable=True)
    matchup: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(String, index=True)

    user_team_id: Mapped[str] = mapped_column(String, default="blue")
    opponent_team_id: Mapped[str] = mapped_column(String, default="red")

    user_formation_code: Mapped[str] = mapped_column(String)
    user_tactical_stance: Mapped[str] = mapped_column(String)
    opponent_formation_code: Mapped[str] = mapped_column(String)
    opponent_tactical_stance: Mapped[str] = mapped_column(String)

    # Set once at /match/start from match_director_agent.design_drill and
    # reused by every /opponent + /coach-feedback call for the rest of the
    # match - one match is one drill/scenario, same relationship the old
    # free-play flow had between one /drill call and however many
    # /opponent + /coach-feedback rounds followed it.
    scenario: Mapped[str] = mapped_column(String)
    coaching_goal: Mapped[str] = mapped_column(String)
    focus_matchup: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Turn number of the user's most recent formation change (see
    # tools/grid_movement.FORMATION_CHANGE_COOLDOWN) - None means never
    # changed, so it's available immediately.
    formation_changed_at_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Substitutions (agent_instruction.md follow-up: "up to 15 players on
    # the bench... replace any on-field player with one on the bench").
    # bench_player_ids is fixed at match creation (tools/player_data.get_bench);
    # subbed_off_ids accumulates any player_id - original starter or a
    # substitute already brought on - that has been substituted OFF and so
    # can never return, matching real law. "Currently available to bring
    # on" = bench_player_ids - subbed_off_ids - whoever is on the board now.
    bench_player_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    subbed_off_ids: Mapped[list] = mapped_column(JSONB, default=list)
    subs_used: Mapped[int] = mapped_column(Integer, default=0)

    target_score: Mapped[int] = mapped_column(Integer)
    max_turns: Mapped[int] = mapped_column(Integer)
    turn_count: Mapped[int] = mapped_column(Integer, default=0)

    score_good: Mapped[int] = mapped_column(Integer, default=0)
    score_bad: Mapped[int] = mapped_column(Integer, default=0)
    score_neutral: Mapped[int] = mapped_column(Integer, default=0)
    total_score: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String, default="active")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    turns: Mapped[list["Turn"]] = relationship(back_populates="match", order_by="Turn.turn_number")


class Turn(Base):
    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("matches.id"), index=True)
    turn_number: Mapped[int] = mapped_column(Integer)

    blue_moves: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    red_moves: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    blue_board: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    red_board: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Moves the user proposed this turn that grid_movement.validate_move
    # rejected (illegal jump, occupied slot, ...) - kept so the score
    # applied once at /coach-feedback can include the illegal-move
    # penalty (tools/scoring.py) without double-counting.
    rejected_move_count: Mapped[int] = mapped_column(Integer, default=0)
    # True if this turn's action was a formation change (see /turn in
    # main.py) rather than a swap - scoring.py applies
    # FORMATION_CHANGE_PENALTY once, at /coach-feedback, same pattern as
    # rejected_move_count above.
    formation_changed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when this turn's action was a substitution instead of a swap or
    # formation change - like-for-like (same line/slot/role), no score
    # penalty, just consumes the turn's action and one of the 5 subs.
    substitution_out_id: Mapped[str | None] = mapped_column(String, nullable=True)
    substitution_in_id: Mapped[str | None] = mapped_column(String, nullable=True)

    target_matchup: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rule_findings: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    verdict: Mapped[str | None] = mapped_column(String, nullable=True)
    score_delta: Mapped[int] = mapped_column(Integer, default=0)

    short_feedback: Mapped[str | None] = mapped_column(String, nullable=True)
    detailed_feedback: Mapped[str | None] = mapped_column(String, nullable=True)
    opponent_narrative: Mapped[str | None] = mapped_column(String, nullable=True)
    opponent_instruction: Mapped[str | None] = mapped_column(String, nullable=True)

    degraded: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    match: Mapped["Match"] = relationship(back_populates="turns")
