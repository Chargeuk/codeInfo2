#!/usr/bin/env bash

set -euo pipefail

CODEINFO_COMPOSE_PREFLIGHT_MARKER="DEV-0000050:T09:compose_preflight_result"
DOCKER_BIN="${CODEINFO_DOCKER_BIN:-docker}"

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

docker_cmd() {
  "${DOCKER_BIN}" "$@"
}

PORT_PROBE_LAST_ERROR=""

json_bool() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON)
      printf 'true'
      ;;
    *)
      printf 'false'
      ;;
  esac
}

emit_compose_preflight_marker() {
  local result="$1"
  local compose_file="$2"
  local playwright_present="$3"
  local checked_ports_csv="$4"

  node -e '
const [marker, composeFile, result, playwrightPresent, checkedPortsCsv] = process.argv.slice(1);
const checkedPorts = checkedPortsCsv
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => Number(value));
console.log(`${marker} ${JSON.stringify({
  composeFile,
  result,
  playwrightServicePresent: playwrightPresent === "true",
  checkedPorts,
})}`);
' "${CODEINFO_COMPOSE_PREFLIGHT_MARKER}" "${compose_file}" "${result}" "${playwright_present}" "${checked_ports_csv}"
}

fail_preflight() {
  local compose_file="$1"
  local playwright_present="$2"
  local checked_ports_csv="$3"
  local message="$4"

  emit_compose_preflight_marker "failed" "${compose_file}" "${playwright_present}" "${checked_ports_csv}"
  printf '%s\n' "${message}" >&2
  exit 1
}

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
  endpoint="$(docker_cmd context inspect --format '{{ .Endpoints.docker.Host }}' 2>/dev/null || true)"
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

parse_compose_args() {
  COMPOSE_FILES=()
  COMPOSE_OPTIONS=()
  COMPOSE_SUBCOMMAND=""
  COMPOSE_SUBCOMMAND_ARGS=()

  while [ "$#" -gt 0 ]; do
    if [ -z "${COMPOSE_SUBCOMMAND}" ]; then
      case "$1" in
        -f | --file | --env-file | -p | --project-name | --profile | --project-directory | --ansi | --progress)
          if [ "$#" -lt 2 ]; then
            printf 'CODEINFO compose wrapper failed: option %s requires a value\n' "$1" >&2
            exit 1
          fi
          if [ "$1" = "-f" ] || [ "$1" = "--file" ]; then
            COMPOSE_FILES+=("$2")
          fi
          COMPOSE_OPTIONS+=("$1" "$2")
          shift 2
          continue
          ;;
        --file=* | --env-file=* | --project-name=* | --profile=* | --project-directory=* | --ansi=* | --progress=*)
          case "$1" in
            --file=*)
              COMPOSE_FILES+=("${1#*=}")
              ;;
          esac
          COMPOSE_OPTIONS+=("$1")
          shift
          continue
          ;;
        -*)
          COMPOSE_OPTIONS+=("$1")
          shift
          continue
          ;;
        *)
          COMPOSE_SUBCOMMAND="$1"
          shift
          continue
          ;;
      esac
    fi

    COMPOSE_SUBCOMMAND_ARGS+=("$1")
    shift
  done

  if [ "${#COMPOSE_FILES[@]}" -eq 0 ]; then
    COMPOSE_FILES=("docker-compose.yml")
  fi
}

compose_profile_for_files() {
  local file
  for file in "${COMPOSE_FILES[@]}"; do
    case "$(basename "${file}")" in
      docker-compose.local.yml)
        printf 'local\n'
        return 0
        ;;
      docker-compose.e2e.yml)
        printf 'e2e\n'
        return 0
        ;;
    esac
  done
  printf 'main\n'
}

compose_files_display() {
  local joined=""
  local file
  for file in "${COMPOSE_FILES[@]}"; do
    if [ -n "${joined}" ]; then
      joined="${joined},"
    fi
    joined="${joined}${file}"
  done
  printf '%s\n' "${joined}"
}

