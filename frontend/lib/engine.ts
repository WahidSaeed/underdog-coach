import { Player, TeamId, TEAMS } from "./data";
import { MatchupDetail, Posture } from "./api";

export type Pawn = {
  x: number; // percent
  y: number; // percent
  role: "GK" | "DEF" | "MID" | "FWD";
  player: Player;
};

export type FormationCode = "442" | "433" | "352" | "532";

const LINES: Record<FormationCode, number[]> = {
  "442": [1, 4, 4, 2],
  "433": [1, 4, 3, 3],
  "352": [1, 3, 5, 2],
  "532": [1, 5, 3, 2],
};

const POS_BY_LINE: Record<FormationCode, string[][]> = {
  "442": [["GK"], ["RB", "CB", "CB", "LB"], ["RM", "CM", "CM", "LM"], ["ST", "ST"]],
  "433": [["GK"], ["RB", "CB", "CB", "LB"], ["CM", "CM", "CM"], ["RM", "ST", "LM"]],
  "352": [["GK"], ["CB", "CB", "CB"], ["RM", "CM", "CM", "CM", "LM"], ["ST", "ST"]],
  "532": [["GK"], ["RB", "CB", "CB", "CB", "LB"], ["CM", "CM", "CM"], ["ST", "ST"]],
};

const ROLE_NAMES = ["GK", "DEF", "MID", "FWD"] as const;

function xPositions(count: number): number[] {
  if (count === 1) return [50];
  const margin = 10;
  const step = (100 - 2 * margin) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(margin + i * step));
}

