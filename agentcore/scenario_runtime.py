"""
Scenario agent, hosted on Bedrock AgentCore Runtime as its own container.

Self-contained on purpose - this directory must not import from backend/,
since it ships as an independent deployable unit (see
docs/BRIEFING-drill-agentcore-orchestration.md). SCENARIO_PROMPT below is
copied verbatim from backend/agents/scenario_and_progress_agents.py; keep
the two in sync by hand if the prompt changes.

Rosters travel in the invocation payload rather than being bundled into
the container image - no data-drift between whatever the Lambda currently
has loaded and what this container reasons about, and it sets up a future
"coach enters their own roster" feature for free.
"""

import os

from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent, tool
from strands.models import BedrockModel

SCENARIO_PROMPT = """
You generate short football match scenarios for a tactics trainer.
Given the two rosters, pick one real matchup (a specific attacker vs
a specific defender) as the teaching focus, and describe a live-game
situation (score, time remaining, momentum) that puts pressure on that
matchup. Keep it to 2 sentences. Do not invent player attributes -
only use what the roster tools return.
"""

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload):
    rosters = payload["rosters"]  # both teams, passed in the payload - see module docstring

    @tool
    def get_roster(team_id: str) -> dict:
        """Fetch a team's roster with stats and traits."""
        return rosters[team_id]

    agent = Agent(
        # 320 not 200 - see backend/agents/scenario_and_progress_agents.py:
        # measured occasional MaxTokensReachedException at 200 when the
        # model ignores the "2 sentences" instruction.
        model=BedrockModel(model_id=os.environ["BEDROCK_MODEL_ID"], max_tokens=320, temperature=0.8),
        system_prompt=SCENARIO_PROMPT,
        tools=[get_roster],
    )
    result = agent(payload["prompt"])
    return {"scenario": str(result)}


if __name__ == "__main__":
    app.run()