repo_root_for_compose_wrapper() {
  if [ -n "${CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE:-}" ]; then
    printf '%s\n' "${CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE}"
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/.." && pwd
}

ensure_optional_local_env_files_exist() {
  local repo_root env_local_path
  repo_root="$(repo_root_for_compose_wrapper)"

  for env_local_path in \
    "${repo_root}/server/.env.local" \
    "${repo_root}/client/.env.local"; do
    mkdir -p "$(dirname "${env_local_path}")"
    if [ ! -e "${env_local_path}" ]; then
      : > "${env_local_path}"
    fi
  done
}

ensure_repo_bind_mount_dirs_for_profile() {
  case "${COMPOSE_SUBCOMMAND}" in
    up | start | restart | run | create)
      ;;
    *)
      return 0
      ;;
  esac

  local compose_profile repo_root
  compose_profile="$(compose_profile_for_files)"
  repo_root="$(repo_root_for_compose_wrapper)"

  mkdir -p "${repo_root}/logs"

  if [ "${compose_profile}" = "local" ]; then
    mkdir -p \
      "${repo_root}/codex" \
      "${repo_root}/codex/chat" \
      "${repo_root}/codex_agents" \
      "${repo_root}/flows" \
      "${repo_root}/flows-sandbox" \
      "${repo_root}/playwright-output-local"
  fi
}

should_run_compose_preflight() {
  case "${COMPOSE_SUBCOMMAND}" in
    up | start | restart | run | create | config)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

should_check_host_ports() {
  case "${COMPOSE_SUBCOMMAND}" in
    up | start | restart | run | create)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

render_compose_config_json() {
  docker_cmd compose "${COMPOSE_OPTIONS[@]}" config --format json
}

inspect_compose_config_json() {
  node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const data = JSON.parse(input || "{}");
  const services = data.services ?? {};
  const hostNetworkServices = [];
  const invalidHostNetworkShapes = [];

  for (const [serviceName, serviceDefinition] of Object.entries(services)) {
    if (serviceDefinition?.network_mode === "host") {
      hostNetworkServices.push(serviceName);

      if (Array.isArray(serviceDefinition.ports) && serviceDefinition.ports.length > 0) {
        invalidHostNetworkShapes.push(`${serviceName}:ports`);
      }

      const networks = serviceDefinition.networks;
      if (
        (Array.isArray(networks) && networks.length > 0) ||
        (networks && typeof networks === "object" && Object.keys(networks).length > 0)
      ) {
        invalidHostNetworkShapes.push(`${serviceName}:networks`);
      }
    }
  }

  const hasService = (serviceName) => Object.prototype.hasOwnProperty.call(services, serviceName);
  const portProbeImage =
    (typeof services.server?.image === "string" ? services.server.image : "") ||
    hostNetworkServices
      .map((serviceName) => services?.[serviceName]?.image)
      .find((image) => typeof image === "string" && image.length > 0) ||
    "";

  const lines = [
    `hostNetworkServices=${hostNetworkServices.join(",")}`,
    `invalidHostNetworkShapes=${invalidHostNetworkShapes.join("|")}`,
    `hostNetworkServiceCount=${hostNetworkServices.length}`,
    `playwrightServicePresent=${hasService("playwright-mcp")}`,
    `serverServicePresent=${hasService("server")}`,
    `portProbeImage=${portProbeImage}`,
  ];

  process.stdout.write(lines.join("\n"));
});
'
}

