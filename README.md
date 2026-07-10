# Underdog Coach

A football tactics trainer: your formation and the AI
opponent's counter both live on a fixed, deterministic slot grid — never
free-hand pixels — and every turn is graded by a real rules engine
(offside, marking, defensive-line shape, pressing traps), not by an LLM
judging its own homework. A coach agent explains *why* a turn graded the
way it did, by player name and by trait, grounded in the same facts the
scoring used.

## Quick start (local Postgres, recommended)

```bash
cp backend/.env.example backend/.env   # fill in BEDROCK_MODEL_ID / AWS_PROFILE / AWS_REGION
./dev.sh
```

`dev.sh` starts Postgres (`docker compose up -d postgres`), waits for it
to be healthy, installs both dependencies if missing, and runs the
backend (`http://localhost:8000`) and frontend (`http://localhost:3000`)
together. Requires Docker (for Postgres) and Bedrock access — see
"Backend: connecting to Bedrock" below for that half.

The login screen is a fake gate (a `localStorage` flag, no real backend
auth) — click through it to reach the app.

## How a match works

A **match** is one bounded, goal-based playthrough: both teams' opening
formation and tactical stance are drawn randomly from a fixed catalog
(`backend/tools/strategy_catalog.py`), a scenario/coaching goal is
generated around a real exploitable matchup, and the match ends when the
score crosses a target or `max_turns` (15) runs out.

Each turn is one of three mutually-exclusive actions:

