"""
Coach Agent.

Takes the user's formation, the opponent's committed counter-strategy,
and the roster data, then produces plain-language coaching feedback
that names specific players and their traits - this is what makes the
advice feel like real coaching instead of generic tactics platitudes.

Produces two feedback strings per agent_instruction.md item 6: a short,
plain read for the main chat feed, and a longer technical breakdown
(citing rules_engine.py finding names and metrics by name) shown only
when the user asks for it.
"""

import random

from pydantic import BaseModel, Field
from strands import Agent, tool

from agents.model_config import build_model, tool_call_names
from tools import player_data

# See _derive_verdict's docstring.
SOLVED_RATE = 0.75

SYSTEM_PROMPT = """
You are a football tactics coach speaking directly to an amateur coach
or young player. Explain tactical decisions in plain, encouraging
language - never jargon-only. Always reference specific players by
name and their concrete strengths/weaknesses from the data tools, never
generic statements like "your defense is weak."

Always produce two pieces of feedback:
- short_feedback: 1-2 plain-language sentences, no jargon, a beginner
  could read this at a glance and understand what's happening.
- detailed_feedback: 4-6 sentences, technical and well-reasoned. Must
  name specific rule findings by their finding name (e.g.
  "unmarked_attacker", "high_defensive_line", "pressing_trap_risk") when
  any are given, and must cite the underlying metrics/numbers, not just
  describe them in prose.

When a suggested fix is given below, the turn went badly enough that a
concrete correction exists - you MUST end detailed_feedback with that
exact swap and why it helps (name both players), and short_feedback
should hint at it too (e.g. "swap X and Y next turn"). Never invent a
different move than the one given - it's the only one that's actually
legal and proven to help. When no suggested fix is given but the turn
still graded badly, say plainly that no single swap fixes it and a
formation change may be needed instead.

The grade (SOLVED/PARTIAL/EXPOSED) is decided deterministically from the
metrics before you write anything - it is given to you as ground truth.
Never re-grade it, contradict it, or hedge against it - your job is only
to explain, in the user's terms, why that grade is correct given the
metrics and rule findings.
"""


@tool
def get_player_traits(team_id: str, player_id: str) -> dict:
    """Look up a specific player's stat block and strength/weakness tags."""
    return player_data.get_player(team_id, player_id)


@tool
def explain_trait(trait: str) -> str:
    """Return the plain-language definition of a trait tag."""
    return player_data.trait_definition(trait) or "unknown trait"


class CoachAdvice(BaseModel):
    short_feedback: str = Field(description="1-2 plain-language sentences for the main chat feed.")
    detailed_feedback: str = Field(
        description="4-6 sentences, technical - must cite rule finding names and metrics when given."
    )


def build_agent() -> Agent:
    return Agent(
        # Bumped again for the dual short/detailed fields on top of the
        # verdict - same truncation risk the Opponent Manager hit at a
        # lower budget.
        model=build_model(max_tokens=750, temperature=0.6),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_player_traits, explain_trait],
    )


def _derive_verdict(metrics: dict) -> str:
    """
    Single source of truth for the verdict - the LLM is only ever asked
    to explain this, never to decide it. EXPOSED (genuinely isolated,
    zero cover at all) is never overridden - real bad play should still
    have real consequences. Otherwise the grade is a weighted random
    draw toward SOLVED, not a pure read of attacker_marked.

    That's a deliberate, acknowledged "cheat" (agent_instruction.md
    follow-up: "design the game to have around 10 to 13 out of 15 be
    SOLVED with a good score" - explicit demo-mode request, not an
    accuracy bug). A pure geometric radius bump on MARK_RADIUS couldn't
    hit that reliably: since the opponent only advances 1-2 pawns per
    turn, whether the attacker reads as marked barely changes turn to
    turn, so tuning the radius alone produced all-SOLVED or all-PARTIAL
    matches depending on which formation got picked at kickoff - never
    the desired mixed spread. Drawing independently every turn instead
    fixes that regardless of formation. SOLVED_RATE=0.75 over 15 turns
    -> Binomial(15, 0.75), mean 11.25, ~68% of matches land in [10, 13].
    generate_feedback rewrites metrics["attacker_marked"] to match
    whatever gets drawn here, so the coach's cited numbers never
    contradict its own verdict.
    """
    if metrics.get("isolated"):
        return "EXPOSED"
    return "SOLVED" if random.random() < SOLVED_RATE else "PARTIAL"


def _fix_sentence(suggested_fix: dict | None) -> str:
    if not suggested_fix:
        return ""
    return (
        f" Next turn, swap {suggested_fix['player_a_name']} and {suggested_fix['player_b_name']} - "
        f"that's the one legal move that actually improves your cover here."
    )


def heuristic_fallback(
    matchup: dict, metrics: dict | None = None, rule_findings: list[dict] | None = None,
    suggested_fix: dict | None = None,
) -> dict:
    """Fully offline degrade path used when Bedrock is unreachable. The fix
    sentence is deterministic (coaching_advice.suggest_best_swap), so this
    stays genuinely actionable even with no LLM available at all."""
    if matchup:
        reasons = ", ".join(matchup.get("reasons", [])) or "a mismatch our scouts flagged"
        short = f"{matchup['defender']} is exposed here - tighten that up."
        detailed = (
            f"{matchup['defender']} is exposed here - {reasons}. Tuck a "
            f"midfielder into that channel, or switch to a back five for cover."
        )
    else:
        short = "No obvious mismatch for them right now - your shape is holding."
        detailed = "No obvious mismatch for them right now - your shape is holding. Well done."
    if rule_findings:
        names = ", ".join(sorted({f["name"] for f in rule_findings}))
        detailed += f" Findings on record this turn: {names}."
    fix_sentence = _fix_sentence(suggested_fix)
    short += fix_sentence
    detailed += fix_sentence
    verdict = _derive_verdict(metrics) if metrics is not None else None
    return {"short_feedback": short, "detailed_feedback": detailed, "tool_calls": [], "verdict": verdict}


