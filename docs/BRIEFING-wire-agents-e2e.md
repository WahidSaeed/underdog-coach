# Briefing: Wire the frontend to the real Strands/Bedrock agents (Priority 1)

**Audience:** senior dev joining with zero context.
**Goal:** when a user clicks "ASK THE COACH" in the UI, the request must actually travel frontend → API Gateway → Lambda → Strands agents → Amazon Bedrock and back, and the UI must render the real agent output. Today that entire path is faked client-side.
**Budget:** this is a ~36h hackathon (ends ~2026-07-10 evening). Target ≤ 5–6 focused hours for this task. Cut scope aggressively where noted.

---

## 1. Project context (2 minutes)

"Underdog Coach" is a hackathon entry for *Football for Good*: an AI tactics trainer for grassroots coaches. The user drags their players into a formation on a tactics board; an AI **Opponent Manager agent** commits to a counter-plan that exploits a real weakness in the user's roster, and a **Coach agent** explains the exploit in plain language, naming specific players and their traits. Player stats/traits live in JSON and agents read them only through tools, so advice is grounded, never invented.

Hard requirements from the hackathon: must use the **Strands Agents SDK**, must run on **AWS** (Bedrock; AgentCore preferred but out of scope for this task). Judging explicitly rewards an end-to-end flow that "runs without hand-waving" with observable agent reasoning — which is exactly what's missing.

## 2. Current state — verified facts, not guesses

All of this was checked on 2026-07-09:

- **The demo is a fake.** `frontend/app/page.tsx:55-68` (`askCoach`) runs a 900ms `setTimeout` and calls a deterministic client-side heuristic (`frontend/lib/engine.ts`, `evaluateBoard`). No network call anywhere in the frontend. The backend is never invoked.
- **The backend exists and imports cleanly.** `backend/main.py` is FastAPI + Mangum with three routes: `GET /roster/{team_id}`, `GET /scenario`, `POST /coach`. Verified: `import main` succeeds with all routes registered (venv with `strands-agents==1.46.0`, `fastapi`, `mangum`).
- **The Strands code is structurally correct but has never executed against Bedrock.** Verified against strands-agents 1.46.0: `from strands import Agent, tool` is valid; `Agent(system_prompt=..., tools=[...])` matches the constructor (params include `model`, `tools`, `system_prompt`, `structured_output_model`, `callback_handler`); calling `agent(prompt)` is the right invocation style.
- **Model config is dangling.** `template.yaml` defines a `BedrockModelId` parameter and injects `BEDROCK_MODEL_ID` as a Lambda env var — **but no Python code reads it** (grep confirms). With no `model` argument, Strands 1.46 silently defaults to `global.anthropic.claude-sonnet-4-6` on Bedrock via boto3.
- **Region:** `samconfig.toml` deploys to **eu-central-1**, stack name `underdog-coach`. The `parameter_overrides` still contain the placeholder `BedrockModelId=REPLACE_WITH_BEDROCK_MODEL_ID`.
- **CORS is already open** (`template.yaml` HttpApi: `AllowOrigins: ["*"]`, GET/POST/OPTIONS, `content-type`).
- **Frontend is a static-export Next.js app** (`next.config.mjs` → `output: "export"`), so all API calls are client-side; the API base URL must be a `NEXT_PUBLIC_*` env var.
- **Session memory:** `backend/agents/scenario_and_progress_agents.py` has `ProgressAgent` (in-memory) and `DynamoProgressAgent` (reads/writes the `SessionTable` DynamoDB table from `template.yaml` when `SESSION_TABLE` is set). `main.py` picks per `session_id`. This part is fine — leave it.
- **Build plumbing:** `Makefile` — `make build` copies `data/` → `backend/data/` before `sam build` (Lambda `CodeUri` is `backend/`); `make deploy-guided` / `make deploy` / `make local`. `backend/tools/player_data.py` resolves the data dir for both layouts.

### Known design wart (fix as part of this task, it's small)