export function buildFormation(code: FormationCode, side: TeamId): Pawn[] {
  const lines = LINES[code];
  const posLines = POS_BY_LINE[code];
  const yLines = side === "blue" ? [93, 77, 60, 49] : [7, 23, 40, 51];
  const roster = TEAMS[side].players;
  const gk = roster.find((p) => p.position === "GK")!;
  const pool = roster.filter((p) => p.position !== "GK");
  const pawns: Pawn[] = [];

  lines.forEach((count, li) => {
    const xs = xPositions(count);
    const wanted = posLines[li];
    xs.forEach((x, i) => {
      let player: Player;
      if (li === 0) {
        player = gk;
      } else {
        let idx = pool.findIndex((p) => p.position === wanted[i]);
        if (idx === -1) idx = 0;
        player = pool.splice(idx, 1)[0];
      }
      pawns.push({ x, y: yLines[li], role: ROLE_NAMES[li], player });
    });
  });
  return pawns;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Staging clears helpers out to this radius around the focus defender.
// Cross-ref: backend/tools/board_metrics.py HELPER_RADIUS (15) - keep this
// value >= that one, or a drill can start pre-SOLVED (briefing gotcha #4).
const ISOLATION_RADIUS = 18;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Posture shift (blue only, outfield only - GK stays home, gotcha #3).
// Blue moves upfield by *decreasing* y (gotcha #1) - don't reuse these
// signs for red.
function applyPostureShift(pawns: Pawn[], posture: Posture): Pawn[] {
  return pawns.map((p) => {
    if (p.role === "GK") return p;
    let y: number;
    if (posture === "chasing") {
      y = p.role === "FWD" ? p.y - 6 : p.y - 10;
    } else if (posture === "protecting_lead") {
      y = p.y + 5;
    } else if (posture === "pinned_back") {
      y = p.role === "DEF" ? 84 : p.role === "MID" ? 72 : 58;
    } else {
      y = p.y;
    }
    return { ...p, y: clamp(y, 5, 95) };
  });
}

// The pedagogical core: after the posture shift, pull the two nearest
// helpers away from the focus defender so the drill starts visibly
// broken (isolated = true), rather than pre-solved. Never moves the
// defender himself (gotcha #2).
function applyIsolationTransform(pawns: Pawn[], defenderId: string): Pawn[] {
  const defenderIdx = pawns.findIndex((p) => p.player.id === defenderId);
  if (defenderIdx === -1) return pawns;
  const defender = pawns[defenderIdx];

  const helperIdxs = pawns
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== defenderIdx && p.role !== "GK")
    .sort((a, b) => dist(a.p, defender) - dist(b.p, defender))
    .slice(0, 2)
    .map(({ i }) => i);

  const next = [...pawns];
  for (const i of helperIdxs) {
    const p = next[i];
    // Pulled to the far half-space, caught upfield on the far side when
    // possession turned.
    next[i] = {
      ...p,
      x: clamp(100 - defender.x * 0.6, 10, 90),
      y: clamp(p.y - 8, 5, 95),
    };
  }

  // Verify: push anything still within ISOLATION_RADIUS back out radially.
  for (const i of helperIdxs) {
    const p = next[i];
    const d = dist(p, defender);
    if (d > 0 && d < ISOLATION_RADIUS) {
      const scale = ISOLATION_RADIUS / d;
      next[i] = {
        ...p,
        x: clamp(defender.x + (p.x - defender.x) * scale, 6, 94),
        y: clamp(defender.y + (p.y - defender.y) * scale, 5, 95),
      };
    } else if (d === 0) {
      next[i] = { ...p, x: clamp(defender.x + ISOLATION_RADIUS, 6, 94) };
    }
  }

  return next;
}

// Stages the board for a new drill: rebuilds blue in the user's chosen
// formation and repositions it for the scenario's posture (and, when a
// focus matchup is set, isolates the focus defender), then reshapes red
// into the brief's formation and plants the focus attacker on the
// defender's shoulder. The team's explicit call: the drill depicts "how
// the match got here", so it overwrites the user's dragged positions -
// this supersedes the older "blue stays put" decision (see briefing
// history note).
export function stageDrillBoard(
  drill: { opponent_formation_code: FormationCode; user_posture: Posture },
  focus: MatchupDetail | null,
  userFormation: FormationCode
): { blue: Pawn[]; red: Pawn[] } {
  let blue = applyPostureShift(buildFormation(userFormation, "blue"), drill.user_posture);

  if (focus) {
    blue = applyIsolationTransform(blue, focus.defender_id);
  }

  let red = buildFormation(drill.opponent_formation_code, "red");
  if (drill.user_posture === "pinned_back") {
    // A team camped in its own third faces an opponent that has pushed
    // up. Red moves upfield by *increasing* y (gotcha #1).
    red = red.map((p) => (p.role === "GK" ? p : { ...p, y: clamp(p.y + 10, 5, 62) }));
  }

  const defender = blue.find((p) => p.player.id === focus?.defender_id);
  const attackerIdx = red.findIndex((p) => p.player.id === focus?.attacker_id);
  if (defender && attackerIdx !== -1) {
    // Plant the threat on the defender's shoulder: same channel, one stride upfield.
    red[attackerIdx] = {
      ...red[attackerIdx],
      x: clamp(defender.x, 6, 94),
      y: clamp(defender.y - 9, 5, 95),
    };
  }

  return { blue, red };
}

export type Matchup = {
  attacker: Player;
  defender: Player;
  score: number;
  reasons: string[];
};

// Client-side mirror of backend/tools/player_data.find_exploitable_matchup.
// In production the "Ask the coach" button calls the /coach endpoint and
// this only serves as an offline fallback.
export function findExploitableMatchup(attacking: TeamId, defending: TeamId): Matchup | null {
  const attackers = TEAMS[attacking].players.filter((p) =>
    ["LM", "RM", "ST"].includes(p.position)
  );
  const defenders = TEAMS[defending].players.filter((p) =>
    ["LB", "RB", "CB"].includes(p.position)
  );

  let best: Matchup | null = null;
  for (const a of attackers) {
    for (const d of defenders) {
      let score = 0;
      const reasons: string[] = [];
      if (a.strengths.includes("electric_pace") && d.weaknesses.includes("slow_turning")) {
        score += 3;
        reasons.push("pace mismatch in behind");
      }
      if (a.strengths.includes("electric_pace") && d.weaknesses.includes("poor_tracking_back")) {
        score += 2;
        reasons.push("space left in the channel");
      }
      if (a.stats.pace - d.stats.pace > 15) {
        score += 1;
        reasons.push("raw pace gap");
      }
      if (!best || score > best.score) {
        best = { attacker: a, defender: d, score, reasons };
      }
    }
  }
  return best && best.score > 0 ? best : null;
}

export type CoachVerdict = {
  emotion: "neutral" | "explaining" | "happy" | "worried" | "angry" | "celebrating";
  opponentFormation: FormationCode;
  messages: { who: "OPPONENT" | "COACH"; text: string }[];
  matchup: Matchup | null;
};

// Board geometry the backend also needs (POST /opponent payload) - kept
// here so the API request body and the offline fallback compute it the
// exact same way.
export function boardGeometry(bluePawns: Pawn[]): { widthSpread: number; avgDefLine: number } {
  const outfield = bluePawns.filter((p) => p.player.position !== "GK");
  const xs = outfield.map((p) => p.x);
  const widthSpread = Math.max(...xs) - Math.min(...xs);
  const defenders = bluePawns.filter((p) => p.role === "DEF");
  const avgDefLine = defenders.reduce((s, p) => s + p.y, 0) / defenders.length;
  return { widthSpread, avgDefLine };
}

export function evaluateBoard(bluePawns: Pawn[]): CoachVerdict {
  const { widthSpread, avgDefLine: avgDefY } = boardGeometry(bluePawns);

  const opponentFormation: FormationCode = widthSpread < 55 ? "433" : "352";
  const matchup = findExploitableMatchup("red", "blue");
  const messages: CoachVerdict["messages"] = [];
  let severity = 0;

  const label = opponentFormation.split("").join("-");

  if (matchup) {
    severity += matchup.score;
    messages.push({
      who: "OPPONENT",
      text: `We're shifting to a ${label}. ${matchup.attacker.name} will hunt ${matchup.defender.name} — ${matchup.reasons.join(", ")}.`,
    });
    messages.push({
      who: "COACH",
      text: `${matchup.defender.name} is tagged "${(matchup.defender.weaknesses[0] || "exposed").replaceAll("_", " ")}" and ${matchup.attacker.name} has electric pace. Tuck a midfielder into that channel, or switch to a back five for a covering body.`,
    });
  } else {
    messages.push({ who: "OPPONENT", text: `We're reshaping into a ${label} to probe.` });
    messages.push({
      who: "COACH",
      text: "No obvious mismatch for them right now — your shape is holding. Well done.",
    });
  }

  if (widthSpread < 55) {
    severity += 1;
    messages.push({
      who: "COACH",
      text: `Your shape is narrow (spread ${Math.round(widthSpread)}%). Wide players will isolate your fullbacks.`,
    });
  }
  if (avgDefY < 68) {
    severity += 1;
    messages.push({
      who: "COACH",
      text: "That back line is high. One ball in behind beats it for pace.",
    });
  }

  let emotion: CoachVerdict["emotion"];
  if (severity >= 4) emotion = "angry";
  else if (severity >= 2) emotion = "worried";
  else if (severity === 1) emotion = "explaining";
  else emotion = "celebrating";

  return { emotion, opponentFormation, messages, matchup };
}
