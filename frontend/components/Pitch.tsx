"use client";

import { useRef, useCallback } from "react";
import { Pawn } from "@/lib/engine";
import { Player, TeamId, overallRating } from "@/lib/data";

/* Chemistry-style links: connect neighbours within a line, and each
   player to the nearest player in the next line - like FUT squad view. */
function chemLinks(pawns: Pawn[]): [number, number][] {
  const links: [number, number][] = [];
  const byRole: Record<string, number[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  pawns.forEach((p, i) => byRole[p.role].push(i));
  const order = ["GK", "DEF", "MID", "FWD"];
  order.forEach((role, li) => {
    const idxs = [...byRole[role]].sort((a, b) => pawns[a].x - pawns[b].x);
    for (let k = 0; k + 1 < idxs.length; k++) links.push([idxs[k], idxs[k + 1]]);
    if (li + 1 < order.length) {
      const next = byRole[order[li + 1]];
      idxs.forEach((i) => {
        let best = -1, bestD = Infinity;
        next.forEach((j) => {
          const d = Math.abs(pawns[i].x - pawns[j].x) + Math.abs(pawns[i].y - pawns[j].y);
          if (d < bestD) { bestD = d; best = j; }
        });
        if (best >= 0) links.push([i, best]);
      });
    }
  });
  return links;
}

function MiniCard({ pawn, team, highlighted, onPointerDown }: {
  pawn: Pawn;
  team: TeamId;
  highlighted: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const p = pawn.player;
  const rating = overallRating(p.stats);
  const gold = team === "blue";
  const bg = gold
    ? "linear-gradient(168deg, #f2e6bc 0%, #e3ca8e 52%, #cfae67 100%)"
    : "linear-gradient(168deg, #33334a 0%, #232333 55%, #17171f 100%)";
  const fg = gold ? "#46390f" : "#e8e9f2";
  const sub = gold ? "rgba(70,57,15,0.72)" : "rgba(232,233,242,0.6)";
  const accent = team === "blue" ? "var(--blue)" : "var(--red)";
  const lastName = p.name.split(" ").pop() || p.name;

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: `${pawn.x}%`,
        top: `${pawn.y}%`,
        transform: "translate(-50%, -50%)",
        width: 56,
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
        zIndex: highlighted ? 6 : 2,
        transition: "left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1)",
        filter: "drop-shadow(0 5px 7px rgba(0,0,0,0.55))",
        animation: highlighted
          ? team === "blue" ? "dangerRing 1.3s ease-out infinite" : "limeRing 1.3s ease-out infinite"
          : undefined,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          background: bg,
          clipPath: "polygon(0 6%, 8% 0, 92% 0, 100% 6%, 100% 84%, 78% 100%, 22% 100%, 0 84%)",
          padding: "5px 5px 7px",
          border: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 3 }}>
          <div style={{ lineHeight: 1 }}>
            <div className="display" style={{ fontSize: 17, fontWeight: 800, color: fg }}>{rating}</div>
            <div className="display" style={{ fontSize: 9.5, fontWeight: 700, color: sub }}>{p.position}</div>
          </div>
          <div
            style={{
              marginLeft: "auto",
              width: 24, height: 24,
              borderRadius: "50%",
              background: gold ? "rgba(70,57,15,0.14)" : "rgba(255,255,255,0.09)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 11, color: fg,
            }}
          >
            {p.num}
          </div>
        </div>
        <div style={{ borderTop: `1.5px solid ${gold ? "rgba(70,57,15,0.28)" : "rgba(255,255,255,0.14)"}`, marginTop: 4, paddingTop: 3 }}>
          <div className="display" style={{ fontSize: 10.5, fontWeight: 700, color: fg, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
            {lastName}
          </div>
        </div>
        <div style={{ height: 3, background: accent, marginTop: 3, opacity: 0.9 }} />
      </div>
    </div>
  );
}

export default function Pitch({
  bluePawns, redPawns, highlightIds, formationLabel, onMove, onSelect,
}: {
  bluePawns: Pawn[];
  redPawns: Pawn[];
  highlightIds: string[];
  formationLabel: string;
  onMove: (team: TeamId, index: number, x: number, y: number) => void;
  onSelect: (player: Player, team: TeamId) => void;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent, team: TeamId, index: number, player: Player) => {
      const el = e.currentTarget as HTMLElement;
      try { el.setPointerCapture(e.pointerId); } catch {}
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      const onPointerMove = (ev: PointerEvent) => {
        const rect = pitchRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
        const x = Math.max(4, Math.min(96, ((ev.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(5, Math.min(95, ((ev.clientY - rect.top) / rect.height) * 100));
        onMove(team, index, x, y);
      };
      const onPointerUp = () => {
        el.removeEventListener("pointermove", onPointerMove as EventListener);
        el.removeEventListener("pointerup", onPointerUp);
        if (!moved) onSelect(player, team);
      };
      el.addEventListener("pointermove", onPointerMove as EventListener);
      el.addEventListener("pointerup", onPointerUp);
    },
    [onMove, onSelect]
  );

  const links = chemLinks(bluePawns);

  return (
    <div
      ref={pitchRef}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "15 / 11.5",
        background:
          "radial-gradient(120% 90% at 50% 50%, rgba(30,84,48,0.55), rgba(9,32,18,0.9)), repeating-linear-gradient(to bottom, #0c2e1b 0%, #0c2e1b 9.09%, #0e3520 9.09%, #0e3520 18.18%)",
        border: "1px solid rgba(255,255,255,0.14)",
        overflow: "hidden",
      }}
    >
      {/* markings */}
      {[
        { left: "50%", top: "50%", width: "17%", aspectRatio: "1", border: "1.5px solid rgba(234,243,236,0.35)", borderRadius: "50%", transform: "translate(-50%,-50%)" },
        { left: 0, right: 0, top: "50%", height: 1.5, background: "rgba(234,243,236,0.35)", transform: "translateY(-50%)" },
        { left: "50%", top: 0, width: "44%", height: "13.5%", border: "1.5px solid rgba(234,243,236,0.35)", borderTop: "none", transform: "translateX(-50%)" },
        { left: "50%", bottom: 0, width: "44%", height: "13.5%", border: "1.5px solid rgba(234,243,236,0.35)", borderBottom: "none", transform: "translateX(-50%)" },
        { left: "50%", top: 0, width: "19%", height: "5.2%", border: "1.5px solid rgba(234,243,236,0.35)", borderTop: "none", transform: "translateX(-50%)" },
        { left: "50%", bottom: 0, width: "19%", height: "5.2%", border: "1.5px solid rgba(234,243,236,0.35)", borderBottom: "none", transform: "translateX(-50%)" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", ...(s as React.CSSProperties) }} />
      ))}

      {/* formation watermark */}
      <div
        className="display ital"
        style={{
          position: "absolute", left: 16, bottom: 8,
          fontSize: 34, fontWeight: 800, color: "rgba(255,255,255,0.13)",
          letterSpacing: "0.02em", pointerEvents: "none",
        }}
      >
        {formationLabel}
      </div>

      {/* chemistry lines for the user's squad */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 100">
        {links.map(([a, b], i) => (
          <line
            key={i}
            x1={bluePawns[a].x} y1={bluePawns[a].y}
            x2={bluePawns[b].x} y2={bluePawns[b].y}
            stroke="#7ad83c" strokeWidth="0.45" opacity="0.75"
            vectorEffect="non-scaling-stroke" strokeLinecap="round"
          />
        ))}
      </svg>

      {redPawns.map((p, i) => (
        <MiniCard key={p.player.id} pawn={p} team="red" highlighted={highlightIds.includes(p.player.id)} onPointerDown={(e) => startDrag(e, "red", i, p.player)} />
      ))}
      {bluePawns.map((p, i) => (
        <MiniCard key={p.player.id} pawn={p} team="blue" highlighted={highlightIds.includes(p.player.id)} onPointerDown={(e) => startDrag(e, "blue", i, p.player)} />
      ))}
    </div>
  );
}
