"""
Shared Bedrock model construction for all Strands agents.

BEDROCK_MODEL_ID must be an actual invokable model/inference-profile id
copied from the Bedrock console for the deploy region (see template.yaml /
samconfig.toml) - never hardcode one here.
"""

import os

from strands.models import BedrockModel


def build_model(max_tokens: int = 500, temperature: float = 0.7) -> BedrockModel:
    return BedrockModel(
        model_id=os.environ["BEDROCK_MODEL_ID"],
        # region is picked up from AWS_REGION; Lambda sets it automatically.
        max_tokens=max_tokens,
        temperature=temperature,
    )


def tool_call_names(result) -> list[str]:
    """Tool names a Strands agent invoked while producing `result`, for observability."""
    return [tm.tool.get("name", "unknown") for tm in result.metrics.tool_metrics.values()]
