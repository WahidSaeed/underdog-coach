#!/usr/bin/env bash
# Starts the backend (uvicorn) and frontend (next dev) together for local
# development. Reads AWS/Bedrock config from backend/.env - see
# backend/.env.example and README.md "Backend: connecting to Bedrock".
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "Copy backend/.env.example to backend/.env and fill in your values first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${BEDROCK_MODEL_ID:-}" ]; then
  echo "BEDROCK_MODEL_ID is not set in backend/.env"
  exit 1
fi

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating backend venv..."
  python3 -m venv "$BACKEND_DIR/.venv"
  "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

cleanup() {
  echo ""
  echo "Stopping backend..."
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on http://localhost:8000 ..."
(cd "$BACKEND_DIR" && "$BACKEND_DIR/.venv/bin/uvicorn" main:app --reload) &
BACKEND_PID=$!

sleep 1

echo "Starting frontend on http://localhost:3000 ..."
(cd "$FRONTEND_DIR" && npm run dev)
