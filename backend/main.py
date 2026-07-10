"""
API entry point.

Endpoints the frontend calls. Deploy this behind API Gateway + Lambda
(or as a small ECS service) for the real hackathon build; run locally
with `uvicorn main:app --reload` during development.

/opponent and /coach-feedback are split (rather than one /coach call)
because API Gateway's HTTP API integration has a hard ~29-30s timeout
and each step can involve multiple Bedrock tool-call round-trips - two
sequential calls from the same Lambda invocation risk blowing that
budget. Splitting also lets the UI show the opponent's plan while the
coach is still "thinking".
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import coach_agent, match_director_agent, opponent_manager_agent
from agents.scenario_and_progress_agents import get_progress_agent
from db import player_repository, repository
from db.player_repository import PlayerNotFound
from db.repository import MatchNotFound
from tools import board_metrics, coaching_advice, grid_movement, player_data, rules_engine, scoring, strategy_catalog

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Creates the Postgres tables (players/matches/turns/session_rounds)
    # and seeds the roster from data/players.json if DATABASE_URL is
    # configured - no-op on the DynamoDB/in-memory deploy paths. See
    # backend/db/session.py for why there's no migration tool.
    if os.environ.get("DATABASE_URL"):
        from db.session import init_db
        from db.seed import seed_players_if_empty
        init_db()
        seed_players_if_empty()
    yield


app = FastAPI(title="Underdog Coach API", lifespan=_lifespan)

# API Gateway's own CORS config (template.yaml) covers the deployed
# stack; this covers `uvicorn main:app --reload` during local dev, where
# the frontend calls this process directly with no API Gateway in front.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type"],
)

# get_progress_agent() returns a DynamoDB-backed session tracker when
# SESSION_TABLE is set (Lambda deploy), otherwise an in-memory one for
# local dev.
_sessions: dict[str, object] = {}


def _get_session(session_id: str):
    return _sessions.setdefault(session_id, get_progress_agent(session_id))


def _call_with_one_retry(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        logger.warning("agent call failed once, retrying: %s", exc)
        return fn(*args, **kwargs)


def _compute_emotion(matchup: dict, width_spread: float, avg_def_line: float, metrics: dict | None = None) -> str:
    """
    Deterministic severity -> emotion mapping, ported from
    frontend/lib/engine.ts (evaluateBoard). Kept server-side and
    deterministic on purpose - the LLM is not asked to grade its own plan.
    """
    severity = 0
    if matchup:
        severity += matchup.get("score", 0)
    if width_spread < 55:
        severity += 1
    if avg_def_line < 68:
        severity += 1

    if metrics is not None:
        # A drill is active and we have real cover data - let it move the
        # avatar's read, same deterministic-severity idea as above.
        severity -= min(metrics.get("helpers_within_15", 0), 2)
        if metrics.get("isolated"):
            severity += 1

    if severity >= 4:
        return "angry"
    if severity >= 2:
        return "worried"
    if severity == 1:
        return "explaining"
    return "celebrating"


def _board_geometry(board: list[dict]) -> dict:
    """Server-side port of frontend/lib/engine.ts's boardGeometry - the
    client used to compute and send this; now the server is authoritative
    for board state, so it computes its own."""
    outfield = [p for p in board if p.get("role") != "GK"]
    xs = [p["x"] for p in outfield]
    width_spread = (max(xs) - min(xs)) if xs else 0.0
    defenders = [p for p in board if p.get("role") == "DEF"]
    avg_def_line = (sum(p["y"] for p in defenders) / len(defenders)) if defenders else 0.0
    return {"width_spread": width_spread, "avg_def_line": avg_def_line}


def _to_metrics_board(blue_board: list[dict], red_board: list[dict]) -> dict:
    return {
        "blue": [{"id": p["player_id"], "x": p["x"], "y": p["y"]} for p in blue_board],
        "red": [{"id": p["player_id"], "x": p["x"], "y": p["y"]} for p in red_board],
    }


def _apply_moves(board: list[dict], moves: list[dict]) -> list[dict]:
    """Applies a list of {player_id, to_line, to_slot, to_x, to_y} moves
    (grid_movement.Move shape) onto a copy of `board`."""
    by_id = {p["player_id"]: dict(p) for p in board}
    for mv in moves:
        pawn = by_id.get(mv["player_id"])
        if pawn is None:
            continue
        pawn["line"], pawn["slot"] = mv["to_line"], mv["to_slot"]
        pawn["x"], pawn["y"] = mv["to_x"], mv["to_y"]
    return list(by_id.values())


def _formation_status(match) -> dict:
    available, available_at_turn = grid_movement.formation_change_available(
        match.turn_count, match.formation_changed_at_turn
    )
    return {"current": match.user_formation_code, "available": available, "available_at_turn": available_at_turn}


def _bench_status(match, board: list[dict]) -> dict:
    board_ids = {p["player_id"] for p in board}
    subbed_off = set(match.subbed_off_ids or [])
    available_ids = [
        pid for pid in (match.bench_player_ids or []) if pid not in subbed_off and pid not in board_ids
    ]
    return {
        "available_ids": available_ids,
        "subbed_off_ids": sorted(subbed_off),
        "subs_used": match.subs_used,
        "subs_remaining": max(0, grid_movement.MAX_SUBSTITUTIONS - match.subs_used),
        "max_subs": grid_movement.MAX_SUBSTITUTIONS,
    }


class MatchStartPayload(BaseModel):
    session_id: str
    user_team: str = "blue"
    opponent_team: str = "red"


class MoveIn(BaseModel):
    player_id: str
    to_line: int
    to_slot: int


class SubstitutionIn(BaseModel):
    player_id_out: str
    player_id_in: str


class TurnPayload(BaseModel):
    match_id: str
    moves: list[MoveIn] = []
    # Alternative to `moves`: reshape the whole team onto a new formation
    # instead of proposing a swap - see grid_movement.FORMATION_CHANGE_COOLDOWN.
    # Mutually exclusive with `moves` and `substitution`.
    formation_change: str | None = None
    # Alternative to `moves`/`formation_change`: bring on a bench player
    # for an on-field one, same spot - see grid_movement.MAX_SUBSTITUTIONS.
    # Mutually exclusive with the other two.
    substitution: SubstitutionIn | None = None


class MatchIdPayload(BaseModel):
    match_id: str


# Same 8 labels tools/grid_movement.POS_BY_LINE's slot templates and
# data/players.json actually use - not every formation places every
# label, but a player outside this set can never fill any formation slot.
VALID_POSITIONS = {"GK", "CB", "RB", "LB", "CM", "RM", "LM", "ST"}


def _require_db():
    from db.session import database_configured
    if not database_configured():
        raise HTTPException(409, "player management requires DATABASE_URL (Postgres) to be configured")


class PlayerCreatePayload(BaseModel):
    team_id: str
    num: int
    name: str
    position: str
    stats: dict[str, int]
    strengths: list[str] = []
    weaknesses: list[str] = []


class PlayerUpdatePayload(BaseModel):
    num: int | None = None
    name: str | None = None
    position: str | None = None
    stats: dict[str, int] | None = None
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None


@app.get("/roster/{team_id}")
def roster(team_id: str):
    return player_data.get_team(team_id)


@app.get("/traits")
def traits():
    return player_data.list_traits()


@app.post("/players")
def create_player(payload: PlayerCreatePayload):
    """Add a new player to a team's roster (bench by default - see
    player_repository.create_player's docstring). photo_url is always a
    random pick from the same 32-headshot pool db/seed.py uses, never
    user-supplied."""
    _require_db()
    if payload.team_id not in ("blue", "red"):
        raise HTTPException(400, f"unknown team_id {payload.team_id!r}")
    if payload.position not in VALID_POSITIONS:
        raise HTTPException(400, f"unknown position {payload.position!r} - must be one of {sorted(VALID_POSITIONS)}")
    return player_repository.create_player(
        team_id=payload.team_id, num=payload.num, name=payload.name, position=payload.position,
        stats=payload.stats, strengths=payload.strengths, weaknesses=payload.weaknesses,
    )


@app.patch("/players/{player_id}")
def update_player(player_id: str, payload: PlayerUpdatePayload):
    _require_db()
    if payload.position is not None and payload.position not in VALID_POSITIONS:
        raise HTTPException(400, f"unknown position {payload.position!r} - must be one of {sorted(VALID_POSITIONS)}")
    try:
        return player_repository.update_player(
            player_id, num=payload.num, name=payload.name, position=payload.position,
            stats=payload.stats, strengths=payload.strengths, weaknesses=payload.weaknesses,
        )
    except PlayerNotFound:
        raise HTTPException(404, f"player {player_id!r} not found")


@app.delete("/players/{player_id}")
def delete_player(player_id: str):
    _require_db()
    try:
        player_repository.delete_player(player_id)
    except PlayerNotFound:
        raise HTTPException(404, f"player {player_id!r} not found")
    return {"deleted": player_id}


@app.post("/match/start")
def match_start(payload: MatchStartPayload):
    """
    Starts a bounded, goal-based match (agent_instruction.md items 2, 3, 5):
    both sides' opening formation/tactical stance are drawn randomly from
    tools/strategy_catalog.py, the starting board is placed on the fixed
    slot grid (tools/grid_movement.py), and match_director_agent supplies
    the scenario/coaching-goal prose - it no longer picks a formation
    (see match_director_agent.DrillBrief's docstring).
    """
    user_strategy = strategy_catalog.random_strategy()
    opponent_strategy = strategy_catalog.random_strategy()
    session = _get_session(payload.session_id)

    try:
        brief = _call_with_one_retry(
            match_director_agent.design_drill,
            session=session,
            user_team_id=payload.user_team,
            opponent_team_id=payload.opponent_team,
            difficulty="medium",
        )
        degraded = not brief.get("structured_ok", True)
    except Exception as exc:
        logger.error("match director agent failed twice, degrading: %s", exc)
        target_matchup = match_director_agent.pick_target_matchup(
            session, payload.user_team, payload.opponent_team
        )
        brief = match_director_agent.heuristic_fallback(
            user_team_id=payload.user_team,
            opponent_team_id=payload.opponent_team,
            target_matchup=target_matchup,
        )
        degraded = True

    blue_roster = player_data.get_starting_xi(payload.user_team)
    red_roster = player_data.get_starting_xi(payload.opponent_team)
    blue_board = grid_movement.build_board(user_strategy["formation_code"], blue_roster, "blue")
    red_board = grid_movement.build_board(opponent_strategy["formation_code"], red_roster, "red")

    match = repository.create_match(
        session_id=payload.session_id,
        user_team_id=payload.user_team, opponent_team_id=payload.opponent_team,
        user_formation_code=user_strategy["formation_code"], user_tactical_stance=user_strategy["tactical_stance"],
        opponent_formation_code=opponent_strategy["formation_code"],
        opponent_tactical_stance=opponent_strategy["tactical_stance"],
        scenario=brief["scenario"], coaching_goal=brief["coaching_goal"], focus_matchup=brief["focus_matchup"] or None,
        target_score=scoring.DEFAULT_TARGET_SCORE, max_turns=scoring.DEFAULT_MAX_TURNS,
        blue_board=blue_board, red_board=red_board,
        bench_player_ids=[p["id"] for p in player_data.get_bench(payload.user_team)],
    )

    return {
        "match_id": str(match.id),
        "user_strategy": user_strategy,
        "opponent_strategy": opponent_strategy,
        "scenario": brief["scenario"],
        "coaching_goal": brief["coaching_goal"],
        "focus_note": brief["focus_note"],
        "focus_matchup": brief["focus_matchup"] or {},
        "target_score": match.target_score,
        "max_turns": match.max_turns,
        "blue_board": blue_board,
        "red_board": red_board,
        "formation_status": _formation_status(match),
        "bench_status": _bench_status(match, blue_board),
        "degraded": degraded,
        "tool_calls": brief.get("tool_calls", []),
    }


@app.post("/turn")
def turn(payload: TurnPayload):
    """
    Commits the user's action for this turn (agent_instruction.md items 2,
    4: deterministic, adjacent-slot-only movement is the only hard
    legality check in the whole system, see tools/grid_movement.validate_move)
    - either a swap (`moves`) or, rarely, a full formation change
    (`formation_change`, gated by grid_movement.FORMATION_CHANGE_COOLDOWN
    and scored via scoring.FORMATION_CHANGE_PENALTY). Fast, no LLM call -
    see the module docstring for why /opponent and /coach-feedback stay
    separate calls.
    """
    try:
        match = repository.get_match(payload.match_id)
        latest = repository.get_latest_turn(payload.match_id)
    except MatchNotFound:
        raise HTTPException(404, "match not found")

    if match.status != "active":
        raise HTTPException(409, f"match is already {match.status}")
    if latest.turn_number > 0 and latest.red_board is None:
        raise HTTPException(409, "previous turn not finished - call /opponent and /coach-feedback first")

    actions_given = sum(x is not None for x in (payload.formation_change, payload.substitution))
    if actions_given > 1:
        raise HTTPException(400, "only one of formation_change, substitution is allowed per turn")

    substitution_out_id = substitution_in_id = None

    if payload.formation_change is not None:
        if payload.moves:
            raise HTTPException(400, "cannot submit moves and formation_change in the same turn")
        if payload.formation_change not in grid_movement.LINES:
            raise HTTPException(400, f"unknown formation_code {payload.formation_change!r}")
        available, available_at_turn = grid_movement.formation_change_available(
            match.turn_count, match.formation_changed_at_turn
        )
        if not available:
            raise HTTPException(409, f"formation change not available until turn {available_at_turn}")

        # Whoever is CURRENTLY on the pitch, not the static starting XI -
        # a formation change after a substitution must keep the sub on,
        # not silently revert to the player they replaced.
        active_roster = [player_data.get_player(match.user_team_id, p["player_id"]) for p in latest.blue_board]
        new_blue_board = grid_movement.build_board(payload.formation_change, active_roster, "blue")
        accepted_moves, rejected_moves = [], []
        match = repository.apply_formation_change(
            payload.match_id, formation_code=payload.formation_change, turn_number=latest.turn_number + 1
        )
    elif payload.substitution is not None:
        if payload.moves:
            raise HTTPException(400, "cannot submit moves and substitution in the same turn")
        sub = payload.substitution
        if match.subs_used >= grid_movement.MAX_SUBSTITUTIONS:
            raise HTTPException(409, f"no substitutions remaining ({match.subs_used}/{grid_movement.MAX_SUBSTITUTIONS} used)")
        bench_status = _bench_status(match, latest.blue_board)
        if sub.player_id_in not in bench_status["available_ids"]:
            raise HTTPException(400, f"{sub.player_id_in} is not an available substitute")
        new_blue_board = grid_movement.substitute_player(latest.blue_board, sub.player_id_out, sub.player_id_in)
        if new_blue_board is None:
            raise HTTPException(400, f"{sub.player_id_out} is not currently on the pitch")
        accepted_moves, rejected_moves = [], []
        substitution_out_id, substitution_in_id = sub.player_id_out, sub.player_id_in
        match = repository.apply_substitution(payload.match_id, player_id_out=sub.player_id_out)
    else:
        proposed = [m.model_dump() for m in payload.moves]
        accepted_moves, rejected_moves, new_blue_board = grid_movement.resolve_turn_moves(
            match.user_formation_code, latest.blue_board, proposed, side="blue",
        )

    # Preview against red's board as it stood before this turn's reaction -
    # /opponent recomputes the authoritative findings once red has moved.
    rule_findings = rules_engine.evaluate_turn(new_blue_board, latest.red_board, latest.target_matchup)

    new_turn = repository.create_turn(
        match_id=payload.match_id, turn_number=latest.turn_number + 1,
        substitution_out_id=substitution_out_id, substitution_in_id=substitution_in_id,
        blue_moves=accepted_moves, blue_board=new_blue_board,
        rejected_move_count=len(rejected_moves), rule_findings=rule_findings,
        formation_changed=payload.formation_change is not None,
    )

    return {
        "turn_number": new_turn.turn_number,
        "accepted_moves": accepted_moves,
        "rejected_moves": rejected_moves,
        "blue_board": new_blue_board,
        "rule_findings": rule_findings,
        "formation_status": _formation_status(match),
        "bench_status": _bench_status(match, new_blue_board),
        "score": {
            "good": match.score_good, "bad": match.score_bad, "neutral": match.score_neutral,
            "total": match.total_score, "turns_taken": match.turn_count,
            "target_score": match.target_score, "max_turns": match.max_turns,
        },
        "match_status": match.status,
    }


@app.post("/opponent")
def opponent(payload: MatchIdPayload):
    try:
        match = repository.get_match(payload.match_id)
        current = repository.get_latest_turn(payload.match_id)
    except MatchNotFound:
        raise HTTPException(404, "match not found")

    if match.status != "active":
        raise HTTPException(409, f"match is already {match.status}")
    if current.turn_number == 0:
        raise HTTPException(409, "call /turn before /opponent")

    prev = repository.get_turn(payload.match_id, current.turn_number - 1)
    blue_board = current.blue_board
    red_board_prev = prev.red_board

    geometry = _board_geometry(blue_board)
    user_formation = {"code": match.user_formation_code, **geometry}
    drill_context = {"scenario": match.scenario, "coaching_goal": match.coaching_goal, "focus_matchup": match.focus_matchup or {}}

    metrics = None
    if match.focus_matchup:
        metrics = board_metrics.threat_cover(_to_metrics_board(blue_board, red_board_prev), match.focus_matchup)

    session = _get_session(match.session_id)

    try:
        strategy = _call_with_one_retry(
            opponent_manager_agent.decide_counter_strategy,
            user_formation=user_formation,
            user_team_id=match.user_team_id,
            opponent_team_id=match.opponent_team_id,
            drill=drill_context,
            metrics=metrics,
            session=session,
            grid_formation_code=match.opponent_formation_code,
            red_pawns=red_board_prev,
            blue_pawns=blue_board,
        )
        degraded = not strategy.get("structured_ok", True)
    except Exception as exc:
        logger.error("opponent agent failed twice, degrading: %s", exc)
        target_matchup = player_data.pick_rotating_matchup(
            match.opponent_team_id, match.user_team_id, exclude_defender_ids=session.recent_round_defenders(n=2)
        )
        strategy = opponent_manager_agent.heuristic_fallback(user_formation=user_formation, target_matchup=target_matchup)
        strategy["moves"] = grid_movement.plan_opponent_moves(
            match.opponent_formation_code, red_board_prev, target_matchup, blue_board,
        )
        degraded = True

    matchup = strategy["target_matchup"]
    session.log_round(match.user_formation_code, matchup)
    recurring = session.recurring_weakness()

    moves = strategy.get("moves", [])
    new_red_board = _apply_moves(red_board_prev, moves)
    rule_findings = rules_engine.evaluate_turn(blue_board, new_red_board, matchup or match.focus_matchup)
    emotion = _compute_emotion(matchup, geometry["width_spread"], geometry["avg_def_line"], metrics)

    repository.update_turn(
        current.id,
        red_moves=moves, red_board=new_red_board,
        opponent_narrative=strategy["narrative"], opponent_instruction=strategy["instruction"],
        target_matchup=matchup or {}, rule_findings=rule_findings, degraded=degraded,
    )

    return {
        "opponent": {
            "formation_code": strategy["formation_code"],
            "instruction": strategy["instruction"],
            "narrative": strategy["narrative"],
        },
        "target_matchup": matchup,
        "emotion": emotion,
        "recurring_weakness": recurring,
        "metrics": metrics,
        "rule_findings": rule_findings,
        "red_board": new_red_board,
        "degraded": degraded,
        "tool_calls": strategy.get("tool_calls", []),
    }


@app.post("/coach-feedback")
def coach_feedback(payload: MatchIdPayload):
    try:
        match = repository.get_match(payload.match_id)
        current = repository.get_latest_turn(payload.match_id)
    except MatchNotFound:
        raise HTTPException(404, "match not found")

    if current.red_board is None or current.turn_number == 0:
        raise HTTPException(409, "call /turn and /opponent first")

    opponent_strategy = {
        "formation_code": match.opponent_formation_code,
        "instruction": current.opponent_instruction,
        "narrative": current.opponent_narrative,
    }
    drill_context = {"scenario": match.scenario, "coaching_goal": match.coaching_goal, "focus_matchup": match.focus_matchup or {}}
    metrics = None
    if match.focus_matchup:
        metrics = board_metrics.threat_cover(_to_metrics_board(current.blue_board, current.red_board), match.focus_matchup)
    rule_findings = current.rule_findings or []
    suggested_fix = coaching_advice.suggest_best_swap(
        match.user_formation_code, match.user_team_id, current.blue_board, current.red_board, current.target_matchup
    )

    try:
        feedback = _call_with_one_retry(
            coach_agent.generate_feedback,
            user_team_id=match.user_team_id,
            opponent_strategy=opponent_strategy,
            # The FIXED drill matchup, not the rotating current.target_matchup
            # - metrics/verdict are graded against this one, so the narrative
            # has to be about the same player or "SOLVED" can describe a
            # totally different matchup than what the coach is talking about.
            matchup=match.focus_matchup or {},
            drill=drill_context,
            metrics=metrics,
            rule_findings=rule_findings,
            suggested_fix=suggested_fix,
        )
        degraded = False
    except Exception as exc:
        logger.error("coach agent failed twice, degrading: %s", exc)
        feedback = coach_agent.heuristic_fallback(
            match.focus_matchup or {}, metrics=metrics, rule_findings=rule_findings, suggested_fix=suggested_fix
        )
        degraded = True

    turn_score = scoring.score_turn(
        rule_findings, feedback.get("verdict"), current.rejected_move_count, current.formation_changed
    )
    new_total = match.total_score + turn_score["delta"]
    new_turn_count = match.turn_count + 1
    status = scoring.match_status_after(new_total, match.target_score, new_turn_count, match.max_turns)

    repository.update_turn(
        current.id,
        verdict=feedback.get("verdict"), score_delta=turn_score["delta"],
        short_feedback=feedback["short_feedback"], detailed_feedback=feedback["detailed_feedback"],
        degraded=current.degraded or degraded,
    )
    updated_match = repository.apply_match_score(
        payload.match_id, good=turn_score["good"], bad=turn_score["bad"], neutral=turn_score["neutral"],
        delta=turn_score["delta"], status=status,
    )

    return {
        "short_feedback": feedback["short_feedback"],
        "detailed_feedback": feedback["detailed_feedback"],
        "verdict": feedback.get("verdict"),
        "degraded": degraded,
        "tool_calls": feedback.get("tool_calls", []),
        "rule_findings": rule_findings,
        "score": {
            "good": updated_match.score_good, "bad": updated_match.score_bad, "neutral": updated_match.score_neutral,
            "total": updated_match.total_score, "turns_taken": updated_match.turn_count,
            "target_score": updated_match.target_score, "max_turns": updated_match.max_turns,
        },
        "match_status": updated_match.status,
        "formation_status": _formation_status(updated_match),
        "bench_status": _bench_status(updated_match, current.blue_board),
        "suggested_fix": suggested_fix,
    }


# Lambda entry point (API Gateway <-> FastAPI). Unused for local
# `uvicorn main:app --reload` dev, only invoked on Lambda.
from mangum import Mangum  # noqa: E402
handler = Mangum(app)
