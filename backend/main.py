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
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import coach_agent, match_director_agent, opponent_manager_agent
from agents.scenario_and_progress_agents import get_progress_agent
from tools import board_metrics, player_data

logger = logging.getLogger(__name__)

app = FastAPI(title="Underdog Coach API")

# API Gateway's own CORS config (template.yaml) covers the deployed
# stack; this covers `uvicorn main:app --reload` during local dev, where
# the frontend calls this process directly with no API Gateway in front.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
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


class DrillContextIn(BaseModel):
    scenario: str
    coaching_goal: str
    focus_matchup: dict[str, Any] = {}


class BoardPawnIn(BaseModel):
    id: str
    x: float
    y: float


class BoardIn(BaseModel):
    blue: list[BoardPawnIn]
    red: list[BoardPawnIn]


class FormationPayload(BaseModel):
    session_id: str
    user_team: str = "blue"
    opponent_team: str = "red"
    formation_code: str
    width_spread: float
    avg_def_line: float
    drill: DrillContextIn | None = None
    board: BoardIn | None = None


class DrillPayload(BaseModel):
    session_id: str
    user_team: str = "blue"
    opponent_team: str = "red"
    difficulty: str = "medium"


class OpponentPlanIn(BaseModel):
    formation_code: str
    instruction: str
    narrative: str


class CoachFeedbackPayload(BaseModel):
    session_id: str
    user_team: str = "blue"
    opponent: OpponentPlanIn
    target_matchup: dict[str, Any] = {}
    drill: DrillContextIn | None = None
    metrics: dict[str, Any] | None = None


@app.get("/roster/{team_id}")
def roster(team_id: str):
    return player_data.get_team(team_id)


@app.post("/drill")
def drill(payload: DrillPayload):
    session = _get_session(payload.session_id)

    try:
        brief = _call_with_one_retry(
            match_director_agent.design_drill,
            session=session,
            user_team_id=payload.user_team,
            opponent_team_id=payload.opponent_team,
            difficulty=payload.difficulty,
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

    return {
        "scenario": brief["scenario"],
        "coaching_goal": brief["coaching_goal"],
        "focus_note": brief["focus_note"],
        "focus_matchup": brief["focus_matchup"] or {},
        "opponent_formation_code": brief["opponent_formation_code"],
        "user_goals": brief["user_goals"],
        "opponent_goals": brief["opponent_goals"],
        "minute": brief["minute"],
        "user_posture": brief["user_posture"],
        "tool_calls": brief.get("tool_calls", []),
        "degraded": degraded,
    }


@app.post("/opponent")
def opponent(payload: FormationPayload):
    user_formation = {
        "code": payload.formation_code,
        "width_spread": payload.width_spread,
        "avg_def_line": payload.avg_def_line,
    }
    drill_context = payload.drill.model_dump() if payload.drill else None

    metrics = None
    if payload.board and drill_context and drill_context.get("focus_matchup"):
        metrics = board_metrics.threat_cover(payload.board.model_dump(), drill_context["focus_matchup"])

    try:
        strategy = _call_with_one_retry(
            opponent_manager_agent.decide_counter_strategy,
            user_formation=user_formation,
            user_team_id=payload.user_team,
            opponent_team_id=payload.opponent_team,
            drill=drill_context,
            metrics=metrics,
        )
        degraded = not strategy.get("structured_ok", True)
    except Exception as exc:
        logger.error("opponent agent failed twice, degrading: %s", exc)
        target_matchup = player_data.find_exploitable_matchup(payload.opponent_team, payload.user_team)
        strategy = opponent_manager_agent.heuristic_fallback(
            user_formation=user_formation, target_matchup=target_matchup
        )
        degraded = True

    matchup = strategy["target_matchup"]

    session = _get_session(payload.session_id)
    session.log_round(payload.formation_code, matchup)
    recurring = session.recurring_weakness()

    emotion = _compute_emotion(matchup, payload.width_spread, payload.avg_def_line, metrics)

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
        "degraded": degraded,
        "tool_calls": strategy.get("tool_calls", []),
    }


@app.post("/coach-feedback")
def coach_feedback(payload: CoachFeedbackPayload):
    opponent_strategy = payload.opponent.model_dump()
    drill_context = payload.drill.model_dump() if payload.drill else None

    try:
        feedback = _call_with_one_retry(
            coach_agent.generate_feedback,
            user_team_id=payload.user_team,
            opponent_strategy=opponent_strategy,
            matchup=payload.target_matchup,
            drill=drill_context,
            metrics=payload.metrics,
        )
        degraded = False
    except Exception as exc:
        logger.error("coach agent failed twice, degrading: %s", exc)
        feedback = coach_agent.heuristic_fallback(payload.target_matchup, metrics=payload.metrics)
        degraded = True

    return {
        "coach_feedback": feedback["text"],
        "verdict": feedback.get("verdict"),
        "degraded": degraded,
        "tool_calls": feedback.get("tool_calls", []),
    }


# Lambda entry point (API Gateway <-> FastAPI). Unused for local
# `uvicorn main:app --reload` dev, only invoked on Lambda.
from mangum import Mangum  # noqa: E402
handler = Mangum(app)
