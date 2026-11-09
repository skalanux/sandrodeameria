#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.deploy ]]; then
  echo "Falta .env.deploy. Copiá .env.deploy.example y completalo." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env.deploy

: "${DEPLOY_HOST:?Falta DEPLOY_HOST en .env.deploy}"
: "${DEPLOY_USER:?Falta DEPLOY_USER en .env.deploy}"
: "${SERVER_HOST:?Falta SERVER_HOST en .env.deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/avatar}"
IMAGE_TAG="${IMAGE_TAG:-$(git describe --always --dirty 2>/dev/null || date +%Y%m%d-%H%M%S)}"

if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  echo "Aviso: hay cambios sin commit. Se deploya el working tree como ${IMAGE_TAG}."
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
echo "→ Sincronizando código a ${REMOTE}:${DEPLOY_PATH}"
ssh "$REMOTE" "mkdir -p '${DEPLOY_PATH}'"

rsync -az --delete \
  --exclude '.env' \
  --exclude '.env.deploy' \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'certs/' \
  --exclude 'models/' \
  --exclude 'vendor/' \
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude 'tmp/' \
  --exclude '__pycache__/' \
  --exclude '*.py' \
  --exclude 'pyproject.toml' \
  --exclude 'uv.lock' \
  --exclude 'assets/cache/' \
  --exclude 'assets/face.jpg' \
  ./ "${REMOTE}:${DEPLOY_PATH}/"

echo "→ Build y deploy (${IMAGE_TAG})"
ssh "$REMOTE" "cd '${DEPLOY_PATH}' && \
  test -f .env && \
  grep -Eq '^[[:space:]]*SERVER_HOST[[:space:]]*=[[:space:]]*[^[:space:]]' .env && \
  grep -Eq '^[[:space:]]*BASIC_AUTH_USERS[[:space:]]*=[[:space:]]*[^[:space:]]' .env && \
  (test -s assets/face.jpg || test -s assets/face.mp4) && \
  IMAGE_TAG='${IMAGE_TAG}' docker compose build && \
  IMAGE_TAG='${IMAGE_TAG}' docker compose up -d --wait"

echo "→ Verificando HTTPS y basic auth"
if command -v curl >/dev/null 2>&1; then
  code=""
  for _ in $(seq 1 10); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "https://${SERVER_HOST}/" || true)"
    [[ "$code" == "401" ]] && break
    sleep 2
  done
  if [[ "$code" == "401" ]]; then
    echo "   OK: https://${SERVER_HOST}/ responde 401 (basic auth activo)."
  else
    echo "   Aviso: esperaba 401 y obtuve '${code}'. Revisá DNS, Traefik y BASIC_AUTH_USERS." >&2
  fi
else
  echo "   curl no está instalado; no hice la verificación externa."
fi

echo
echo "Deploy OK: https://${SERVER_HOST}/"
echo "Imagen:    avatar:${IMAGE_TAG}"
echo "Rollback:  ssh ${REMOTE} \"cd ${DEPLOY_PATH} && IMAGE_TAG=<sha-viejo> docker compose up -d --no-build --wait\""