`backend/agents/opponent_manager_agent.py:66-73`: the LLM agent is asked to plan, but its answer is only kept as display text (`raw_response`); the `target_matchup` actually returned comes from a separate deterministic call to `player_data.find_exploitable_matchup()`. So the agent narrative and the returned matchup can disagree. The heuristic-as-tool design is fine (it grounds the agent), but the agent's *committed decision* — counter-formation + instruction — must be what flows to the client. See §4 step B.

## 3. Target architecture for this task

```
Next.js (localhost:3000 or S3)                     AWS eu-central-1
┌──────────────────────────┐    POST /coach   ┌─────────────────────────────┐
│ askCoach()               │ ───────────────► │ API Gateway (HTTP API)      │
│  - session_id (UUID in   │                  │   └► Lambda (FastAPI/Mangum)│
│    localStorage)         │                  │        ├► Opponent agent ───┼──► Bedrock
│  - formation + geometry  │ ◄─────────────── │        ├► Coach agent    ───┼──► Bedrock
│ renders: feed, emotion,  │  structured JSON │        └► DynamoDB session  │
│ pawn highlights, red team│                  └─────────────────────────────┘
│ reshape                  │
│ (falls back to local     │
│  engine.ts on error)     │
└──────────────────────────┘
```

Keep the client-side engine (`lib/engine.ts`) as an **explicit fallback** when the API errors or times out — demo resilience on stage matters more than purity. Label fallback responses in the feed (e.g. "OFFLINE READ") so we never accidentally demo the fake thinking it's real.

## 4. Plan

### Step A — Get one agent running against Bedrock locally (~1h, do this first, everything else depends on it)

1. **Pick and enable a model.** In the Bedrock console (eu-central-1) → Model catalog / Model access: confirm an Anthropic Claude model is enabled. Use the **EU cross-region inference profile id** (they look like `eu.anthropic.claude-…`), not a bare model id — bare ids and `global.…` profiles are frequently not invokable from eu-central-1. Don't trust any id written in this doc or the repo; copy it from the console. Latency guidance: prefer the fastest Claude available (Haiku-class) for the Opponent agent, a Sonnet-class model for the Coach — or one fast model for both. Total round-trip budget is tight (see Step D).
2. **Wire the env var that already exists.** In each agent module (`opponent_manager_agent.py`, `coach_agent.py`, `scenario_and_progress_agents.py`), construct the model explicitly:

   ```python
   import os
   from strands import Agent
   from strands.models import BedrockModel

   def _model() -> BedrockModel:
       return BedrockModel(
           model_id=os.environ["BEDROCK_MODEL_ID"],
           # region is picked up from AWS_REGION; Lambda sets it automatically.
           # Consider max_tokens ~500 and temperature ~0.7 — short answers, low latency.
       )

   def build_agent() -> Agent:
       return Agent(model=_model(), system_prompt=SYSTEM_PROMPT, tools=[...])
   ```

   Verify `BedrockModel`'s exact constructor kwargs against strands-agents 1.46 docs (`model_id` is correct; check the names for max_tokens/temperature pass-through). **Pin `strands-agents==1.46.0` in `backend/requirements.txt`** (everything there is currently unpinned).
3. **Smoke test locally** (needs AWS credentials with `bedrock:InvokeModel*`):

   ```bash
   cd backend
   python -m venv .venv && .venv/bin/pip install -r requirements.txt
   export BEDROCK_MODEL_ID=<profile id from console>
   export AWS_REGION=eu-central-1        # or rely on your AWS profile
   .venv/bin/uvicorn main:app --reload
   # then:
   curl -s localhost:8000/coach -H 'content-type: application/json' -d '{
     "session_id":"smoke-1","formation_code":"4-4-2",
     "width_spread":62,"avg_def_line":71}'
   ```

   Success = a JSON response where `opponent_strategy` and `coach_feedback` are LLM-written text that names real players from `data/players.json` (e.g. Torres, Larkin) and never invents attributes. Watch the console: Strands' default callback handler prints tool calls — confirm you see `scout_matchup` / `get_player_traits` being called. If the model rambles or ignores tools, tighten the system prompts before touching anything else.

### Step B — Define a real API contract and make the backend fulfil it (~1.5h)

