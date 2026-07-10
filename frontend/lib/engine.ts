import { Player, TeamId, TEAMS } from "./data";
import { BoardPawn, MatchupDetail, Role } from "./api";

export type Pawn = {
  x: number; // percent
  y: number; // percent
  role: Role;
  line: number;
  slot: number;
  player: Player;
};

export type FormationCode =
  | "442" | "433" | "352" | "532"
  | "41212" | "4231" | "4321" | "4222" | "3421" | "3241" | "460";

// Line-count per formation - mirrors backend/tools/grid_movement.py's
// LINES exactly (cross-ref comment there too; keep both in sync by hand).
// The server is authoritative for board state now - this is only used
// client-side to know which teammate slots are adjacent (for swap-target
// highlighting), never to compute positions.
const LINES: Record<FormationCode, number[]> = {
  "442": [1, 4, 4, 2],
  "433": [1, 4, 3, 3],
  "352": [1, 3, 5, 2],
  "532": [1, 5, 3, 2],
  "41212": [1, 4, 1, 2, 1, 2],
  "4231": [1, 4, 2, 3, 1],
  "4321": [1, 4, 3, 2, 1],
  "4222": [1, 4, 2, 2, 2],
  "3421": [1, 3, 4, 2, 1],
  "3241": [1, 3, 2, 4, 1],
  "460": [1, 4, 6],
};

// Converts a server-sent board (player_id + grid coords) into renderable
// Pawns by resolving each player_id against the static roster data.
export function toPawns(board: BoardPawn[], team: TeamId): Pawn[] {
  const roster = TEAMS[team].players;
  return board
    .map((p) => {
      const player = roster.find((pl) => pl.id === p.player_id);
      if (!player) return null;
      return { x: p.x, y: p.y, role: p.role, line: p.line, slot: p.slot, player };
    })
    .filter((p): p is Pawn => p !== null);
}

// Client-side mirror of backend/tools/grid_movement.py's legal_neighbors -
// used only to highlight which teammates a selected pawn could swap with.
// The server re-validates every submitted move independently; this never
// needs to be authoritative.
export function legalNeighbors(formationCode: FormationCode, line: number, slot: number, role: Role): [number, number][] {
  if (role === "GK") return [];
  const lines = LINES[formationCode];
  const out: [number, number][] = [];
  for (const dl of [-1, 0, 1]) {
    for (const ds of [-1, 0, 1]) {
      if (dl === 0 && ds === 0) continue;
      const nl = line + dl;
      if (nl <= 0 || nl >= lines.length) continue;
      const ns = slot + ds;
      if (ns < 0 || ns >= lines[nl]) continue;
      out.push([nl, ns]);
    }
  }
  return out;
}

// A starting XI fills every slot in every line (see grid_movement.py's
// module docstring) - so every legal move is a swap with whichever
// teammate already occupies an adjacent slot. This is what Pitch.tsx
// highlights as swap candidates once a pawn is selected.
export function swapCandidates(formationCode: FormationCode, pawns: Pawn[], selected: Pawn): Pawn[] {
  const neighbors = new Set(legalNeighbors(formationCode, selected.line, selected.slot, selected.role).map(([l, s]) => `${l}:${s}`));
  return pawns.filter((p) => p.player.id !== selected.player.id && neighbors.has(`${p.line}:${p.slot}`));
}

export type Arrow = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "movement" | "threat" };

// Directional animated arrows (agent_instruction.md item 1): one per red
// pawn that moved this turn (from -> to), plus a thicker "threat" arrow
// from the target matchup's attacker to defender - both computed purely
// from data the backend already returns, same "pure function of pawn
// positions" shape as the old chemLinks() helper in Pitch.tsx.
export function buildOpponentArrows(
  redMoves: { player_id: string; from: { x: number; y: number }; to: { x: number; y: number } }[],
  targetMatchup: MatchupDetail | null,
  redPawns: Pawn[],
  bluePawns: Pawn[]
): Arrow[] {
  const arrows: Arrow[] = redMoves.map((m) => ({
    id: `move-${m.player_id}`,
    x1: m.from.x, y1: m.from.y, x2: m.to.x, y2: m.to.y,
    kind: "movement",
  }));

  if (targetMatchup) {
    const attacker = redPawns.find((p) => p.player.id === targetMatchup.attacker_id);
    const defender = bluePawns.find((p) => p.player.id === targetMatchup.defender_id);
    if (attacker && defender) {
      arrows.push({
        id: "threat",
        x1: attacker.x, y1: attacker.y, x2: defender.x, y2: defender.y,
        kind: "threat",
      });
    }
  }

  return arrows;
}
