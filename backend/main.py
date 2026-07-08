"""
API entry point.

Endpoints the frontend calls. Deploy this behind API Gateway + Lambda
(or as a small ECS service) for the real hackathon build; run locally
with `uvicorn main:app --reload` during development.
"""

from fastapi import FastAPI
from pydantic import BaseModel

from agents import opponent_manager_agent, coach_agent
from agents.scenario_and_progress_agents import generate_scenario, get_progress_agent
from tools import player_data

app = FastAPI(title="Underdog Coach API")

# get_progress_agent() returns a DynamoDB-backed session tracker when
# SESSION_TABLE is set (Lambda deploy), otherwise an in-memory one for
# local dev.
_sessions: dict[str, object] = {}


class FormationPayload(BaseModel):
    session_id: str
    user_team: str = "blue"
    opponent_team: str = "red"
    formation_code: str
    width_spread: float
    avg_def_line: float


@app.get("/roster/{team_id}")
def roster(team_id: str):
    return player_data.get_team(team_id)


@app.get("/scenario")
def scenario(team_a: str = "blue", team_b: str = "red", difficulty: str = "medium"):
    return {"scenario": generate_scenario(team_a, team_b, difficulty)}


@app.post("/coach")
def coach(payload: FormationPayload):
    session = _sessions.setdefault(payload.session_id, get_progress_agent(payload.session_id))

    strategy = opponent_manager_agent.decide_counter_strategy(
        user_formation={
            "code": payload.formation_code,
            "width_spread": payload.width_spread,
            "avg_def_line": payload.avg_def_line,
        },
        user_team_id=payload.user_team,
        opponent_team_id=payload.opponent_team,
    )

    matchup = strategy["target_matchup"]
    session.log_round(payload.formation_code, matchup)

    feedback = coach_agent.generate_feedback(
        user_team_id=payload.user_team,
        opponent_strategy=strategy,
        matchup=matchup,
    )

    recurring = session.recurring_weakness()

    return {
        "opponent_strategy": strategy["raw_response"],
        "target_matchup": matchup,
        "coach_feedback": feedback,
        "recurring_weakness": recurring,
    }


# Lambda entry point (API Gateway <-> FastAPI). Unused for local
# `uvicorn main:app --reload` dev, only invoked on Lambda.
from mangum import Mangum  # noqa: E402
handler = Mangum(app)
