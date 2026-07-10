"use client";

import { useCallback, useRef, useState } from "react";
import { Pawn, FormationCode, Arrow, swapCandidates } from "@/lib/engine";
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

// Both teams' formations now span the whole pitch (grid_movement.py's
// DEEP_Y/ADVANCED_Y), so a blue and red pawn can legitimately land at
// nearly the same spot. Purely presentational fix: nudge the two apart
// horizontally so their cards sit side by side, but never touch y - which
// one is higher/lower still has to read as "further forward" vs "further
// back". Pairwise nearest-neighbor, not full collision physics - good
// enough since real overlaps are almost always one-on-one.
const OVERLAP_X = 9;
const OVERLAP_Y = 6;
const OVERLAP_PUSH = 5;

function resolveOverlaps(
  blue: { id: string; x: number; y: number }[],
  red: { id: string; x: number; y: number }[]
): { blueX: Record<string, number>; redX: Record<string, number> } {
  const blueX: Record<string, number> = {};
  const redX: Record<string, number> = {};
  const usedRed = new Set<string>();

  for (const b of blue) {
    let closest: { id: string; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const r of red) {
      if (usedRed.has(r.id)) continue;
      const dx = Math.abs(b.x - r.x);
      const dy = Math.abs(b.y - r.y);
      if (dx < OVERLAP_X && dy < OVERLAP_Y) {
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; closest = r; }
      }
    }
    if (closest) {
      usedRed.add(closest.id);
      const blueIsLeft = b.x <= closest.x;
      blueX[b.id] = Math.max(2, Math.min(98, b.x + (blueIsLeft ? -OVERLAP_PUSH : OVERLAP_PUSH)));
      redX[closest.id] = Math.max(2, Math.min(98, closest.x + (blueIsLeft ? OVERLAP_PUSH : -OVERLAP_PUSH)));
    }
  }
  return { blueX, redX };
}

