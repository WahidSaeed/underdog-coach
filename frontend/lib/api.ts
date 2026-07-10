// Client for the real backend (backend/main.py). The board is now
// server-authoritative (Postgres via backend/db/) - the client only ever
// sends a match_id plus, for /turn, the moves it's proposing; every
// response carries the real board back so the client never has to
// recompute positions itself.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const TIMEOUT_MS = 25_000;
// /match/start's design_drill call has the same nested Scenario-agent
// delegation /drill used to have (~18-20s measured against a live Bedrock
// backend) - give it its own longer budget, same reasoning as the old
// DRILL_TIMEOUT_MS.
const MATCH_START_TIMEOUT_MS = 28_000;
const SESSION_KEY = "uc-session";

export type Role = "GK" | "DEF" | "MID" | "FWD";

export type BoardPawn = {
  player_id: string;
  role: Role;
  line: number;
  slot: number;
  x: number;
  y: number;
};

export type OpponentPlan = {
  formation_code: string;
  instruction: string;
  narrative: string;
};

export type MatchupDetail = {
  attacker_id: string;
  attacker: string;
  defender_id: string;
  defender: string;
  reasons: string[];
};

// Backend returns {} (not null) when no matchup was found.
export type MaybeMatchup = MatchupDetail | Record<string, never>;

export function hasMatchup(m: MaybeMatchup | null | undefined): m is MatchupDetail {
  return !!m && typeof (m as MatchupDetail).attacker_id === "string";
}

export type CoachEmotionApi = "neutral" | "explaining" | "happy" | "worried" | "angry" | "celebrating";

export type CoverMetrics = {
  helpers_within_15: number;
  nearest_helper_dist: number | null;
  attacker_marked: boolean;
  isolated: boolean;
};

export type RuleFindingSeverity = "good" | "neutral" | "bad";

export type RuleFinding = {
  name: string;
  team: string;
  player_ids: string[];
  severity: RuleFindingSeverity;
  message: string;
};

export type CoachVerdict = "SOLVED" | "PARTIAL" | "EXPOSED";

export type MatchStatus = "active" | "complete_goal" | "complete_max_turns" | "abandoned";

export type ScoreState = {
  good: number;
  bad: number;
  neutral: number;
  total: number;
  turns_taken: number;
  target_score: number;
  max_turns: number;
};

export type StrategyOption = {
  formation_code: string;
  tactical_stance: string;
  label: string;
  description: string;
};

// A formation change reshapes the whole team at once, so it's gated
// behind a cooldown (backend/tools/grid_movement.FORMATION_CHANGE_COOLDOWN)
// rather than being freely repeatable every turn.
export type FormationStatus = {
  current: string;
  available: boolean;
  available_at_turn: number | null;
};

// Substitutions (agent_instruction.md follow-up: "up to 15 players on the
// bench... replace any on-field player with one on the bench") - a hard
// cap per match (backend/tools/grid_movement.MAX_SUBSTITUTIONS), like-for-
// like at the same grid spot. subbed_off players can never return.
export type BenchStatus = {
  available_ids: string[];
  subbed_off_ids: string[];
  subs_used: number;
  subs_remaining: number;
  max_subs: number;
};

export type MatchStartResponse = {
  match_id: string;
  user_strategy: StrategyOption;
  opponent_strategy: StrategyOption;
  scenario: string;
  coaching_goal: string;
  focus_note: string;
  focus_matchup: MaybeMatchup;
  target_score: number;
  max_turns: number;
  blue_board: BoardPawn[];
  red_board: BoardPawn[];
  formation_status: FormationStatus;
  bench_status: BenchStatus;
  degraded: boolean;
  tool_calls: string[];
};

export type MoveOut = { player_id: string; to_line: number; to_slot: number };
export type SubstitutionOut = { player_id_out: string; player_id_in: string };

export type AcceptedMove = { player_id: string; from: { line: number; slot: number }; to: { line: number; slot: number } };
export type RejectedMove = { player_id: string; reason: string };

export type TurnApiResponse = {
  turn_number: number;
  accepted_moves: AcceptedMove[];
  rejected_moves: RejectedMove[];
  blue_board: BoardPawn[];
  rule_findings: RuleFinding[];
  formation_status: FormationStatus;
  bench_status: BenchStatus;
  score: ScoreState;
  match_status: MatchStatus;
};

