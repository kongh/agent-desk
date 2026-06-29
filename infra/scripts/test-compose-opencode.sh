#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-infra/compose/docker-compose.opencode.yml}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3101}"
PROMPT="${PROMPT:-请直接写入 output/report.md，内容为：# Docker OpenCode 验证\n\nOK。不要反问。}"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
}

dump_logs() {
  docker compose -f "$COMPOSE_FILE" ps || true
  docker compose -f "$COMPOSE_FILE" logs --no-color api opencode || true
}

dump_task() {
  if [ -z "${task_id:-}" ]; then
    return
  fi

  echo "==> Task payload"
  curl -fsS "$BASE_URL/api/tasks" | node -e '
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const task = input.tasks.find((item) => item.id === process.argv[1]);
console.log(JSON.stringify(task ?? null, null, 2));
' "$task_id" || true
}

trap cleanup EXIT

echo "==> Checking compose config"
docker compose -f "$COMPOSE_FILE" config >/dev/null

echo "==> Building api and opencode images"
docker compose -f "$COMPOSE_FILE" build api opencode

echo "==> Starting opencode and api services"
docker compose -f "$COMPOSE_FILE" up -d opencode api

echo "==> Waiting for api health"
health_json=""
for attempt in $(seq 1 30); do
  if health_json="$(curl -fsS "$BASE_URL/api/health" 2>/dev/null)"; then
    break
  fi

  if [ "$attempt" = "30" ]; then
    echo "ERROR: api health check failed"
    dump_logs
    exit 1
  fi

  sleep 1
done

workspace_root="$(node -e 'const input = JSON.parse(process.argv[1]); process.stdout.write(input.workspaceRoot ?? "")' "$health_json")"
if [ "$workspace_root" != "/workspace/workspaces" ]; then
  echo "ERROR: health check reached an unexpected API instance"
  echo "$health_json"
  echo "Expected workspaceRoot=/workspace/workspaces"
  dump_logs
  exit 1
fi

echo "==> Creating OpenCode SDK task"
task_json="$(curl -fsS "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"$PROMPT\",\"agent\":\"deep-research\"}")"

task_id="$(node -e 'const input = JSON.parse(process.argv[1]); process.stdout.write(input.task.id)' "$task_json")"
echo "task.id=$task_id"

echo "==> Waiting for task completion"
for attempt in $(seq 1 90); do
  task_status="$(curl -fsS "$BASE_URL/api/tasks" | node -e '
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const task = input.tasks.find((item) => item.id === process.argv[1]);
process.stdout.write(task?.status ?? "missing");
' "$task_id")"

  if [ "$task_status" = "completed" ]; then
    echo "OK: task completed"
    curl -fsS "$BASE_URL/api/tasks/$task_id/files"
    echo
    exit 0
  fi

  if [ "$task_status" = "failed" ]; then
    echo "ERROR: task failed"
    dump_task
    dump_logs
    exit 1
  fi

  sleep 2
done

echo "ERROR: timed out waiting for task completion"
dump_task
dump_logs
exit 1
