"use client";

import { useEffect } from "react";
import { CoachVerdict, MatchStatus, ScoreState } from "@/lib/api";
import { MATCH_STATUS_LABEL, VERDICT_COLOR } from "./theme";

type Props = {
  open: boolean;
  matchStatus: Exclude<MatchStatus, "active"> | null;
  score: ScoreState | null;
  verdictCounts: Record<CoachVerdict, number>;
  onClose: () => void;
  onNewMatch: () => void;
};

// Fires once when a match concludes (complete_goal / complete_max_turns) -
// agent_instruction.md item 5's "board of score... along with turns
// taken" deserved a moment of its own at the end, not just the small
// header chip that's easy to miss mid-scroll.
export default function MatchEndModal({ open, matchStatus, score, verdictCounts, onClose, onNewMatch }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !matchStatus || !score) return null;

  const turnsGraded = verdictCounts.SOLVED + verdictCounts.PARTIAL + verdictCounts.EXPOSED;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, background: "rgba(6,5,12,0.72)", zIndex: 60 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 61, width: "min(420px, 92vw)",
          background: "linear-gradient(175deg, #7b23c9 0%, #8b2fd6 34%, #b13ba8 72%, #d0338c 100%)",
          border: "1px solid rgba(255,255,255,0.2)",
          padding: "22px 20px 18px",
          animation: "riseIn 0.3s ease-out",
        }}
      >
        <div className="display ital" style={{ fontSize: 15, fontWeight: 800, color: "var(--lime)", textAlign: "center" }}>
          {MATCH_STATUS_LABEL[matchStatus]}
        </div>
        <div className="display ital" style={{ fontSize: 34, fontWeight: 800, textAlign: "center", marginTop: 4 }}>
          {score.total} <span style={{ fontSize: 18, opacity: 0.7 }}>/ {score.target_score}</span>
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>
          FINAL SCORE · {score.turns_taken} / {score.max_turns} TURNS PLAYED
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <div style={{ flex: 1, background: "rgba(10,9,20,0.35)", padding: "8px 6px", textAlign: "center" }}>
            <div className="display ital" style={{ fontSize: 20, fontWeight: 800, color: VERDICT_COLOR.SOLVED }}>{verdictCounts.SOLVED}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>SOLVED</div>
          </div>
          <div style={{ flex: 1, background: "rgba(10,9,20,0.35)", padding: "8px 6px", textAlign: "center" }}>
            <div className="display ital" style={{ fontSize: 20, fontWeight: 800, color: VERDICT_COLOR.PARTIAL }}>{verdictCounts.PARTIAL}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>PARTIAL</div>
          </div>
          <div style={{ flex: 1, background: "rgba(10,9,20,0.35)", padding: "8px 6px", textAlign: "center" }}>
            <div className="display ital" style={{ fontSize: 20, fontWeight: 800, color: VERDICT_COLOR.EXPOSED }}>{verdictCounts.EXPOSED}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>EXPOSED</div>
          </div>
        </div>
        {turnsGraded > 0 && (
          <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>
            {verdictCounts.SOLVED} of {turnsGraded} turns solved
          </div>
        )}

        <div style={{ display: "flex", gap: 10, fontSize: 12.5, marginTop: 16 }}>
          <span style={{ color: "var(--lime)" }}>✓ {score.good} good</span>
          <span style={{ color: "#ff7a88" }}>✕ {score.bad} bad</span>
          {score.neutral > 0 && <span style={{ color: "rgba(255,255,255,0.65)" }}>• {score.neutral} neutral</span>}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button
            onClick={onNewMatch}
            className="display ital"
            style={{
              flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em",
              padding: "10px 0", cursor: "pointer",
              background: "var(--lime)", color: "var(--lime-dark)", border: "none",
            }}
          >
            NEW MATCH
          </button>
          <button
            onClick={onClose}
            className="display ital"
            style={{
              flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em",
              padding: "10px 0", cursor: "pointer",
              background: "rgba(10,9,20,0.4)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.25)",
            }}
          >
            REVIEW BOARD
          </button>
        </div>
      </div>
    </>
  );
}
