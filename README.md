# Underdog Coach

An AI tactics trainer for grassroots football: set your formation, and a
multi-agent AI opponent reacts by targeting real weaknesses on your roster,
then a coach agent explains why — by name, by trait — instead of giving
generic advice.

## Try the frontend

The UI is a Next.js app with a FIFA-23-inspired theme: volt green on deep
navy, diagonal-cut panels, condensed display type, and an animated coach
avatar that reacts emotionally to your tactics — waving as he explains,
sweating when he spots a problem, fuming when a channel is wide open, and
jumping when your shape holds up.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # static export to frontend/out/ (deployable to S3/CloudFront)
```

- Drag pawns to set your shape; formations animate between presets
- Click a pawn for a FIFA-style player card — big overall rating,
  color-coded stat bars, strength/weakness chips
- Hit "Ask the coach" — the opponent reshapes, the targeted matchup pawns
  pulse on the pitch, the coach's face and body language change with the
  verdict, and the feed explains it player-by-player

"Ask the coach" calls the real backend (`POST /opponent` then
`POST /coach-feedback`) — see "Backend: connecting to Bedrock" below to
run that locally. If the API is unreachable or times out, the UI falls
back to a client-side heuristic (`lib/engine.ts`, mirrors
`backend/tools/player_data.py`) so the demo never hard-fails on stage;
fallback messages are prefixed `⚠ OFFLINE READ —` so it's never mistaken
for a real agent response. The original static HTML prototype is kept at
`docs/legacy_tactics_board.html`.

## Project structure

```
underdog-coach/
├── template.yaml                AWS SAM template: Lambda + API Gateway + DynamoDB + Bedrock IAM
├── samconfig.toml.example         template for `sam deploy` parameters — copy to samconfig.toml (gitignored)
├── Makefile                      build/deploy/local/destroy commands
├── frontend/                     Next.js app (FIFA-23-style UI, static export)
│   ├── app/                      layout, page, global theme + animations
│   ├── components/               Pitch, PlayerCard, CoachAvatar (animated emotions)
│   ├── lib/
│   │   ├── api.ts                 client for POST /opponent + POST /coach-feedback
│   │   ├── data.ts                roster data
│   │   └── engine.ts              client-side matchup engine (offline fallback)
│   └── .env.example               NEXT_PUBLIC_API_URL - copy to .env.local
├── backend/
│   ├── main.py                   FastAPI app + Mangum handler (Lambda entry point)
│   ├── requirements.txt          installed automatically by `sam build`
│   ├── agents/
│   │   ├── model_config.py                 shared BedrockModel construction (reads BEDROCK_MODEL_ID)
│   │   ├── opponent_manager_agent.py       plans a counter-formation, targets real weaknesses
│   │   ├── coach_agent.py                  explains the "why" by name and trait
│   │   └── scenario_and_progress_agents.py scenario generation + DynamoDB session memory
│   └── tools/
│       └── player_data.py        grounding layer every agent calls into
├── data/
│   ├── players.json              both rosters: 6-stat block + strength/weakness tags
│   └── traits.json               glossary of every trait tag and its plain meaning
└── README.md
```

## Why this architecture

**The player personality system is what makes the coaching real.** Every
player has a FIFA-style stat block (pace, shooting, passing, defending,
physicality, composure) plus tagged strengths and weaknesses drawn from a
shared glossary (`data/traits.json`). Agents never invent an attribute —
they call `player_data.py` as a tool, so every piece of advice traces back
to a concrete fact instead of generic football platitudes. This is the
detail judges will probe ("why this and not that") and it's answered by
pointing at the data layer.

**Multi-agent, not single-prompt.** A single LLM call could produce
plausible-sounding tactics advice, but it couldn't do what this needs:

| Agent | Job | Grounded in |
|---|---|---|
| Opponent Manager | Commits to a counter-formation and picks a real matchup to exploit | `find_exploitable_matchup()` — pace gaps, tracking-back weaknesses, aerial mismatches |
| Coach | Explains the exploit in plain language, names the players involved | opponent's committed plan + the specific matchup |
| Scenario | Generates a live-game situation built around a real matchup | both rosters |
| Progress | Session memory — flags if the user keeps repeating the same personnel mistake | round-by-round matchup log |

This is planning, tool use, and state/memory in one loop — the things a
single prompt can't reliably do, and exactly what the judging criteria
calls out under "real agentic behavior."

## Backend: connecting to Bedrock

The agents (`backend/agents/*.py`) are Strands `Agent`s backed by
`BedrockModel` — verified end-to-end against real Bedrock (eu-central-1,
Claude Haiku). To run the backend locally against your own AWS account:

**1. AWS credentials.** Create an IAM user with an access key (IAM console
→ Users → your user → Security credentials → Create access key → "CLI"
use case), or federate console credentials with `aws login` if your CLI
offers it. Either way, put it under a **named profile** rather than the
default one, so it can't collide with any other AWS setup on your
machine:

```bash
aws configure --profile underdog-coach   # region: eu-central-1
```

The IAM user needs permissions to call `bedrock:InvokeModel*` at minimum;
`AdministratorAccess` is the pragmatic choice for a throwaway hackathon
account since deploying (below) also needs to create Lambda/API
Gateway/DynamoDB/IAM resources.

**2. Enable a Bedrock model.** AWS retired the old manual "Model access"
opt-in page — models now auto-enable on first invocation. In the Bedrock
console, region **eu-central-1**: Model catalog → pick an Anthropic Claude
model → open the Playground → send a test message. First-time Anthropic
usage on an account may prompt a short "use case details" form before it
lets the message through. Not every model tier is available to every
account (e.g. you may get `AccessDeniedException` on a Sonnet model but
not Haiku) — Haiku is a fine default for both agents.

**3. Get the exact model id.** Use the **EU cross-region inference
profile id** (`eu.anthropic.claude-...`), not a bare model id — bare ids
are frequently not invokable from eu-central-1. Easiest way to get it
exactly right: in the Playground, after a successful test message, use
the "View code" / "Export code" button to see the literal id the working
call used, and copy it from there.

**4. Run the backend:**

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
BEDROCK_MODEL_ID=<your eu.anthropic.claude-...-id> \
AWS_PROFILE=underdog-coach \
AWS_REGION=eu-central-1 \
.venv/bin/uvicorn main:app --reload
```

**5. Point the frontend at it:** copy `frontend/.env.example` to
`frontend/.env.local` (already defaults to `http://localhost:8000`).

**6. Verify it's really hitting Bedrock**, not the offline fallback: watch
the `uvicorn` terminal while using the app — a real call prints Strands'
live tool-call trace (`Tool #1: get_roster`, etc.) as it happens. The
offline fallback never touches this code path at all. You can also test
the endpoints directly:

```bash
curl -s localhost:8000/opponent -H 'content-type: application/json' -d '{
  "session_id":"smoke-1","formation_code":"4-4-2","width_spread":62,"avg_def_line":71}'
```
Take the `opponent` and `target_matchup` fields from that response and feed
them into `POST /coach-feedback`. If a response body contains an
apostrophe (LLM text often does — "We're shifting..."), don't paste it
into a single-quoted `-d '...'` string — it'll break bash's quoting.
Write it to a file and use `-d @file.json` instead.

## Deploying to AWS (SAM)

`template.yaml` spins up the whole backend:

- **Lambda** running the FastAPI app (`backend/main.py`, via Mangum) behind
- **API Gateway (HTTP API)**, with CORS open for the frontend to call it
- **DynamoDB** (`SessionTable`) — per-session coaching history, read/written
  by `DynamoProgressAgent` whenever the `SESSION_TABLE` env var is set
- **IAM** permissions scoped to `bedrock:InvokeModel*` so the agents can
  actually call Bedrock

Prerequisites: [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
(`brew install aws-sam-cli`) and the Bedrock access set up above.

```bash
make build     # copies data/ -> backend/data/, then sam build
make local     # run against SAM's local Lambda emulator (needs Docker)
make destroy   # tear the whole stack down
```

**Deploying with a real `BedrockModelId` / `ScenarioAgentRuntimeArn`:**
`samconfig.toml` is gitignored (copy `samconfig.toml.example` to
`samconfig.toml` and fill in your own values), same pattern as
`backend/.env` — both parameters are ARNs that embed your AWS account id,
which you don't want sitting in a public repo's history. With your own
`samconfig.toml` in place, `make deploy` / `make deploy-guided` work
normally; `--guided` is safe here since it only writes back to your local,
gitignored copy.

`make build` copies `data/` into `backend/data/` before `sam build` since
the Lambda's `CodeUri` is `backend/` — `player_data.py` checks both
locations so local dev (`uvicorn`) and the deployed Lambda resolve the
same files without duplicating them in the repo.

Known gaps, not yet built:

- **Bedrock AgentCore** — `DynamoProgressAgent` is a reasonable stand-in,
  but AgentCore's native session state would replace it directly if you
  want agent memory (not just round history) to persist.
- **Player roster data** — still bundled as static JSON in the deploy
  package. Move `data/players.json` to DynamoDB once rosters need to be
  editable at runtime (e.g. a real coach building their own club's roster).
- **Roster entry UI** and the **inclusion/"everyone plays" balancing
  mechanic** are not implemented — the current rosters are fixed demo
  data.

## Extending the trait system

To add a new trait: add it to `data/traits.json` with a one-line plain
definition, then tag it onto any player in `data/players.json`. Agents
pick it up automatically through the `player_data` tool — no code changes
needed unless you want a new agent heuristic (like `find_exploitable_matchup`)
to specifically reason about it.
