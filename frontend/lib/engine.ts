import { Player, TeamId, TEAMS } from "./data";

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
