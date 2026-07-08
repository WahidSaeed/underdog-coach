"use client";

import { Player, TeamId, TEAMS, TRAITS, overallRating } from "@/lib/data";

const STAT_LABELS: [keyof Player["stats"], string][] = [
  ["pace", "PAC"], ["shooting", "SHO"], ["passing", "PAS"],
  ["defending", "DEF"], ["physicality", "PHY"], ["composure", "COM"],
];

export default function PlayerCard({ player, teamId, onClose }: {
  player: Player; teamId: TeamId; onClose: () => void;
}) {
  const rating = overallRating(player.stats);
  const gold = teamId === "blue";
  const cardBg = gold
    ? "linear-gradient(170deg, #f4e9c3 0%, #e3ca8e 48%, #c9a75f 100%)"
    : "linear-gradient(170deg, #3a3a52 0%, #232333 55%, #15151f 100%)";
  const fg = gold ? "#46390f" : "#eef0f7";
  const sub = gold ? "rgba(70,57,15,0.68)" : "rgba(238,240,247,0.6)";
  const rule = gold ? "rgba(70,57,15,0.3)" : "rgba(255,255,255,0.16)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(8,7,18,0.78)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320,
          background: cardBg,
          clipPath: "polygon(0 3.5%, 7% 0, 93% 0, 100% 3.5%, 100% 90%, 76% 100%, 24% 100%, 0 90%)",
          padding: "26px 26px 34px",
          animation: "riseIn 0.28s ease-out",
          filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.6))",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close player card"
          style={{ position: "absolute", top: 14, right: 16, background: "none", border: "none", color: sub, fontSize: 20, cursor: "pointer", lineHeight: 1 }}
        >
          ×
        </button>

        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ lineHeight: 0.95 }}>
            <div className="display" style={{ fontSize: 52, fontWeight: 800, color: fg }}>{rating}</div>
            <div className="display" style={{ fontSize: 19, fontWeight: 700, color: sub }}>{player.position}</div>
          </div>
          <div
            style={{
              marginLeft: "auto", width: 62, height: 62, borderRadius: "50%",
              background: gold ? "rgba(70,57,15,0.13)" : "rgba(255,255,255,0.08)",
              border: `1.5px solid ${rule}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <span className="display" style={{ fontSize: 24, fontWeight: 800, color: fg }}>{player.num}</span>
          </div>
        </div>

        <div className="display ital" style={{ fontSize: 30, fontWeight: 800, color: fg, marginTop: 8, lineHeight: 1 }}>
          {player.name}
        </div>
        <div style={{ fontSize: 12, color: sub, marginTop: 3 }}>{TEAMS[teamId].name}</div>

        <div style={{ borderTop: `1.5px solid ${rule}`, margin: "14px 0 12px" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 26, rowGap: 7 }}>
          {STAT_LABELS.map(([key, label]) => {
            const v = player.stats[key];
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="display" style={{ fontSize: 15, fontWeight: 800, color: fg }}>{v}</span>
                <span className="display" style={{ fontSize: 13, fontWeight: 600, color: sub }}>{label}</span>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: `1.5px solid ${rule}`, margin: "13px 0 10px" }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {player.strengths.map((s) => (
            <span key={s} title={TRAITS.strengths[s]} className="display" style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", background: gold ? "rgba(70,57,15,0.16)" : "rgba(216,239,61,0.14)", color: gold ? fg : "var(--lime)" }}>
              {s.replaceAll("_", " ")}
            </span>
          ))}
          {player.weaknesses.map((w) => (
            <span key={w} title={TRAITS.weaknesses[w]} className="display" style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", background: "rgba(232,52,124,0.16)", color: gold ? "#8e1040" : "#ff7ab0" }}>
              {w.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
