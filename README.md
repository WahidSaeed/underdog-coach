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

The demo evaluates matchups client-side (`lib/engine.ts` mirrors
`backend/tools/player_data.py`) so it runs standalone; in production the
"Ask the coach" button calls the `/coach` endpoint instead. The original
static HTML prototype is kept at `docs/legacy_tactics_board.html`.

## Project structure

```
underdog-coach/
├── template.yaml                AWS SAM template: Lambda + API Gateway + DynamoDB + Bedrock IAM
├── samconfig.toml                default `sam deploy` parameters
├── Makefile                      build/deploy/local/destroy commands
├── frontend/                     Next.js app (FIFA-23-style UI, static export)
│   ├── app/                      layout, page, global theme + animations
│   ├── components/               Pitch, PlayerCard, CoachAvatar (animated emotions)
│   └── lib/                      roster data + client-side matchup engine
├── backend/
│   ├── main.py                   FastAPI app + Mangum handler (Lambda entry point)
│   ├── requirements.txt          installed automatically by `sam build`
│   ├── agents/
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

## Deploying to AWS (SAM)

`template.yaml` spins up the whole backend:

- **Lambda** running the FastAPI app (`backend/main.py`, via Mangum) behind
- **API Gateway (HTTP API)**, with CORS open for the frontend to call it
- **DynamoDB** (`SessionTable`) — per-session coaching history, read/written
  by `DynamoProgressAgent` whenever the `SESSION_TABLE` env var is set
- **IAM** permissions scoped to `bedrock:InvokeModel*` so the agents can
  actually call Bedrock

Prerequisites: [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html),
an AWS account with Bedrock model access enabled, and a confirmed Bedrock
model id (check the Bedrock console's model catalog for what's enabled
in your account/region — `template.yaml` ships with a placeholder, not
a real id).

```bash
# first deploy - prompts for stack name/region and saves your answers
make deploy-guided

# every deploy after that
make deploy

# run against SAM's local Lambda emulator (needs Docker)
make local

# tear the whole stack down
make destroy
```

`make build` copies `data/` into `backend/data/` before `sam build` since
the Lambda's `CodeUri` is `backend/` — `player_data.py` checks both
locations so local dev (`uvicorn`) and the deployed Lambda resolve the
same files without duplicating them in the repo.

A few things to sort out before this is a real deploy rather than a
scaffold:

- **Strands Agents SDK** — confirm exact `Agent`/`@tool` import paths and
  call signatures against current Strands docs; the agent files here
  show intended structure, not a verified-working integration.
- **Bedrock AgentCore** — `DynamoProgressAgent` is a reasonable stand-in,
  but AgentCore's native session state would replace it directly if you
  want agent memory (not just round history) to persist.
- **Player roster data** — still bundled as static JSON in the deploy
  package. Move `data/players.json` to DynamoDB once rosters need to be
  editable at runtime (e.g. a real coach building their own club's roster).

## Extending the trait system

To add a new trait: add it to `data/traits.json` with a one-line plain
definition, then tag it onto any player in `data/players.json`. Agents
pick it up automatically through the `player_data` tool — no code changes
needed unless you want a new agent heuristic (like `find_exploitable_matchup`)
to specifically reason about it.