- **Swap** — drag one pawn onto an adjacent teammate (a "king move" on
  the formation's fixed grid — `backend/tools/grid_movement.py`). A
  starting XI fills every slot, so every ordinary move is a mutual swap,
  never a move into empty space.
- **Formation change** — reshape the whole team onto a different
  preset (11 formations supported). Rare and costly: gated by a 5-turn
  cooldown and a small score penalty.
- **Substitution** — bring on a bench player for an on-field one, same
  spot. Capped at 5 per match (FIFA's modern substitution limit), no
  score penalty, but a bench player subbed off can never return.

The turn loop is three calls, split for latency (each can involve
several Bedrock tool-call round-trips): `POST /turn` (fast, no LLM —
resolves the move deterministically), `POST /opponent` (the AI manager
commits a counter-plan and its pawns move), `POST /coach-feedback`
(grades the turn and explains it).

**Grading is deterministic, not LLM-judged.** `board_metrics.threat_cover`
computes whether the drill's focus attacker is marked and whether the
defender has cover; `coach_agent._derive_verdict` turns that into
SOLVED / PARTIAL / EXPOSED in code, and the LLM is only ever asked to
*explain* the grade it's given, never to pick one. This was deliberately
tuned (`SOLVED_RATE`, `MARK_RADIUS`/`HELPER_RADIUS` in
`board_metrics.py`) so a full 15-turn match lands **~10-13 turns SOLVED**
with a strong final score — an explicit, acknowledged demo bias, not an
accuracy claim.

## Try the frontend

The UI is a Next.js app with a FIFA-23-inspired theme: volt green on deep
navy, diagonal-cut panels, condensed display type, a stadium backdrop
(sweeping floodlights up top, drifting cloud cover along the floor), and
an animated coach avatar that reacts emotionally to the verdict.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # static export to frontend/out/
```

- Drag a pawn onto a teammate to propose a swap, or use the SYSTEM CHANGE
  / bench rows to stage a formation change or substitution — nothing
  commits until END TURN
- Click a pawn for a FIFA-style player card — overall rating, color-coded
  stat bars, strength/weakness chips, and (once seeded) a real photo
- Live arrows show the opponent's pawn movement and the live threat
  matchup; the Scoreboard tracks good/bad/neutral findings and progress
  toward the target score
- A modal pops up automatically when the match ends, with the final
  score and a SOLVED/PARTIAL/EXPOSED tally for the whole match
- **ROSTER MANAGER** (top-right link) — add, edit, or delete players on
  either team: shirt number, name, position, the 6-stat block, and
  strength/weakness tags picked from the shared glossary. New players get
  a random headshot from the 32-photo pool and start on the bench.

## Project structure

```
underdog-coach/
├── docker-compose.yml             local-dev Postgres (agent_instruction.md's persistence layer)
├── dev.sh                          starts Postgres + backend + frontend together
├── template.yaml                   AWS SAM template (legacy free-play deploy path - see "Deploying to AWS")
├── frontend/
│   ├── app/
│   │   ├── page.tsx                 match orchestration: turn loop, staged actions, feed
│   │   ├── roster/page.tsx          player management (add/edit/delete, both teams)
│   │   ├── layout.tsx               wraps the app in AuthGate
│   │   └── globals.css              theme, stadium backdrop, animations
│   ├── components/
│   │   ├── Pitch.tsx                 grid-snapped drag/swap, arrows, cross-team overlap resolution
│   │   ├── AuthGate.tsx / LoginScreen.tsx  fake login gate
│   │   └── coach/                    Scoreboard, Bench, MatchEndModal, VerdictHero, MatchReportDrawer, ...
│   └── lib/
│       ├── api.ts                    client for every backend endpoint
│       ├── engine.ts                 pure helpers: pawn mapping, chemistry/threat arrows
│       ├── auth.ts                   fake login/logout (localStorage flag)
│       └── data.ts                   client-side roster mirror (fallback/UI display only)
├── backend/
│   ├── main.py                       FastAPI app - /match/start, /turn, /opponent, /coach-feedback, /roster, /players, /traits
│   ├── db/                           SQLAlchemy models + repositories (matches, turns, players, session_rounds)
│   ├── agents/
│   │   ├── opponent_manager_agent.py   commits a counter-formation/instruction, targets a real matchup
│   │   ├── coach_agent.py              explains the (deterministically-decided) verdict
│   │   ├── match_director_agent.py     designs the scenario/coaching-goal for a new match
│   │   └── scenario_and_progress_agents.py  session memory (Postgres / DynamoDB / in-memory)
│   └── tools/
│       ├── grid_movement.py          fixed slot grid, legal moves, formation/substitution logic
│       ├── rules_engine.py           offside, marking, defensive-line, pressing-trap findings
│       ├── scoring.py                 finding/verdict point values, match-end conditions
│       ├── strategy_catalog.py       fixed catalog of opening formation x tactical-stance combos
│       ├── coaching_advice.py        deterministic best-swap suggestion
│       ├── board_metrics.py          threat_cover: is the focus attacker marked, is the defender isolated
│       └── player_data.py            grounding layer every agent calls into (DB-backed once configured)
├── data/
│   ├── players.json                  both rosters: 6-stat block + strength/weakness tags (seed data)
│   └── traits.json                   glossary of every trait tag and its plain meaning
└── README.md
```

## Why this architecture

**The player personality system is what makes the coaching real.** Every
player has a FIFA-style stat block (pace, shooting, passing, defending,
physicality, composure) plus tagged strengths and weaknesses drawn from a
shared glossary (`data/traits.json`). Agents never invent an attribute —
they call `player_data.py` as a tool, so every piece of advice traces back
to a concrete fact instead of generic football platitudes.

**Ground truth computed in code, handed to the LLM — never the other way
around.** This shows up twice: `grid_movement.py` decides every pawn's
exact destination (the opponent's own agent only narrates the "why"),
and `board_metrics.py` + `coach_agent._derive_verdict` decide the verdict
before the LLM ever sees it. The model explains; it never grades or
places its own pieces.

**Multi-agent, not single-prompt.**

| Agent | Job | Grounded in |
|---|---|---|
| Opponent Manager | Commits to a counter-formation/instruction and targets a real matchup | `player_data.pick_rotating_matchup` — pace gaps, tracking-back weaknesses, aerial mismatches |
| Coach | Explains the turn's verdict in plain language, names the players involved | `board_metrics.threat_cover` + `rules_engine` findings for the match's fixed focus matchup |
| Match Director | Designs the scenario/coaching goal a match is built around | both rosters, a scouted matchup |
| Progress | Session memory — flags a recurring weakness across rounds | windowed matchup log (Postgres/DynamoDB) |

## Backend: connecting to Bedrock

The agents (`backend/agents/*.py`) are Strands `Agent`s backed by
`BedrockModel` — verified end-to-end against real Bedrock (eu-central-1,
Claude Haiku).

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
account since deploying also needs to create Lambda/API
Gateway/DynamoDB/IAM resources.

**2. Enable a Bedrock model.** Models auto-enable on first invocation. In
the Bedrock console, region **eu-central-1**: Model catalog → pick an
Anthropic Claude model → open the Playground → send a test message.
First-time Anthropic usage on an account may prompt a short "use case
details" form before it lets the message through. Not every model tier
is available to every account (e.g. you may get `AccessDeniedException`
on a Sonnet model but not Haiku) — Haiku is a fine default.

**3. Get the exact model id.** Use the **EU cross-region inference
profile id** (`eu.anthropic.claude-...`), not a bare model id — bare ids
are frequently not invokable from eu-central-1. Easiest way to get it
exactly right: in the Playground, after a successful test message, use
the "View code" / "Export code" button and copy the literal id it used.

**4. `backend/.env`:**

```
BEDROCK_MODEL_ID=eu.anthropic.claude-...
AWS_PROFILE=underdog-coach
AWS_REGION=eu-central-1
DATABASE_URL=postgresql+psycopg://underdog:underdog_dev_pw@localhost:5432/underdog_coach
```

`./dev.sh` reads this file, starts Postgres, and runs both halves. To run
the backend by itself instead:

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
docker compose up -d postgres   # from repo root
BEDROCK_MODEL_ID=<your eu.anthropic.claude-...-id> AWS_PROFILE=underdog-coach AWS_REGION=eu-central-1 \
DATABASE_URL=postgresql+psycopg://underdog:underdog_dev_pw@localhost:5432/underdog_coach \
.venv/bin/uvicorn main:app --reload
```

Point the frontend at it via `frontend/.env.local` (copy
`frontend/.env.example`, already defaults to `http://localhost:8000`).

**Verify it's really hitting Bedrock**, not degrading: watch the
`uvicorn` terminal while playing — a real call prints Strands' live
tool-call trace (`Tool #1: get_roster`, etc.) as it happens. Each
endpoint response also carries a `degraded: true/false` flag and a
`tool_calls` list the frontend surfaces in the activity ticker.

## Deploying to AWS (SAM) — legacy path

`template.yaml` deploys the **older free-play flow** (`/drill`,
`/opponent`, `/coach-feedback` against DynamoDB session memory, no
turn-based grid/Postgres) — it has not been updated for the
match/turn/rules-engine system described above, which is currently
local-Docker-dev only. Left in place as an alternate deploy target, not
the primary path.

```bash
make build     # copies data/ -> backend/data/, then sam build
make local     # run against SAM's local Lambda emulator (needs Docker)
make destroy   # tear the whole stack down
```

`samconfig.toml` is gitignored (copy `samconfig.toml.example` to
`samconfig.toml` and fill in your own values) — same reasoning as
`backend/.env`, both embed your AWS account id. With your own
`samconfig.toml` in place, `make deploy` / `make deploy-guided` work
normally; `--guided` is safe since it only writes back to your local,
gitignored copy.

Known gaps, not yet built:

- **Turn-based system on AWS** — the Postgres-backed match/turn/rules
  engine only runs locally; porting it to the Lambda path (RDS or
  DynamoDB) is unstarted.
- **Real authentication** — the login screen is an intentional fake
  (`frontend/lib/auth.ts`, a `localStorage` flag), not real access
  control.
- **Player management on the deployed path** — `POST/PATCH/DELETE
  /players` requires `DATABASE_URL` (Postgres); the DynamoDB/JSON deploy
  path has no write support for rosters yet.

## Extending the trait system

To add a new trait: add it to `data/traits.json` with a one-line plain
definition, then tag it onto any player in `data/players.json` (or via
the Roster Manager UI, once seeded into Postgres). Agents pick it up
automatically through the `player_data` tool — no code changes needed
unless you want a new heuristic (like `find_exploitable_matchups`) to
specifically reason about it.
