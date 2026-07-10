import { CoachVerdict, MatchStatus } from "@/lib/api";

export type FeedMsg = {
  who: "OPPONENT" | "COACH" | "META";
  text: string;
  id: number;
  verdict?: CoachVerdict | null;
  detailed?: string;
};

export const VERDICT_COLOR: Record<CoachVerdict, string> = {
  SOLVED: "var(--lime)",
  PARTIAL: "#f0b83c",
  EXPOSED: "#ff7a88",
};

export const MATCH_STATUS_LABEL: Record<Exclude<MatchStatus, "active">, string> = {
  complete_goal: "🏆 TARGET SCORE REACHED",
  complete_max_turns: "⏱ OUT OF TURNS",
  abandoned: "MATCH ENDED",
};
