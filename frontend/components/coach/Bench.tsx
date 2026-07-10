"use client";

import { Player } from "@/lib/data";
import { BenchStatus } from "@/lib/api";

type Props = {
  players: Player[];
  status: BenchStatus | null;
  selectedId: string | null;
  onSelect: (playerId: string) => void;
};

// agent_instruction.md follow-up: "up to 15 players on the bench...
// replace any on-field player with the one on bench". Click an available
// player here, then click the on-field player to replace.
export default function Bench({ players, status, selectedId, onSelect }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap", rowGap: 6 }}>
      <span className="display" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
        BENCH {status ? `(${status.subs_remaining}/${status.max_subs})` : ""}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {players.map((p) => {
          const available = status?.available_ids.includes(p.id) ?? false;
          const usedUp = status?.subbed_off_ids.includes(p.id) ?? false;
          const selected = selectedId === p.id;
          const disabled = !available;
          return (
            <button
              key={p.id}
              onClick={() => available && onSelect(p.id)}
              disabled={disabled}
              title={usedUp ? "Already substituted off - can't return" : available ? "Select, then click a player on the pitch" : "Currently on the pitch"}
              className="display ital"
              style={{
                fontSize: 12, fontWeight: 800, letterSpacing: "0.02em",
                padding: "5px 9px",
                cursor: disabled ? "not-allowed" : "pointer",
                background: selected ? "var(--lime)" : "rgba(10,9,20,0.6)",
                color: selected ? "var(--lime-dark)" : usedUp ? "var(--text-dim)" : "var(--text)",
                border: `1px solid ${selected ? "var(--lime)" : "var(--line)"}`,
                opacity: disabled ? 0.45 : 1,
                textDecoration: usedUp ? "line-through" : "none",
              }}
            >
              {p.position} {p.name.split(" ").pop()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