export type OpponentApiResponse = {
  opponent: OpponentPlan;
  target_matchup: MaybeMatchup;
  emotion: CoachEmotionApi;
  recurring_weakness: MatchupDetail | null;
  metrics: CoverMetrics | null;
  rule_findings: RuleFinding[];
  red_board: BoardPawn[];
  degraded: boolean;
  tool_calls: string[];
};

// The single best legal swap for next turn (backend/tools/coaching_advice.py),
// computed deterministically - null means no single swap improves things
// (already fine, or a formation change is what's actually needed).
export type SuggestedFix = {
  player_id_a: string;
  player_id_b: string;
  player_a_name: string;
  player_b_name: string;
  score_improvement: number;
};

export type CoachFeedbackApiResponse = {
  short_feedback: string;
  detailed_feedback: string;
  verdict: CoachVerdict | null;
  degraded: boolean;
  tool_calls: string[];
  rule_findings: RuleFinding[];
  score: ScoreState;
  match_status: MatchStatus;
  formation_status: FormationStatus;
  bench_status: BenchStatus;
  suggested_fix: SuggestedFix | null;
};

export function getSessionId(): string {
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${path} responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function askMatchStart(payload: { session_id: string; user_team: string; opponent_team: string }): Promise<MatchStartResponse> {
  return postJson<MatchStartResponse>("/match/start", payload, MATCH_START_TIMEOUT_MS);
}

export function askTurn(payload: {
  match_id: string;
  moves: MoveOut[];
  formation_change?: string | null;
  substitution?: SubstitutionOut | null;
}): Promise<TurnApiResponse> {
  return postJson<TurnApiResponse>("/turn", payload);
}

export function askOpponent(payload: { match_id: string }): Promise<OpponentApiResponse> {
  return postJson<OpponentApiResponse>("/opponent", payload);
}

export function askCoachFeedback(payload: { match_id: string }): Promise<CoachFeedbackApiResponse> {
  return postJson<CoachFeedbackApiResponse>("/coach-feedback", payload);
}

// A player's full stat block - same 6 keys everywhere in data/players.json.
export type PlayerStats = {
  pace: number;
  shooting: number;
  passing: number;
  defending: number;
  physicality: number;
  composure: number;
};

// One player row as returned by GET /roster/{team_id} - sourced from the
// `players` Postgres table (db/models.PlayerRecord) once DATABASE_URL is
// configured. photo_url is a path under frontend/public (e.g.
// "/img/players/p07.png") - random on creation (backend/db/player_repository.py),
// never user-supplied.
export type RosterPlayer = {
  id: string;
  num: number;
  name: string;
  position: string;
  stats: PlayerStats;
  strengths: string[];
  weaknesses: string[];
  photo_url: string | null;
};

export async function askRoster(teamId: string): Promise<RosterPlayer[]> {
  const res = await fetch(`${API_BASE}/roster/${teamId}`);
  if (!res.ok) throw new Error(`/roster/${teamId} responded ${res.status}`);
  const data = await res.json();
  return data.players as RosterPlayer[];
}

// {strengths: {tag: definition}, weaknesses: {tag: definition}} - the
// full valid trait-tag set, for the management UI's dropdowns.
export type TraitMap = { strengths: Record<string, string>; weaknesses: Record<string, string> };

export async function askTraits(): Promise<TraitMap> {
  const res = await fetch(`${API_BASE}/traits`);
  if (!res.ok) throw new Error(`/traits responded ${res.status}`);
  return (await res.json()) as TraitMap;
}

export type PlayerCreatePayload = {
  team_id: string;
  num: number;
  name: string;
  position: string;
  stats: PlayerStats;
  strengths: string[];
  weaknesses: string[];
};

export type PlayerUpdatePayload = Partial<Omit<PlayerCreatePayload, "team_id">>;

export function createPlayer(payload: PlayerCreatePayload): Promise<RosterPlayer> {
  return postJson<RosterPlayer>("/players", payload);
}

export async function updatePlayer(playerId: string, payload: PlayerUpdatePayload): Promise<RosterPlayer> {
  const res = await fetch(`${API_BASE}/players/${playerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`/players/${playerId} responded ${res.status}`);
  return (await res.json()) as RosterPlayer;
}

export async function deletePlayer(playerId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/players/${playerId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`/players/${playerId} responded ${res.status}`);
}