function MiniCard({ pawn, team, highlighted, swapTarget, dimmed, photoUrl, onPointerDown }: {
  pawn: Pawn;
  team: TeamId;
  highlighted: boolean;
  swapTarget: boolean;
  dimmed: boolean;
  photoUrl?: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const p = pawn.player;
  const rating = overallRating(p.stats);
  const gold = team === "blue";
  const bg = gold
    ? "linear-gradient(168deg, #f2e6bc 0%, #e3ca8e 52%, #cfae67 100%)"
    : "linear-gradient(168deg, #33334a 0%, #232333 55%, #17171f 100%)";
  const fg = gold ? "#46390f" : "#e8e9f2";
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
        cursor: team === "blue" && p.position !== "GK" ? "grab" : "pointer",
        touchAction: "none",
        userSelect: "none",
        zIndex: highlighted || swapTarget ? 6 : 2,
        opacity: dimmed ? 0.4 : 1,
        transition: "left 0.4s cubic-bezier(0.22,1,0.36,1), top 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.2s",
        filter: "drop-shadow(0 5px 7px rgba(0,0,0,0.55))",
        animation: highlighted
          ? team === "blue" ? "dangerRing 1.3s ease-out infinite" : "limeRing 1.3s ease-out infinite"
          : swapTarget
            ? "limeRing 1s ease-out infinite"
            : undefined,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          background: bg,
          borderRadius: 10,
          // A solid, dark team-colored frame around every card, always on -
          // the one thing that has to survive at a glance across a busy
          // pitch. Lime overrides it only while this pawn is a live swap
          // target. Darkened (not the raw team color) so it reads as a
          // frame, not just a glow.
          border: `3px solid ${swapTarget ? "var(--lime)" : `color-mix(in srgb, ${accent} 60%, black)`}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt={p.name} draggable={false} style={{ display: "block", width: "100%", height: 38, objectFit: "cover" }} />
        ) : (
          <div style={{ height: 38 }} />
        )}
        {/* Rating/number/name sit in a solid team-colored bar below the
            photo (not overlaid on top of it) - same gold-vs-dark
            treatment as before, so team identity reads instantly even
            with the photo in front. */}
        <div style={{ background: bg }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "3px 5px 0" }}>
            <span className="display" style={{ fontSize: 14, fontWeight: 800, color: fg }}>{rating}</span>
            <span className="display" style={{ fontSize: 10.5, fontWeight: 700, color: fg }}>{p.num}</span>
          </div>
          <div className="display" style={{ fontSize: 10, fontWeight: 700, color: fg, textAlign: "center", padding: "0 4px 4px", whiteSpace: "nowrap", overflow: "hidden" }}>
            {lastName}
          </div>
        </div>
        <div style={{ height: 3, background: accent, opacity: 0.9 }} />
      </div>
    </div>
  );
}

export default function Pitch({
  bluePawns, redPawns, highlightIds, formationLabel, formationCode, arrows, photoByPlayerId, onProposeSwap, onSelect,
}: {
  bluePawns: Pawn[];
  redPawns: Pawn[];
  highlightIds: string[];
  formationLabel: string;
  formationCode: FormationCode;
  arrows: Arrow[];
  photoByPlayerId?: Record<string, string>;
  onProposeSwap: (fromPlayerId: string, toPlayerId: string) => void;
  onSelect: (player: Player, team: TeamId) => void;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ pawn: Pawn; x: number; y: number } | null>(null);
  // Mirrors `drag` for synchronous reads inside the native pointerup
  // listener below - reading the latest position via a setState updater
  // instead (`setDrag(current => ...)`) would call onProposeSwap (which
  // triggers Home's setStagedSwap) as a side effect of an updater
  // function, and React can invoke updaters during rendering, which is
  // exactly what produces "Cannot update Home while rendering Pitch".
  const dragRef = useRef<{ pawn: Pawn; x: number; y: number } | null>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent, team: TeamId, pawn: Pawn) => {
      const el = e.currentTarget as HTMLElement;
      try { el.setPointerCapture(e.pointerId); } catch {}
      const startX = e.clientX, startY = e.clientY;
      let moved = false;

      // Only blue outfield pawns are movable - red is the opponent's, and
      // the GK never moves (agent_instruction.md items 2/4: deterministic,
      // grid-only movement - see backend/tools/grid_movement.py).
      const movable = team === "blue" && pawn.role !== "GK";

      const onPointerMove = (ev: PointerEvent) => {
        const rect = pitchRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
        if (!movable) return;
        const x = Math.max(4, Math.min(96, ((ev.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(5, Math.min(95, ((ev.clientY - rect.top) / rect.height) * 100));
        dragRef.current = { pawn, x, y };
        setDrag({ pawn, x, y });
      };
      const onPointerUp = () => {
        el.removeEventListener("pointermove", onPointerMove as EventListener);
        el.removeEventListener("pointerup", onPointerUp);
        if (!moved) {
          onSelect(pawn.player, team);
        } else if (movable && dragRef.current) {
          const current = dragRef.current;
          const candidates = swapCandidates(formationCode, bluePawns, pawn);
          let best: Pawn | null = null, bestD = Infinity;
          for (const c of candidates) {
            const d = Math.hypot(c.x - current.x, c.y - current.y);
            if (d < bestD) { bestD = d; best = c; }
          }
          // Snap-to-nearest-legal-square only, never a free drop -
          // anything not close enough to an actual swap target springs
          // back to its original spot instead of committing.
          if (best && bestD < 18) onProposeSwap(pawn.player.id, best.player.id);
        }
        dragRef.current = null;
        setDrag(null);
      };
      el.addEventListener("pointermove", onPointerMove as EventListener);
      el.addEventListener("pointerup", onPointerUp);
    },
    [bluePawns, formationCode, onProposeSwap, onSelect]
  );

  const candidateIds = new Set(
    drag && drag.pawn.role !== "GK"
      ? swapCandidates(formationCode, bluePawns, drag.pawn).map((p) => p.player.id)
      : []
  );

  const links = chemLinks(bluePawns);

  const shownBluePawns = bluePawns.map((p) =>
    drag?.pawn.player.id === p.player.id ? { ...p, x: drag.x, y: drag.y } : p
  );
  const { blueX, redX } = resolveOverlaps(
    shownBluePawns.map((p) => ({ id: p.player.id, x: p.x, y: p.y })),
    redPawns.map((p) => ({ id: p.player.id, x: p.x, y: p.y }))
  );

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

      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>

        {/* chemistry lines for the user's squad */}
        {links.map(([a, b], i) => (
          <line
            key={`chem-${i}`}
            x1={bluePawns[a].x} y1={bluePawns[a].y}
            x2={bluePawns[b].x} y2={bluePawns[b].y}
            stroke="#7ad83c" strokeWidth="0.45" opacity="0.75"
            vectorEffect="non-scaling-stroke" strokeLinecap="round"
          />
        ))}

        {/* directional animated arrows (agent_instruction.md item 1) */}
        {arrows.map((a) => (
          <line
            key={a.id}
            x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
            stroke={a.kind === "threat" ? "var(--magenta)" : "var(--red)"}
            strokeWidth={a.kind === "threat" ? 0.9 : 0.5}
            strokeDasharray="2.4 1.6"
            markerEnd="url(#arrowhead)"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{ color: a.kind === "threat" ? "var(--magenta)" : "var(--red)", animation: "dashFlow 0.6s linear infinite" }}
          />
        ))}
      </svg>

      {redPawns.map((p) => (
        <MiniCard
          key={p.player.id}
          pawn={redX[p.player.id] !== undefined ? { ...p, x: redX[p.player.id] } : p}
          team="red"
          highlighted={highlightIds.includes(p.player.id)}
          swapTarget={false}
          dimmed={false}
          photoUrl={photoByPlayerId?.[p.player.id]}
          onPointerDown={(e) => startDrag(e, "red", p)}
        />
      ))}
      {shownBluePawns.map((p) => {
        const isDragged = drag?.pawn.player.id === p.player.id;
        const shown = blueX[p.player.id] !== undefined ? { ...p, x: blueX[p.player.id] } : p;
        return (
          <MiniCard
            key={p.player.id}
            pawn={shown}
            team="blue"
            highlighted={highlightIds.includes(p.player.id)}
            swapTarget={candidateIds.has(p.player.id)}
            dimmed={!!drag && !isDragged && drag.pawn.role !== "GK" && !candidateIds.has(p.player.id)}
            photoUrl={photoByPlayerId?.[p.player.id]}
            onPointerDown={(e) => startDrag(e, "blue", p)}
          />
        );
      })}
    </div>
  );
}
