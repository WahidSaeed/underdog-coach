"use client";

import { CoachEmotionApi, CoachVerdict } from "@/lib/api";
import { EMOTION_HERO } from "./derive";
import { VERDICT_COLOR } from "./theme";

// Written by page.tsx's askCoach() once a full round (opponent + coach
// feedback) has resolved. Stays null while busy or before the first ask, so
// the hero falls back to the drill-active/idle branch instead of showing a
// stale verdict (briefing gotcha #3).
export type RoundState = {
  verdict: CoachVerdict | null;
  emotion: CoachEmotionApi | null;
  headline: string;
  degraded: boolean;
} | null;

type Props = {
  drillActive: boolean;
  coachingGoal: string | null;
  round: RoundState;
  idleWarning: string | null;
};

export default function VerdictHero({ drillActive, coachingGoal, round, idleWarning }: Props) {
  let bigText: string;
  let color: string;
  let subline: string;
  let degraded: boolean;

  if (round) {
    degraded = round.degraded;
    if (round.verdict) {
      bigText = round.verdict;
      color = VERDICT_COLOR[round.verdict];
    } else {
      const e = round.emotion ? EMOTION_HERO[round.emotion] : EMOTION_HERO.explaining;
      bigText = e.label;
      color = e.color;
    }
    subline = round.headline;
  } else if (drillActive) {
    bigText = "DRILL ACTIVE";
    color = "var(--cyan)";
    subline = coachingGoal ?? "";
    degraded = false;
  } else {
    degraded = !!idleWarning;
    bigText = "SET YOUR SHAPE";
    color = "var(--lime)";
    subline = idleWarning ?? "drag players, then ask for a read";
  }

  if (degraded) bigText = `⚠ ${bigText}`;
  const borderColor = degraded ? "var(--magenta)" : color;

  return (
    <div
      style={{
        clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
        background: `color-mix(in srgb, ${color} 16%, rgba(10,9,20,0.78))`,
        border: `1px solid ${borderColor}`,
        padding: "12px 16px",
        minHeight: 90,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        transition: "border-color 0.3s, background 0.3s",
      }}
    >
      <div
        className="display ital"
        style={{
          fontSize: 25,
          fontWeight: 800,
          letterSpacing: "0.02em",
          color,
          lineHeight: 1.05,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {bigText}
      </div>
      {subline && (
        <div
          style={{
            fontSize: 12.5,
            color: "rgba(255,255,255,0.82)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subline}
        </div>
      )}
    </div>
  );
}