determine_checked_ports_csv() {
  local compose_profile="$1"
  local host_network_services_csv="$2"
  local checked_ports=""
  local host_network_services=",$(printf '%s' "${host_network_services_csv}" | tr -d '[:space:]'),"

  case "${compose_profile}" in
    local)
      if [[ "${host_network_services}" == *,server,* ]]; then
        checked_ports="5510,5511,5512,9222"
      fi
      if [[ "${host_network_services}" == *,playwright-mcp,* ]]; then
        checked_ports="${checked_ports:+${checked_ports},}8931"
      fi
      ;;
    e2e)
      if [[ "${host_network_services}" == *,server,* ]]; then
        checked_ports="6010,6011,6012"
      fi
      ;;
    *)
      if [[ "${host_network_services}" == *,server,* ]]; then
        checked_ports="5010,5011,5012"
      fi
      if [[ "${host_network_services}" == *,playwright-mcp,* ]]; then
        checked_ports="${checked_ports:+${checked_ports},}8932"
      fi
      ;;
  esac

  printf '%s\n' "${checked_ports}"
}

docker_info_json() {
  docker_cmd info --format '{{json .}}' 2>/dev/null || true
}

docker_info_field() {
  local field_name="$1"

  node -e '
const [fieldName] = process.argv.slice(1);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (!input.trim()) {
    process.stdout.write("");
    return;
  }
  const data = JSON.parse(input);
  const value = data?.[fieldName];
  process.stdout.write(typeof value === "string" ? value : "");
});
' "${field_name}"
}

ensure_host_network_environment_supported() {
  local compose_file_display="$1"
  local playwright_present="$2"
  local checked_ports_csv="$3"

  case "${CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE:-auto}" in
    0 | false | FALSE | no | NO | off | OFF)
      fail_preflight \
        "${compose_file_display}" \
        "${playwright_present}" \
        "${checked_ports_csv}" \
        "CODEINFO compose preflight failed for ${compose_file_display}: host networking is not supported for the checked-in compose workflow on this environment."
      ;;
    1 | true | TRUE | yes | YES | on | ON)
      return 0
      ;;
  esac

  local info_json operating_system server_version operating_system_lc
  info_json="$(docker_info_json)"
  operating_system="$(printf '%s' "${info_json}" | docker_info_field "OperatingSystem")"
  server_version="$(printf '%s' "${info_json}" | docker_info_field "ServerVersion")"
  operating_system_lc="$(printf '%s' "${operating_system}" | tr '[:upper:]' '[:lower:]')"

  if [[ "${operating_system_lc}" == *"docker desktop"* ]]; then
    local desktop_enabled="${CODEINFO_DOCKER_DESKTOP_HOST_NETWORKING_ENABLED:-auto}"
    case "${desktop_enabled}" in
      0 | false | FALSE | no | NO | off | OFF)
        fail_preflight \
          "${compose_file_display}" \
          "${playwright_present}" \
          "${checked_ports_csv}" \
          "CODEINFO compose preflight failed for ${compose_file_display}: Docker Desktop host networking is disabled for the checked-in compose workflow."
        ;;
    esac

    if [ -n "${server_version}" ]; then
      local major minor
      major="${server_version%%.*}"
      minor="${server_version#*.}"
      minor="${minor%%.*}"
      if [[ "${major}" =~ ^[0-9]+$ ]] && [[ "${minor}" =~ ^[0-9]+$ ]]; then
        if [ "${major}" -lt 4 ] || { [ "${major}" -eq 4 ] && [ "${minor}" -lt 34 ]; }; then
          fail_preflight \
            "${compose_file_display}" \
            "${playwright_present}" \
            "${checked_ports_csv}" \
            "CODEINFO compose preflight failed for ${compose_file_display}: Docker Desktop ${server_version} does not provide the host-network support required by the checked-in compose workflow."
        fi
      fi
    fi

    return 0
  fi

  if [ "${HOST_OS}" != "Linux" ] && [ "${HOST_OS}" != "Darwin" ]; then
    fail_preflight \
      "${compose_file_display}" \
      "${playwright_present}" \
      "${checked_ports_csv}" \
      "CODEINFO compose preflight failed for ${compose_file_display}: host networking is only supported for the checked-in compose workflow on Linux or compatible Docker Desktop environments."
  fi
}