This is the crux nobody has thought through yet. The UI needs five things per verdict (see `CoachVerdict` in `frontend/lib/engine.ts:105-110`): an **emotion** for the avatar, an **opponent formation code** so the red team reshapes, **messages** for the feed (opponent voice + coach voice), and **matchup player ids** for pawn highlighting. The current `/coach` response provides none of that in structured form.

Extend `POST /coach` to return:

```jsonc
{
  "opponent": {
    "formation_code": "433",            // one of 442|433|352|532 — the UI can only render these
    "instruction": "…",                 // 1 sentence, manager voice
    "narrative": "…"                    // the full committed plan (feed text)
  },
  "coach_feedback": "…",                // coach voice, names players
  "target_matchup": {                   // ids matter — the UI highlights pawns by player id
    "attacker_id": "r7", "attacker": "Y. Tanaka",
    "defender_id": "b5", "defender": "L. Fenwick",
    "reasons": ["…"]
  },
  "emotion": "worried",                 // neutral|explaining|happy|worried|angry|celebrating
  "recurring_weakness": null            // or a matchup dict (session memory)
}
```

Implementation notes:

- **Get structure out of the Opponent agent.** Strands 1.46 supports structured output (`structured_output_model` constructor param takes a Pydantic model; there is also an `agent.structured_output(...)` method — check the docs for which fits, 10 minutes). Define a Pydantic `OpponentPlan {formation_code, instruction, narrative}` and have the agent fill it. Validate `formation_code` against the four codes the UI supports; on anything else, fall back to a heuristic default (`433`). **This also fixes the design wart:** the agent's committed formation now drives the UI instead of being thrown away. Keep passing `find_exploitable_matchup()`'s result into the response as `target_matchup` (it's deterministic and gives you stable player ids for highlighting) — but inject it into the agent's prompt as *the scouting report it must build its plan around*, so text and data can't diverge.
- **Compute `emotion` server-side, deterministically** — do not ask the LLM for it. Port the severity logic from `evaluateBoard` (`frontend/lib/engine.ts:112-164`): matchup score + narrow-width penalty + high-line penalty → severity → emotion mapping. ~15 lines in `main.py`.
- **Failure recovery inside the endpoint** (judges look for this): wrap each agent call in try/except with one retry; if the Opponent agent's structured output fails validation, degrade to heuristic formation + the agent's raw text; if Bedrock is fully down, return the deterministic matchup with templated text and `"degraded": true`. The endpoint should never 500 because the LLM misbehaved.

### Step C — Frontend: replace the fake with a real call (~1h)

All changes in `frontend/`:

1. `lib/api.ts` (new): `askCoachApi(payload): Promise<CoachApiResponse>` using `fetch` against `process.env.NEXT_PUBLIC_API_URL`, with an `AbortController` timeout of ~25s. Session id: `crypto.randomUUID()` persisted in `localStorage` (key `uc-session`), created lazily.
2. `app/page.tsx` `askCoach()` (lines 55-68): make it async. Compute `width_spread` and `avg_def_line` from current pawns (reuse the exact code at `engine.ts:113-117` — export a helper rather than duplicating). POST to `/coach`. On success: map the response onto existing state — `setRedPawns(buildFormation(resp.opponent.formation_code, "red"))`, push opponent narrative + coach feedback (+ recurring-weakness note, if present, as a third COACH message — this is the session-memory demo moment, make it visible) into the feed, `setHighlightIds([attacker_id, defender_id])`, `setEmotion(resp.emotion)`.
3. **On any error/timeout:** call the existing `evaluateBoard()` fallback and prefix the first feed message with something visible like `⚠ OFFLINE READ —`. Log the real error to console.
4. `frontend/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:8000` for dev; the deployed API URL for the demo build. Add `.env.example` documenting it.
5. Update the footer note in `page.tsx:229-231` ("Demo runs matchups client-side…") — after this task it's wrong. Make it state the truth: "Live: Strands agents on Amazon Bedrock".

### Step D — Deploy and handle the latency reality (~1–1.5h)

1. Fix `samconfig.toml` `parameter_overrides`: real `BedrockModelId`. Then `make deploy-guided` once (or `make deploy` if the saved config is fine). Prereqs: AWS SAM CLI, credentials, Docker not required for deploy (only for `make local`).
2. **Latency budget — the real risk of this task.** API Gateway HTTP APIs have a **hard ~29–30s integration timeout** and `template.yaml` sets Lambda timeout to 30s. `/coach` makes **two sequential agent runs** (opponent → coach), each of which may involve multiple tool-call round-trips. Mitigations, in order:
   - Bump Lambda `MemorySize` to 1024 (more CPU → faster cold start with FastAPI+boto3+strands) and `Timeout` to 60 (protects against Lambda dying mid-flight even though API GW gives up at ~29s).
   - Keep agent outputs short: max_tokens ≤ 500, system prompts already demand 2–4 sentences.
   - Measure. If p95 of the combined call is > ~20s, **split the endpoint**: `POST /opponent` then `POST /coach-feedback`, called sequentially by the frontend. Each stays comfortably under the limit *and* the UX improves — the opponent's plan appears in the feed while the coach is still "thinking". This split is the recommended shape if there's any doubt; it's ~30 min extra.
   - Cold starts will be 5–10s; before the live demo, fire one warm-up request.
3. Frontend for the demo can simply run `npm run dev` locally pointing at the deployed API — S3/CloudFront hosting is **not** part of this task (nice-to-have later; `npm run build` already produces a static export).

### Step E — Verify end-to-end and make reasoning observable (~30–45 min)

Definition of done — walk this checklist against the **deployed** stack:

- [ ] Fresh browser session → drag pawns → "ASK THE COACH" → within ~20s the red team reshapes to the agent's formation, two pawns pulse, avatar emotion changes, feed shows opponent narrative + coach feedback naming real players.
- [ ] Repeat 3× leaving the same defender exposed → a recurring-weakness message appears (proves DynamoDB session memory works across invocations).
- [ ] Kill the API URL (point env at garbage) → UI degrades to "OFFLINE READ" fallback, no crash.
- [ ] CloudWatch logs for the Lambda show Strands tool invocations (`scout_matchup`, `get_player_traits`) per request — screenshot one; judges asking "is this really agentic?" get shown this.
- [ ] No player name or trait in any agent response that isn't in `data/players.json` / `data/traits.json` (spot-check 3 responses).
- Cheap high-value extra (~20 min): include the list of tool calls the agents made in the API response (Strands result objects expose messages/metrics) and render them as small grey "🔍 scouted matchup…" lines in the feed. Directly feeds the "agent reasoning, tool use and outputs are observable" judging criterion.

## 5. Gotchas summary (read before coding)

| # | Gotcha | Where |
|---|--------|-------|
| 1 | `BEDROCK_MODEL_ID` env var exists but is read by nothing — Strands silently defaults to a `global.…` model id that likely won't work in eu-central-1. Use an `eu.` inference profile id from the console. | agents + `template.yaml` + `samconfig.toml` |
| 2 | API Gateway hard 29s timeout vs two sequential LLM calls. Measure early; split the endpoint if tight. | Step D |
| 3 | The UI can only render formations 442/433/352/532 — validate the agent's `formation_code`, never trust it raw. | Step B |
| 4 | Pawn highlighting works by player id (`b5`, `r7`), so `target_matchup` must carry ids, not just names. | Step B |
| 5 | Frontend is static-export: API URL must be `NEXT_PUBLIC_API_URL`, no server-side proxying available. | Step C |
| 6 | `requirements.txt` is fully unpinned — pin at least `strands-agents==1.46.0` before deploy or the Lambda build may drift from what was tested. | Step A |
| 7 | `agent(prompt)` result: `str(result)` gives final text; tool-call trace lives on the result object — needed for the observability extra. | Step E |
| 8 | Keep `lib/engine.ts` — it's the offline fallback, but make fallback output visibly labeled so we never demo the fake by accident. | Step C |

## 6. Explicitly out of scope (other workstreams, don't drift)

Roster entry UI, the inclusion/"everyone plays" mechanic, `/scenario` integration into the frontend loop, Bedrock AgentCore migration, S3/CloudFront hosting, checkpoint-challenge integration. If you finish early, the observability extra in Step E and the endpoint split in Step D are the best uses of time.
