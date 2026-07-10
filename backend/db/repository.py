"""
Postgres-backed stores used by backend/main.py.

PostgresProgressStore implements the same informal interface as
ProgressAgent/DynamoProgressAgent (scenario_and_progress_agents.py) so
get_progress_agent() can swap it in without touching any agent code -
see that module's docstring for why the interface looks the way it does.

The Match/Turn functions below back the new bounded, goal-based game loop
(/match/start, /turn, /opponent, /coach-feedback - see backend/main.py):
one Postgres row per match, one row per turn, turn 0 holding the starting
position before any move has been made.
"""

import uuid

from db.models import Match, SessionRound, Turn
from db.session import get_session


class MatchNotFound(Exception):
    pass


def create_match(
    *, session_id: str, user_team_id: str, opponent_team_id: str,
    user_formation_code: str, user_tactical_stance: str,
    opponent_formation_code: str, opponent_tactical_stance: str,
    scenario: str, coaching_goal: str, focus_matchup: dict | None,
    target_score: int, max_turns: int,
    blue_board: list[dict], red_board: list[dict],
    bench_player_ids: list[str] | None = None,
) -> Match:
    with get_session() as db:
        match = Match(
            session_id=session_id, user_team_id=user_team_id, opponent_team_id=opponent_team_id,
            user_formation_code=user_formation_code, user_tactical_stance=user_tactical_stance,
            opponent_formation_code=opponent_formation_code, opponent_tactical_stance=opponent_tactical_stance,
            scenario=scenario, coaching_goal=coaching_goal, focus_matchup=focus_matchup,
            target_score=target_score, max_turns=max_turns,
            bench_player_ids=bench_player_ids or [],
        )
        db.add(match)
        db.flush()  # assigns match.id
        db.add(Turn(
            match_id=match.id, turn_number=0, target_matchup=focus_matchup,
            blue_moves=[], red_moves=[], blue_board=blue_board, red_board=red_board,
        ))
        db.commit()
        db.refresh(match)
        return match


def get_match(match_id: str) -> Match:
    with get_session() as db:
        match = db.get(Match, uuid.UUID(str(match_id)))
        if match is None:
            raise MatchNotFound(match_id)
        return match


def get_latest_turn(match_id: str) -> Turn:
    with get_session() as db:
        turn = (
            db.query(Turn)
            .filter_by(match_id=uuid.UUID(str(match_id)))
            .order_by(Turn.turn_number.desc())
            .first()
        )
        if turn is None:
            raise MatchNotFound(match_id)
        return turn


def get_turn(match_id: str, turn_number: int) -> Turn:
    with get_session() as db:
        turn = (
            db.query(Turn)
            .filter_by(match_id=uuid.UUID(str(match_id)), turn_number=turn_number)
            .first()
        )
        if turn is None:
            raise MatchNotFound(f"{match_id} turn {turn_number}")
        return turn


def create_turn(
    *, match_id: str, turn_number: int, blue_moves: list[dict], blue_board: list[dict],
    rejected_move_count: int = 0, rule_findings: list[dict] | None = None,
    formation_changed: bool = False,
    substitution_out_id: str | None = None, substitution_in_id: str | None = None,
) -> Turn:
    with get_session() as db:
        turn = Turn(
            match_id=uuid.UUID(str(match_id)), turn_number=turn_number,
            blue_moves=blue_moves, blue_board=blue_board,
            rejected_move_count=rejected_move_count, rule_findings=rule_findings,
            formation_changed=formation_changed,
            substitution_out_id=substitution_out_id, substitution_in_id=substitution_in_id,
        )
        db.add(turn)
        db.commit()
        db.refresh(turn)
        return turn


def apply_formation_change(match_id: str, *, formation_code: str, turn_number: int) -> Match:
    with get_session() as db:
        match = db.get(Match, uuid.UUID(str(match_id)))
        if match is None:
            raise MatchNotFound(match_id)
        match.user_formation_code = formation_code
        match.formation_changed_at_turn = turn_number
        db.commit()
        db.refresh(match)
        return match


def apply_substitution(match_id: str, *, player_id_out: str) -> Match:
    with get_session() as db:
        match = db.get(Match, uuid.UUID(str(match_id)))
        if match is None:
            raise MatchNotFound(match_id)
        match.subs_used += 1
        match.subbed_off_ids = [*match.subbed_off_ids, player_id_out]
        db.commit()
        db.refresh(match)
        return match


def update_turn(turn_id: int, **fields) -> Turn:
    with get_session() as db:
        turn = db.get(Turn, turn_id)
        if turn is None:
            raise MatchNotFound(f"turn {turn_id}")
        for key, value in fields.items():
            setattr(turn, key, value)
        db.commit()
        db.refresh(turn)
        return turn


def apply_match_score(match_id: str, *, good: int, bad: int, neutral: int, delta: int, status: str) -> Match:
    with get_session() as db:
        match = db.get(Match, uuid.UUID(str(match_id)))
        if match is None:
            raise MatchNotFound(match_id)
        match.turn_count += 1
        match.score_good += good
        match.score_bad += bad
        match.score_neutral += neutral
        match.total_score += delta
        match.status = status
        if status != "active":
            from sqlalchemy import func
            match.ended_at = func.now()
        db.commit()
        db.refresh(match)
        return match


class PostgresProgressStore:
    def __init__(self, session_id: str):
        self.session_id = session_id

    def log_round(self, formation_code: str, exploited_matchup: dict):
        with get_session() as db:
            db.add(SessionRound(
                session_id=self.session_id, kind="round",
                formation_code=formation_code, matchup=exploited_matchup or {},
            ))
            db.commit()

    def recurring_weakness(self, window: int = 6, threshold: int = 3) -> dict | None:
        """Returns the matchup exploited `threshold`+ times in the last
        `window` rounds - see ProgressAgent.recurring_weakness's docstring
        for why this is windowed (not all-time) and why threshold is 3
        (not 2, given the exploitable-matchup pool only has 3 distinct
        defenders)."""
        with get_session() as db:
            rows = (
                db.query(SessionRound)
                .filter_by(session_id=self.session_id, kind="round")
                .order_by(SessionRound.id.desc())
                .limit(window)
                .all()
            )
        seen: dict[str, int] = {}
        for row in reversed(rows):
            key = (row.matchup or {}).get("defender_id")
            if not key:
                continue
            seen[key] = seen.get(key, 0) + 1
            if seen[key] >= threshold:
                return row.matchup
        return None

    def record_drill(self, matchup: dict):
        if not matchup:
            return
        with get_session() as db:
            db.add(SessionRound(session_id=self.session_id, kind="drill", matchup=matchup))
            db.commit()

    def recent_drill_defenders(self, n: int = 2) -> set:
        with get_session() as db:
            rows = (
                db.query(SessionRound)
                .filter_by(session_id=self.session_id, kind="drill")
                .order_by(SessionRound.id.desc())
                .limit(n)
                .all()
            )
        return {r.matchup.get("defender_id") for r in rows if r.matchup and r.matchup.get("defender_id")}

    def recent_round_defenders(self, n: int = 1) -> set:
        with get_session() as db:
            rows = (
                db.query(SessionRound)
                .filter_by(session_id=self.session_id, kind="round")
                .order_by(SessionRound.id.desc())
                .limit(n)
                .all()
            )
        return {r.matchup.get("defender_id") for r in rows if r.matchup and r.matchup.get("defender_id")}
