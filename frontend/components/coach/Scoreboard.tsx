"use client";

import { ScoreState } from "@/lib/api";

// agent_instruction.md item 5: "a board of score being maintained for
// user's total good and bad and overall decision along with turns taken."
export default function Scoreboard({ score }: { score: ScoreState | null }) {
  if (!score) return null;
  const pct = Math.max(0, Math.min(100, (score.total / Math.max(1, score.target_score)) * 100));

  return (
    <div
      style={{
        background: "rgba(10,9,20,0.55)",
        border: "1px solid rgba(255,255,255,0.16)",
        padding: "9px 11px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="display ital" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.05em", color: "var(--lime)" }}>
          SCORE {score.total} / {score.target_score}
        </span>
        <span className="display" style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
          TURN {score.turns_taken} / {score.max_turns}
        </span>
      </div>

      <div style={{ height: 6, background: "rgba(255,255,255,0.12)", position: "relative", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute", inset: 0, width: `${pct}%`,
            background: "linear-gradient(90deg, var(--cyan), var(--lime))",
            transition: "width 0.4s ease-out",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
        <span style={{ color: "var(--lime)" }}>✓ {score.good} good</span>
        <span style={{ color: "#ff7a88" }}>✕ {score.bad} bad</span>
        {score.neutral > 0 && <span style={{ color: "var(--text-dim)" }}>• {score.neutral} neutral</span>}
      </div>
    </div>
  );
}