is_port_occupied() {
  local port="$1"
  local probe_image="${2:-}"
  local occupied_ports=",${CODEINFO_TEST_OCCUPIED_PORTS:-},"
  local probe_status
  local had_errexit=0
  PORT_PROBE_LAST_ERROR=""

  run_docker_host_probe() {
    local had_errexit=0
    if [ -z "${probe_image}" ]; then
      PORT_PROBE_LAST_ERROR="docker-host port probe image is unavailable for checked host-port validation"
      return 2
    fi

    local probe_output probe_status
    case "$-" in
      *e*)
        had_errexit=1
        set +e
        ;;
    esac
    probe_output="$(
      docker_cmd run --rm --network host --entrypoint node "${probe_image}" -e '
const net = require("node:net");
const [portValue] = process.argv.slice(1);
const port = Number(portValue);
const socket = net.connect({ host: "127.0.0.1", port, timeout: 250 });
const finish = (occupied) => {
  socket.destroy();
  process.exit(occupied ? 0 : 1);
};
socket.once("connect", () => finish(true));
socket.once("timeout", () => finish(false));
socket.once("error", () => finish(false));
' "${port}" 2>&1
    )"
    probe_status=$?
    if [ "${had_errexit}" -eq 1 ]; then
      set -e
    fi

    case "${probe_status}" in
      0 | 1)
        return "${probe_status}"
        ;;
      *)
        probe_output="$(printf '%s' "${probe_output}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
        PORT_PROBE_LAST_ERROR="docker-host port probe failed for image ${probe_image} with exit ${probe_status}${probe_output:+: ${probe_output}}"
        return 2
        ;;
    esac
  }

  if [[ "${occupied_ports}" == *,"${port}",* ]]; then
    return 0
  fi

  case "${CODEINFO_HOST_PORT_CHECK_SCOPE:-auto}" in
    skip)
      return 1
      ;;
    docker_host)
      case "$-" in
        *e*)
          had_errexit=1
          set +e
          ;;
      esac
      run_docker_host_probe
      probe_status=$?
      if [ "${had_errexit}" -eq 1 ]; then
        set -e
      fi
      return "${probe_status}"
      ;;
    auto)
      if [ -f "/.dockerenv" ] || [ -n "${CODEINFO_TEST_RUNNING_IN_CONTAINER:-}" ]; then
        case "$-" in
          *e*)
            had_errexit=1
            set +e
            ;;
        esac
        run_docker_host_probe
        probe_status=$?
        if [ "${had_errexit}" -eq 1 ]; then
          set -e
        fi
        return "${probe_status}"
      fi
      ;;
    *)
      ;;
  esac

  case "${CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS:-0}" in
    1 | true | TRUE | yes | YES | on | ON)
      return 1
      ;;
  esac

  node -e '
const net = require("node:net");
const [portValue] = process.argv.slice(1);
const port = Number(portValue);
const socket = net.connect({ host: "127.0.0.1", port, timeout: 250 });
const finish = (occupied) => {
  socket.destroy();
  process.exit(occupied ? 0 : 1);
};
socket.once("connect", () => finish(true));
socket.once("timeout", () => finish(false));
socket.once("error", () => finish(false));
' "${port}"
}

