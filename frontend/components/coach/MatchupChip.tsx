"use client";

import { MatchupDetail } from "@/lib/api";

type Props = {
  matchup: MatchupDetail | null;
  recurringWeakness: MatchupDetail | null;
  onClick: () => void;
};

// The glance-level "who's attacking who" readout. Clicking re-pulses the two
// pawns on the pitch (ties the panel back to the board).
export default function MatchupChip({ matchup, recurringWeakness, onClick }: Props) {
  if (!matchup) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={onClick}
        className="display ital"
        style={{
          alignSelf: "flex-start",
          maxWidth: "100%",
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: "0.03em",
          color: "var(--text)",
          background: "rgba(10,9,20,0.6)",
          border: "1px solid var(--line)",
          padding: "3px 10px",
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        ⚔ {matchup.attacker} <span style={{ color: "var(--text-dim)" }}>▸</span> {matchup.defender}
      </button>
      {recurringWeakness && (
        <div
          className="display ital"
          style={{
            alignSelf: "flex-start",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.03em",
            color: "#f0b83c",
            border: "1px solid rgba(240,184,60,0.5)",
            background: "rgba(240,184,60,0.1)",
            padding: "2px 8px",
          }}
        >
          ↩ REPEAT MISTAKE: {recurringWeakness.defender}
        </div>
      )}
    </div>
  );
}
