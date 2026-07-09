// Client for the real backend (backend/main.py). /opponent and
// /coach-feedback are two separate calls - see the comment at the top of
// main.py for why the endpoint is split instead of one /coach call.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const TIMEOUT_MS = 25_000;
const SESSION_KEY = "uc-session";

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

export type OpponentApiResponse = {
  opponent: OpponentPlan;
  target_matchup: MaybeMatchup;
  emotion: CoachEmotionApi;
  recurring_weakness: MatchupDetail | null;
  degraded: boolean;
  tool_calls: string[];
};

export type CoachFeedbackApiResponse = {
  coach_feedback: string;
  degraded: boolean;
  tool_calls: string[];
};

export type FormationRequest = {
  session_id: string;
  user_team: string;
  opponent_team: string;
  formation_code: string;
  width_spread: number;
  avg_def_line: number;
};

export type CoachFeedbackRequest = {
  session_id: string;
  user_team: string;
  opponent: OpponentPlan;
  target_matchup: MaybeMatchup;
};

export function getSessionId(): string {
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

export function askOpponent(payload: FormationRequest): Promise<OpponentApiResponse> {
  return postJson<OpponentApiResponse>("/opponent", payload);
}

export function askCoachFeedback(payload: CoachFeedbackRequest): Promise<CoachFeedbackApiResponse> {
  return postJson<CoachFeedbackApiResponse>("/coach-feedback", payload);
}