run_compose_preflight_if_needed() {
  if ! should_run_compose_preflight; then
    return 0
  fi

  local compose_file_display compose_profile config_json
  compose_file_display="$(compose_files_display)"
  compose_profile="$(compose_profile_for_files)"

  if ! config_json="$(render_compose_config_json)"; then
    fail_preflight \
      "${compose_file_display}" \
      "false" \
      "" \
      "CODEINFO compose preflight failed for ${compose_file_display}: unable to render 'docker compose config --format json' for host-network validation."
  fi

  local inspection_output host_network_services_csv invalid_host_network_shapes host_network_service_count
  local playwright_service_present server_service_present checked_ports_csv port_probe_image
  inspection_output="$(printf '%s' "${config_json}" | inspect_compose_config_json)"
  host_network_services_csv="$(printf '%s\n' "${inspection_output}" | sed -n 's/^hostNetworkServices=//p')"
  invalid_host_network_shapes="$(printf '%s\n' "${inspection_output}" | sed -n 's/^invalidHostNetworkShapes=//p')"
  host_network_service_count="$(printf '%s\n' "${inspection_output}" | sed -n 's/^hostNetworkServiceCount=//p')"
  playwright_service_present="$(printf '%s\n' "${inspection_output}" | sed -n 's/^playwrightServicePresent=//p')"
  server_service_present="$(printf '%s\n' "${inspection_output}" | sed -n 's/^serverServicePresent=//p')"
  port_probe_image="$(printf '%s\n' "${inspection_output}" | sed -n 's/^portProbeImage=//p')"
  checked_ports_csv="$(determine_checked_ports_csv "${compose_profile}" "${host_network_services_csv}")"

  if [ "${host_network_service_count}" -gt 0 ]; then
    ensure_host_network_environment_supported "${compose_file_display}" "${playwright_service_present}" "${checked_ports_csv}"
  fi

  if [ -n "${invalid_host_network_shapes}" ]; then
    local invalid_entry service_name invalid_key
    IFS='|' read -r -a invalid_entries <<<"${invalid_host_network_shapes}"
    invalid_entry="${invalid_entries[0]}"
    service_name="${invalid_entry%%:*}"
    invalid_key="${invalid_entry#*:}"
    fail_preflight \
      "${compose_file_display}" \
      "${playwright_service_present}" \
      "${checked_ports_csv}" \
      "CODEINFO compose preflight failed for ${compose_file_display} service ${service_name}: host-network service definitions cannot declare '${invalid_key}'."
  fi

  if should_check_host_ports && [ -n "${checked_ports_csv}" ]; then
    local port port_status
    IFS=',' read -r -a checked_ports <<<"${checked_ports_csv}"
    for port in "${checked_ports[@]}"; do
      set +e
      is_port_occupied "${port}" "${port_probe_image}"
      port_status=$?
      set -e

      case "${port_status}" in
        0)
          fail_preflight \
            "${compose_file_display}" \
            "${playwright_service_present}" \
            "${checked_ports_csv}" \
            "CODEINFO compose preflight failed for ${compose_file_display}: required host port ${port} is already in use."
          ;;
        1)
          ;;
        2)
          fail_preflight \
            "${compose_file_display}" \
            "${playwright_service_present}" \
            "${checked_ports_csv}" \
            "CODEINFO compose preflight failed for ${compose_file_display}: unable to verify required host port ${port} because ${PORT_PROBE_LAST_ERROR}."
          ;;
        *)
          fail_preflight \
            "${compose_file_display}" \
            "${playwright_service_present}" \
            "${checked_ports_csv}" \
            "CODEINFO compose preflight failed for ${compose_file_display}: host-port preflight returned unexpected status ${port_status} for port ${port}."
          ;;
      esac
    done
  fi

  if [ "${compose_profile}" = "local" ] && [ "${host_network_service_count}" -gt 0 ] && [ "${server_service_present}" = "true" ]; then
    case ",${checked_ports_csv}," in
      *,9222,*)
        ;;
      *)
        fail_preflight \
          "${compose_file_display}" \
          "${playwright_service_present}" \
          "${checked_ports_csv}" \
          "CODEINFO compose preflight failed for ${compose_file_display} service server: the local host-network manual-testing contract must keep Chrome DevTools on port 9222."
        ;;
    esac
  fi

  emit_compose_preflight_marker "passed" "${compose_file_display}" "${playwright_service_present}" "${checked_ports_csv}"
}

parse_compose_args "$@"
ensure_optional_local_env_files_exist
ensure_repo_bind_mount_dirs_for_profile

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

run_compose_preflight_if_needed

exec "${DOCKER_BIN}" compose "$@"
