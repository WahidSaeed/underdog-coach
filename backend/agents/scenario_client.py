"""
Client for the Scenario agent.

Calls it hosted on Bedrock AgentCore Runtime when SCENARIO_AGENT_RUNTIME_ARN
is set (the remote container in agentcore/scenario_runtime.py); otherwise
runs the same prompt in-process. Three-level degradation ladder overall:
remote AgentCore -> local in-process agent -> the Match Director's own
heuristic_fallback if even the local agent throws. The demo cannot die
from AgentCore being unreachable.

Returns (scenario_text, used_remote) so callers can mark the tool-call
observability feed with "[AgentCore Runtime]" only when the remote hop
actually happened.
"""

import json
import logging
import os

import boto3

from agents.scenario_and_progress_agents import generate_scenario as _generate_local

logger = logging.getLogger(__name__)


def _local(focus: str, difficulty: str, team_a: str, team_b: str) -> tuple[str, bool]:
    return _generate_local(focus=focus, difficulty=difficulty, team_a=team_a, team_b=team_b), False


def generate(
    focus: str, difficulty: str, team_a: str, team_b: str, rosters: dict, session_id: str
) -> tuple[str, bool]:
    arn = os.environ.get("SCENARIO_AGENT_RUNTIME_ARN")
    if not arn:
        return _local(focus, difficulty, team_a, team_b)

    try:
        prompt = f"Generate a {difficulty} scenario for {team_a} vs {team_b}, focused on: {focus}."
        client = boto3.client("bedrock-agentcore")
        resp = client.invoke_agent_runtime(
            agentRuntimeArn=arn,
            runtimeSessionId=session_id,
            payload=json.dumps({"prompt": prompt, "rosters": rosters}).encode(),
            qualifier="DEFAULT",
        )
        body = "".join(chunk.decode("utf-8") for chunk in resp.get("response", []))
        return json.loads(body)["scenario"], True
    except Exception as exc:
        logger.warning("AgentCore Runtime call failed, falling back to in-process: %s", exc)
        return _local(focus, difficulty, team_a, team_b)
