#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-infra/compose/docker-compose.dev.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "==> Checking compose config"
docker compose -f "$COMPOSE_FILE" config >/dev/null

echo "==> Building api image"
docker compose -f "$COMPOSE_FILE" build api

echo "==> Starting api service"
docker compose -f "$COMPOSE_FILE" up -d api

echo "==> Waiting for health check"
for attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "OK: $HEALTH_URL"
    exit 0
  fi

  sleep 1
done

echo "ERROR: api health check failed"
docker compose -f "$COMPOSE_FILE" ps
docker compose -f "$COMPOSE_FILE" logs --no-color api
exit 1
