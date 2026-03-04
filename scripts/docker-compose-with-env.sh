#!/usr/bin/env bash

set -euo pipefail

# Cross-platform docker-compose launcher for this repo.
# Why this exists:
# - We run compose on macOS and WSL/Linux.
# - The server container needs Docker socket access for Testcontainers.
# - UID/GID and socket-group behavior differ by host/runtime.
#
# macOS (Docker Desktop):
# - The active socket may be exposed via Docker context/DOCKER_HOST or
#   ~/.docker/run/docker.sock, not always /var/run/docker.sock.
# - Even when host-side socket metadata looks non-root, the mounted socket can
#   appear inside Linux containers as root:root with mode 660.
# - Because Compose user/group values are decided on the mac host, host-side
#   gid checks are not always enough to predict container-side socket access.
# - For reliability, this script defaults to running services as root on macOS
#   (opt-out available) so Docker-in-container flows (Testcontainers) work.
#
# WSL/Linux:
# - The socket is typically /var/run/docker.sock with a non-root group
#   (for example "docker"), so mapping host uid/gid and socket gid works.

resolve_docker_socket() {
  local endpoint path

  # 1) Respect an explicit DOCKER_HOST unix endpoint when present.
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

  # 2) Use the active Docker context endpoint (works well on macOS Desktop).
  endpoint="$(docker context inspect --format '{{ .Endpoints.docker.Host }}' 2>/dev/null || true)"
  case "${endpoint}" in
    unix://*)
      path="${endpoint#unix://}"
      if [ -S "${path}" ]; then
        printf '%s\n' "${path}"
        return 0
      fi
      ;;
  esac

  # 3) Fallback paths:
  #    - /var/run/docker.sock (common on WSL/Linux)
  #    - ~/.docker/run/docker.sock (common on macOS Docker Desktop)
  for path in /var/run/docker.sock "${HOME:-}/.docker/run/docker.sock"; do
    if [ -S "${path}" ]; then
      printf '%s\n' "${path}"
      return 0
    fi
  done

  printf '%s\n' "/var/run/docker.sock"
}

SOCKET_PATH="$(resolve_docker_socket)"
SOCKET_GID="$(stat -c %g "${SOCKET_PATH}" 2>/dev/null || stat -f %g "${SOCKET_PATH}" 2>/dev/null || echo 0)"
HOST_OS="$(uname -s 2>/dev/null || echo unknown)"

DOCKER_UID="$(id -u)"
DOCKER_GID="$(id -g)"

# macOS default:
# - Force compose service user to root unless explicitly disabled.
# - This avoids host->container socket ownership translation surprises.
if [ "${HOST_OS}" = "Darwin" ] && [ "${CODEINFO_DOCKER_FORCE_ROOT_ON_DARWIN:-1}" = "1" ]; then
  DOCKER_UID=0
  DOCKER_GID=0
# Non-mac fallback:
# - If socket gid is 0, treat it as a root-owned socket case and fallback to
#   root so /var/run/docker.sock remains accessible.
# - Disable with CODEINFO_DOCKER_FORCE_ROOT_WHEN_SOCK_GID_0=0.
elif [ "${SOCKET_GID}" = "0" ] && [ "${CODEINFO_DOCKER_FORCE_ROOT_WHEN_SOCK_GID_0:-1}" = "1" ]; then
  DOCKER_UID=0
  DOCKER_GID=0
fi

export CODEINFO_DOCKER_UID="${DOCKER_UID}"
export CODEINFO_DOCKER_GID="${DOCKER_GID}"
export CODEINFO_DOCKER_SOCK_GID="${SOCKET_GID}"

compose_args="$*"
if [[ "${compose_args}" == *"--env-file .env.e2e"* ]]; then
  export CODEINFO_COMPOSE_WORKFLOW="e2e"
  export CODEINFO_INTERPOLATION_SOURCE=".env.e2e"
  export CODEINFO_RUNTIME_ENV_FILE_SOURCE="unchanged"
else
  if [[ "${compose_args}" == *"-f docker-compose.local.yml"* ]]; then
    export CODEINFO_COMPOSE_WORKFLOW="compose:local"
  else
    export CODEINFO_COMPOSE_WORKFLOW="compose"
  fi
  export CODEINFO_INTERPOLATION_SOURCE="server/.env+server/.env.local"
  export CODEINFO_RUNTIME_ENV_FILE_SOURCE="unchanged"
fi

exec docker compose "$@"
