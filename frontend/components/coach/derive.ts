import { CoachEmotionApi, CoachVerdict, MatchupDetail } from "@/lib/api";

// Deterministic Phase-1 headline for a graded verdict (Phase 2 may swap in
// an LLM-written one-liner from the backend, this stays as its fallback).
export function deriveHeadline(verdict: CoachVerdict, matchup: MatchupDetail | null): string {
  if (!matchup) {
    if (verdict === "SOLVED") return "Your shape has cover now";
    if (verdict === "PARTIAL") return "Still needs support somewhere";
    return "Still wide open";
  }
  if (verdict === "SOLVED") return `${matchup.defender} has cover now`;
  if (verdict === "PARTIAL") return `${matchup.defender} still needs help`;
  return `${matchup.attacker} owns ${matchup.defender}`;
}

// "Asked without a drill" case: verdict comes back null, so the hero's big
// word is derived from the opponent's emotional read instead.
export const EMOTION_HERO: Record<CoachEmotionApi, { label: string; color: string }> = {
  celebrating: { label: "SHAPE HOLDS", color: "var(--lime)" },
  happy: { label: "SHAPE HOLDS", color: "var(--lime)" },
  explaining: { label: "MINOR RISKS", color: "var(--cyan)" },
  neutral: { label: "MINOR RISKS", color: "var(--cyan)" },
  worried: { label: "AT RISK", color: "#f0b83c" },
  angry: { label: "WIDE OPEN", color: "#ff7a88" },
};

// Player names in this domain are written "D. Okafor" / "S. Adeyemi" - a
// naive first-period split treats that initial's "." as the sentence end
// (e.g. "Train D. Okafor to manage..." incorrectly becomes "Train D."). Skip
// any "." immediately preceded by a single capital letter before accepting
// it as a real sentence boundary.
function endsWithInitial(textBefore: string): boolean {
  return /(^|\s)[A-Z]$/.test(textBefore);
}

export function firstSentence(text: string): string {
  const re = /[.!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = text.slice(0, match.index);
    if (match[0][0] !== "." || !endsWithInitial(before)) {
      return text.slice(0, match.index + match[0].length).trim();
    }
  }
  return text.trim();
}

// Clause boundaries that read as a complete-enough thought on their own -
// preferred over a hard character cut so a long goal/feedback sentence
// still reads as a short, glanceable phrase instead of an ellipsis mid-word.
const CLAUSE_BREAKS = [", ", " and ", " so that ", " so ", " while ", " to prevent ", " before ", " which "];

// Glance-level "short abstract" of a longer agent sentence: prefer cutting
// at a natural clause break within maxLen, otherwise fall back to the
// nearest word boundary (never mid-word) with a trailing ellipsis.
export function abstract(text: string, maxLen = 46): string {
  const sentence = firstSentence(text).replace(/[.!?]+\s*$/, "").trim();
  if (sentence.length <= maxLen) return sentence;

  let cutAt = -1;
  for (const brk of CLAUSE_BREAKS) {
    const idx = sentence.indexOf(brk);
    if (idx !== -1 && idx <= maxLen && idx > cutAt) cutAt = idx;
  }
  if (cutAt !== -1) return sentence.slice(0, cutAt);

  const hard = sentence.slice(0, maxLen);
  const lastSpace = hard.lastIndexOf(" ");
  return `${(lastSpace > 10 ? hard.slice(0, lastSpace) : hard).trim()}…`;
}

// Maps a raw backend tool-call name (e.g. "scout_matchup",
// "generate_scenario [AgentCore Runtime]") to a short glance-level chip
// label. The AgentCore suffix is the judges' one-glance proof of the
// remote hop, so it gets its own cyan-accented label.
export function shortToolLabel(name: string): { label: string; accent: boolean } {
  if (name.includes("AgentCore")) return { label: "AGENTCORE", accent: true };
  const known: Record<string, string> = {
    scout_matchup: "SCOUT",
    get_roster: "ROSTER",
    get_player_traits: "TRAITS",
    explain_trait: "TRAIT INFO",
    generate_scenario: "SCENARIO",
  };
  if (known[name]) return { label: known[name], accent: false };
  const base = name.split("(")[0].split("[")[0].trim();
  const label = base.length > 14 ? `${base.slice(0, 13)}…` : base.replaceAll("_", " ").toUpperCase();
  return { label, accent: false };
}
