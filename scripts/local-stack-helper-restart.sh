#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/local-stack-helper-restart.sh [options]

Restarts the codeinfo:local stack by running the checked-in compose wrapper
from an environment that is outside the live local stack.

Options:
  --repo-root PATH        Repository root to operate on.
  --log-path PATH         Log file path for helper output.
  --delay-seconds N       Delay before starting the restart sequence.
  --dry-run               Print the commands without executing them.
  --help                  Show this help text.
EOF
}

resolve_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/.." && pwd
}

quote_command() {
  local quoted=()
  local arg
  for arg in "$@"; do
    quoted+=("$(printf '%q' "${arg}")")
  done
  printf '%s' "${quoted[*]}"
}

log_line() {
  local message="$1"
  mkdir -p "$(dirname "${LOG_PATH}")"
  printf '[local-stack-helper] %s\n' "${message}" | tee -a "${LOG_PATH}"
}

run_or_echo() {
  local rendered
  rendered="$(quote_command "$@")"
  if [ "${DRY_RUN}" = "1" ]; then
    log_line "DRY RUN ${rendered}"
    return 0
  fi

  log_line "RUN ${rendered}"
  "$@" 2>&1 | tee -a "${LOG_PATH}"
}

REPO_ROOT="${CODEINFO_LOCAL_HELPER_REPO_ROOT:-$(resolve_repo_root)}"
DELAY_SECONDS="${CODEINFO_LOCAL_HELPER_DELAY_SECONDS:-5}"
LOG_PATH="${CODEINFO_LOCAL_HELPER_LOG_PATH:-${REPO_ROOT}/logs/local-stack-helper-restart.log}"
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --log-path)
      LOG_PATH="$2"
      shift 2
      ;;
    --delay-seconds)
      DELAY_SECONDS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "${DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
  printf 'Delay must be a non-negative integer, got: %s\n' "${DELAY_SECONDS}" >&2
  exit 1
fi

cd "${REPO_ROOT}"
export CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${REPO_ROOT}"

compose_wrapper=(
  bash
  "${REPO_ROOT}/scripts/docker-compose-with-env.sh"
  --env-file
  server/.env
  --env-file
  server/.env.local
  --env-file
  client/.env.local
  -f
  docker-compose.local.yml
)

log_line "repo_root=${REPO_ROOT}"
log_line "log_path=${LOG_PATH}"
log_line "delay_seconds=${DELAY_SECONDS}"

if [ "${DELAY_SECONDS}" -gt 0 ]; then
  if [ "${DRY_RUN}" = "1" ]; then
    log_line "DRY RUN sleep ${DELAY_SECONDS}"
  else
    log_line "Sleeping for ${DELAY_SECONDS} seconds before restart"
    sleep "${DELAY_SECONDS}"
  fi
fi

run_or_echo "${compose_wrapper[@]}" down
run_or_echo "${compose_wrapper[@]}" build
run_or_echo "${compose_wrapper[@]}" up -d

log_line "Completed local stack restart sequence"