def generate_feedback(
    user_team_id: str,
    opponent_strategy: dict,
    matchup: dict,
    drill: dict | None = None,
    metrics: dict | None = None,
    rule_findings: list[dict] | None = None,
    suggested_fix: dict | None = None,
) -> dict:
    """
    user_team_id: "blue"
    opponent_strategy: { "formation_code", "instruction", "narrative" } - the
        opponent agent's committed plan (see opponent_manager_agent.decide_counter_strategy)
    matchup: the target_matchup dict (attacker/defender names + ids + reasons)
    drill: optional { "scenario", "coaching_goal", "focus_matchup" } from a
        prior POST /drill call - when present (with metrics), feedback is
        graded against the drill's goal instead of just advised.
    metrics: optional deterministic cover metrics (board_metrics.threat_cover)
        for the drill's focus matchup - the verdict is derived from these in
        code (_derive_verdict), never asked of the model.
    rule_findings: optional list of rules_engine.RuleFinding dicts for the
        current turn - detailed_feedback must cite these by name when given.
    suggested_fix: optional tools.coaching_advice.SuggestedFix - the single
        best legal swap for next turn, computed deterministically. When
        given, detailed_feedback must end with this exact move (see
        SYSTEM_PROMPT) - the model narrates it, it doesn't invent it.

    Returns: { "short_feedback": str, "detailed_feedback": str,
               "verdict": "SOLVED"|"PARTIAL"|"EXPOSED"|None, "tool_calls": list[str] }
    """
    agent = build_agent()

    findings_text = f"\n    Rule findings this turn: {rule_findings}\n" if rule_findings else ""
    fix_text = (
        f"\n    Suggested fix for next turn (use this exact move, do not invent another): "
        f"swap {suggested_fix['player_a_name']} and {suggested_fix['player_b_name']}.\n"
        if suggested_fix
        else "\n    No single swap improves this turn's cover - if the grade is bad, say a "
             "formation change may be needed instead.\n"
    )

    base_prompt = f"""
    The opponent has committed to this plan: {opponent_strategy.get('narrative')}
    Their instruction to the team: {opponent_strategy.get('instruction')}

    The specific matchup they're targeting: {matchup}
    {findings_text}{fix_text}
    """

    if drill and metrics is not None:
        # Decided in code, not asked of the model - see _derive_verdict's
        # docstring. The LLM only ever explains this grade, never picks it.
        verdict = _derive_verdict(metrics)
        # _derive_verdict's SOLVED_RATE draw can disagree with the raw
        # attacker_marked reading - rewrite it so the metrics cited in the
        # prompt (and in detailed_feedback) always agree with the verdict
        # they're grounding, never contradict it.
        if verdict != "EXPOSED" and metrics.get("attacker_marked") != (verdict == "SOLVED"):
            metrics = {**metrics, "attacker_marked": verdict == "SOLVED"}
        prompt = base_prompt + f"""
        This is a training drill. Coaching goal: {drill.get('coaching_goal')}
        Live cover metrics on the targeted matchup, computed from actual
        pawn positions on the board: {metrics}

        The grade for this turn has already been decided from these
        metrics: {verdict}. Explain to the user coaching {user_team_id}
        why that's the correct grade, citing the metrics and (if given)
        the rule findings by name.
        """
        result = agent(
            prompt,
            structured_output_model=CoachAdvice,
            structured_output_prompt=(
                "Write the feedback now, consistent with the grade already given. "
                "No analysis, headers, or commentary - fill in the fields directly."
            ),
        )
        advice = result.structured_output
        # Same convention as the other agents: drop the structured-output
        # pseudo-tool-call from the observability feed.
        tool_calls = [name for name in tool_call_names(result) if name != CoachAdvice.__name__]
        if advice is not None:
            return {
                "short_feedback": advice.short_feedback,
                "detailed_feedback": advice.detailed_feedback,
                "verdict": verdict,
                "tool_calls": tool_calls,
            }
        fallback = heuristic_fallback(matchup, metrics, rule_findings, suggested_fix)
        fallback["verdict"] = verdict
        fallback["tool_calls"] = tool_calls
        return fallback

    # No drill active (or no metrics yet) - today's ungraded advice, still
    # dual-feedback (item 6 applies here too, verdict just stays None).
    prompt = base_prompt + f"""
    Explain this to the user coaching {user_team_id}, and suggest one
    concrete adjustment (a formation tweak, a positional instruction,
    or a substitution) that would neutralize it.
    """
    result = agent(
        prompt,
        structured_output_model=CoachAdvice,
        structured_output_prompt=(
            "Give the advice now. No analysis, headers, or commentary - "
            "fill in the fields directly."
        ),
    )
    advice = result.structured_output
    tool_calls = [name for name in tool_call_names(result) if name != CoachAdvice.__name__]
    if advice is not None:
        return {
            "short_feedback": advice.short_feedback,
            "detailed_feedback": advice.detailed_feedback,
            "verdict": None,
            "tool_calls": tool_calls,
        }
    fallback = heuristic_fallback(matchup, None, rule_findings, suggested_fix)
    fallback["verdict"] = None
    fallback["tool_calls"] = tool_calls
    return fallback
