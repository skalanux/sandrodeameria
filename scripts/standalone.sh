#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/local"
STARTED=0
SERVER_PID=""

cleanup() {
  if [ "$STARTED" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Levantando el servidor en el puerto ${PORT}..."
  node server.js &
  SERVER_PID=$!
  STARTED=1

  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "No pude levantar el servidor en el puerto ${PORT}."
  exit 1
fi

BROWSER="${BROWSER:-chromium}"
if ! command -v "$BROWSER" >/dev/null 2>&1; then
  BROWSER="chromium-browser"
fi
if ! command -v "$BROWSER" >/dev/null 2>&1; then
  echo "No encontré Chromium. Abrí manualmente: ${URL}"
  exit 1
fi

echo "Abriendo ${URL}"
"$BROWSER" --app="$URL" --start-fullscreen --new-window >/dev/null 2>&1
