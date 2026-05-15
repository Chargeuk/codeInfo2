#!/usr/bin/env bash

set -euo pipefail

DOCKER_BIN="${CODEINFO_DOCKER_BIN:-docker}"

usage() {
  cat <<'EOF'
Usage: scripts/launch-local-stack-helper.sh [options]

Builds and launches a detached helper container that can restart the
codeinfo:local stack from outside the stack itself.

Options:
  --repo-root PATH           Repository root to mount into the helper.
  --image-tag TAG            Docker image tag to build and run.
  --container-name NAME      Detached helper container name.
  --delay-seconds N          Delay before restart begins inside the helper.
  --log-relative-path PATH   Repo-relative log path written by the helper.
  --helper-dry-run           Launch the helper container in dry-run mode.
  --skip-image-build         Reuse an existing helper image.
  --dry-run                  Print the docker commands without executing them.
  --help                     Show this help text.
EOF
}

resolve_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/.." && pwd
}

resolve_docker_socket() {
  local path
  if [ -n "${CODEINFO_LOCAL_HELPER_SOCKET_PATH:-}" ]; then
    printf '%s\n' "${CODEINFO_LOCAL_HELPER_SOCKET_PATH}"
    return 0
  fi

  if [ -n "${DOCKER_HOST:-}" ]; then
    case "${DOCKER_HOST}" in
      unix://*)
        path="${DOCKER_HOST#unix://}"
        if [ -S "${path}" ]; then
          printf '%s\n' "${path}"
          return 0
        fi
        ;;
    esac
  fi

  for path in /var/run/docker.sock "${HOME:-}/.docker/run/docker.sock"; do
    if [ -S "${path}" ]; then
      printf '%s\n' "${path}"
      return 0
    fi
  done

  printf 'Unable to find a Docker socket to mount into the helper container.\n' >&2
  exit 1
}

quote_command() {
  local quoted=()
  local arg
  for arg in "$@"; do
    quoted+=("$(printf '%q' "${arg}")")
  done
  printf '%s' "${quoted[*]}"
}

run_or_echo() {
  local rendered
  rendered="$(quote_command "$@")"
  if [ "${DRY_RUN}" = "1" ]; then
    printf '[local-stack-helper-launcher] DRY RUN %s\n' "${rendered}"
    return 0
  fi

  printf '[local-stack-helper-launcher] RUN %s\n' "${rendered}"
  "$@"
}

remove_existing_helper() {
  if [ "${DRY_RUN}" = "1" ]; then
    printf '[local-stack-helper-launcher] DRY RUN %s rm -f %s\n' "${DOCKER_BIN}" "${CONTAINER_NAME}"
    return 0
  fi

  printf '[local-stack-helper-launcher] RUN %s rm -f %s\n' "${DOCKER_BIN}" "${CONTAINER_NAME}"
  "${DOCKER_BIN}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}

REPO_ROOT="${CODEINFO_LOCAL_HELPER_REPO_ROOT:-$(resolve_repo_root)}"
IMAGE_TAG="${CODEINFO_LOCAL_HELPER_IMAGE_TAG:-codeinfo2-local-restarter:latest}"
CONTAINER_NAME="${CODEINFO_LOCAL_HELPER_CONTAINER_NAME:-codeinfo2-local-restarter}"
DELAY_SECONDS="${CODEINFO_LOCAL_HELPER_DELAY_SECONDS:-5}"
LOG_RELATIVE_PATH="${CODEINFO_LOCAL_HELPER_LOG_RELATIVE_PATH:-logs/local-stack-helper-restart.log}"
HELPER_DRY_RUN=0
SKIP_IMAGE_BUILD=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --container-name)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --delay-seconds)
      DELAY_SECONDS="$2"
      shift 2
      ;;
    --log-relative-path)
      LOG_RELATIVE_PATH="$2"
      shift 2
      ;;
    --helper-dry-run)
      HELPER_DRY_RUN=1
      shift
      ;;
    --skip-image-build)
      SKIP_IMAGE_BUILD=1
      shift
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

case "${LOG_RELATIVE_PATH}" in
  /*)
    printf 'Log path must be repository-relative, got absolute path: %s\n' "${LOG_RELATIVE_PATH}" >&2
    exit 1
    ;;
esac

SOCKET_PATH="$(resolve_docker_socket)"
CONTAINER_LOG_PATH="/workspace/${LOG_RELATIVE_PATH}"
helper_args=(
  bash
  /workspace/scripts/local-stack-helper-restart.sh
  --repo-root
  /workspace
  --delay-seconds
  "${DELAY_SECONDS}"
  --log-path
  "${CONTAINER_LOG_PATH}"
)

if [ "${HELPER_DRY_RUN}" = "1" ]; then
  helper_args+=(--dry-run)
fi

if [ "${SKIP_IMAGE_BUILD}" != "1" ]; then
  run_or_echo "${DOCKER_BIN}" build -f "${REPO_ROOT}/Dockerfile.local-restarter" -t "${IMAGE_TAG}" "${REPO_ROOT}"
fi

remove_existing_helper
run_or_echo \
  "${DOCKER_BIN}" run -d \
  --name "${CONTAINER_NAME}" \
  -v "${SOCKET_PATH}:/var/run/docker.sock" \
  -v "${REPO_ROOT}:/workspace" \
  -w /workspace \
  -e "CODEINFO_LOCAL_HELPER_REPO_ROOT=/workspace" \
  -e "CODEINFO_LOCAL_HELPER_DELAY_SECONDS=${DELAY_SECONDS}" \
  -e "CODEINFO_LOCAL_HELPER_LOG_PATH=${CONTAINER_LOG_PATH}" \
  "${IMAGE_TAG}" \
  "${helper_args[@]}"
