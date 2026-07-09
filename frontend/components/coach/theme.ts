import { CoachVerdict, Posture } from "@/lib/api";

export type FeedMsg = { who: "OPPONENT" | "COACH" | "META"; text: string; id: number; verdict?: CoachVerdict | null };

export const VERDICT_COLOR: Record<CoachVerdict, string> = {
  SOLVED: "var(--lime)",
  PARTIAL: "#f0b83c",
  EXPOSED: "#ff7a88",
};

export const POSTURE_LABEL: Record<Posture, string> = {
  chasing: "CHASING",
  protecting_lead: "PROTECTING LEAD",
  pinned_back: "PINNED BACK",
  balanced: "BALANCED",
};
