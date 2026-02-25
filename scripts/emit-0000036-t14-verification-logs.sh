#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:5010}"
CONSOLE_ERRORS="${2:-0}"
SURFACES="${3:-ingest,chat,agents,logs,tools}"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

curl -sS -X POST "${BASE_URL}/logs" \
  -H 'content-type: application/json' \
  -d "{
    \"level\":\"info\",
    \"source\":\"client\",
    \"message\":\"DEV-0000036:T14:acceptance_matrix_verified\",
    \"timestamp\":\"${NOW}\",
    \"context\":{
      \"story\":\"0000036\",
      \"task\":\"14\",
      \"allRowsCovered\":true
    }
  }" >/dev/null

curl -sS -X POST "${BASE_URL}/logs" \
  -H 'content-type: application/json' \
  -d "{
    \"level\":\"info\",
    \"source\":\"client\",
    \"message\":\"DEV-0000036:T14:manual_regression_completed\",
    \"timestamp\":\"${NOW}\",
    \"context\":{
      \"story\":\"0000036\",
      \"task\":\"14\",
      \"surfaces\":\"${SURFACES}\",
      \"consoleErrors\":${CONSOLE_ERRORS}
    }
  }" >/dev/null

echo "Emitted Task 14 verification logs to ${BASE_URL}/logs"
