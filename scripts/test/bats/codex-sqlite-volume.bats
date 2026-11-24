#!/usr/bin/env bats
load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
  export SQLITE_TMP
  SQLITE_TMP="$(mktemp -d /tmp/cisql.XXXXXX)"
  export CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${SQLITE_TMP}"
  export CODEINFO_TEST_DOCKER_FIXTURE_LOG="${SQLITE_TMP}/docker.log"
  export CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${CODEINFO2_COMPOSE_FIXTURE_DIR}/host-network-local-valid.json"
  export CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS=1
  export CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1
  export CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}"
  export CODEINFO_TEST_DOCKER_INFO_JSON='{"OperatingSystem":"Docker Desktop","ServerVersion":"28.3.2"}'
  export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT='CODEINFO_CODEX_SQLITE_VOLUME=1'
  export HOME="${SQLITE_TMP}/home"
  mkdir -p "${HOME}/.docker/run" "${SQLITE_TMP}/bin" "${SQLITE_TMP}/scripts"
  printf 'services: {}\n' > "${SQLITE_TMP}/docker-compose.yml"
  python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "${HOME}/.docker/run/docker.sock"
  export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
  unset DOCKER_CONTEXT
  cp "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" "${SQLITE_TMP}/scripts/"
  printf '#!/bin/sh\nprintf "%%s\\n" "${CODEINFO_TEST_HOST_OS:-Darwin}"\n' > "${SQLITE_TMP}/bin/uname"
  chmod +x "${SQLITE_TMP}/bin/uname"
  export PATH="${SQLITE_TMP}/bin:${PATH}"
}

teardown() { rm -rf "${SQLITE_TMP}"; }

run_sqlite_wrapper() {
  run bash "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh" -f "${SQLITE_TMP}/$1" "${2:-config}"
}

@test "SQLite opt-in adds only a project scoped additive override on main and local" {
  for base in docker-compose.yml docker-compose.local.yml; do
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    run_sqlite_wrapper "${base}"
    assert_success
    run grep -F -- "-f ${SQLITE_TMP}/${base} -f ${SQLITE_TMP}/docker-compose.codex-sqlite.yml config" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_success
  done
}

@test "SQLite opt-in stays off when unset, Linux, WSL, remote, non-Desktop or E2E" {
  for reason in unset linux wsl remote engine e2e custom; do
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    (
      case "${reason}" in
        unset) export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT='' ;;
        linux | wsl) export CODEINFO_TEST_HOST_OS=Linux ;;
        remote) export DOCKER_HOST=tcp://remote:2376 ;;
        engine) export CODEINFO_TEST_DOCKER_INFO_JSON='{"OperatingSystem":"Docker Engine - Community"}' ;;
      esac
      base=docker-compose.yml
      if [ "${reason}" = e2e ]; then base=docker-compose.e2e.yml; fi
      if [ "${reason}" = custom ]; then base=custom/docker-compose.yml; fi
      run_sqlite_wrapper "${base}"
      assert_success
    )
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
  done
}

@test "remote selected context cannot opt in through a local DOCKER_HOST fallback" {
  export DOCKER_CONTEXT=remote
  export CODEINFO_TEST_DOCKER_CONTEXT_ENDPOINT=ssh://remote
  run_sqlite_wrapper docker-compose.yml
  assert_success
  run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "SQLite flag uses Compose-resolved environment without executing dotenv content" {
  export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT="$(printf '%s\n' 'CODEINFO_CODEX_SQLITE_VOLUME=1' 'OTHER=$(touch should-not-exist)')"
  run_sqlite_wrapper docker-compose.yml
  assert_success
  [ ! -e should-not-exist ]
  refute_output --partial 'OTHER'
}

@test "SQLite seed is local-only and hash verified before mounting" {
  local seed="${SQLITE_TMP}/verified.sqlite" digest
  printf 'verified-by-recovery-worker' > "${seed}"
  digest="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "${seed}")"
  export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT="$(printf '%s\n' 'CODEINFO_CODEX_SQLITE_VOLUME=1' "CODEINFO_CODEX_SQLITE_THREAD_HISTORY_SEED=${seed}" "CODEINFO_CODEX_SQLITE_THREAD_HISTORY_SHA256=${digest}")"
  run_sqlite_wrapper docker-compose.yml
  assert_failure
  assert_output --partial 'only for compose:local'
  run_sqlite_wrapper docker-compose.local.yml
  assert_success
  run grep -F -- "-f ${SQLITE_TMP}/docker-compose.codex-sqlite-seed.yml config" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  printf 'changed' >> "${seed}"
  run_sqlite_wrapper docker-compose.local.yml
  assert_failure
  assert_output --partial 'verified SHA-256'
}

@test "startup refuses another legacy source writer but allows opted-in servers" {
  local config="${SQLITE_TMP}/source.json"
  printf '%s' '{"services":{"server":{"volumes":[{"type":"bind","source":"/test/codex","target":"/app/codex"}]}}}' > "${config}"
  export CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${config}"
  export CODEINFO_TEST_DOCKER_PS_OUTPUT=source-container
  export CODEINFO_TEST_DOCKER_INSPECT_OUTPUT='[{"Name":"legacy","Mounts":[{"Source":"/test/codex"}],"active":false}]'
  run_sqlite_wrapper docker-compose.local.yml up
  assert_failure
  assert_output --partial 'stop the existing Codex source writer'
  export CODEINFO_TEST_DOCKER_INSPECT_OUTPUT='[{"Name":"ready","Mounts":[{"Source":"/test/codex"}],"active":true}]'
  run_sqlite_wrapper docker-compose.local.yml up
  assert_success
}

@test "optional state recovery is independently verified and mounted only on local" {
  local seed="${SQLITE_TMP}/state.sqlite" digest
  printf 'independently-verified-state' > "${seed}"
  digest="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "${seed}")"
  export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT="$(printf '%s\n' 'CODEINFO_CODEX_SQLITE_VOLUME=1' "CODEINFO_CODEX_SQLITE_STATE_SEED=${seed}" "CODEINFO_CODEX_SQLITE_STATE_SHA256=${digest}")"
  run_sqlite_wrapper docker-compose.local.yml
  assert_success
  run grep -F -- "-f ${SQLITE_TMP}/docker-compose.codex-sqlite-state-seed.yml config" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  run_sqlite_wrapper docker-compose.yml
  assert_failure
  assert_output --partial 'only for compose:local'
}

@test "one-off initialization checks source writers before running" {
  local config="${SQLITE_TMP}/source.json"
  printf '%s' '{"services":{"server":{"volumes":[{"type":"bind","source":"/test/codex","target":"/app/codex"}],"environment":{"SECRET":"must-stay-private"}}}}' > "${config}"
  export CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${config}"
  export CODEINFO_TEST_DOCKER_PS_OUTPUT=source-container
  export CODEINFO_TEST_DOCKER_INSPECT_OUTPUT='[{"Name":"legacy","Mounts":[{"Source":"/test/codex"}],"active":false}]'
  run_sqlite_wrapper docker-compose.local.yml run
  assert_failure
  assert_output --partial 'stop the existing Codex source writer'
  refute_output --partial 'must-stay-private'
  run grep -F -- 'must-stay-private' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "implicit main selection opts in only when Compose-resolved COMPOSE_FILE is blank" {
  # node resolves cwd physically; macOS /tmp is a symlink to /private/tmp.
  SQLITE_TMP="$(cd "${SQLITE_TMP}" && pwd -P)"
  export CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${SQLITE_TMP}"
  for selected in '' docker-compose.e2e.yml; do
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT="$(printf '%s\n' 'CODEINFO_CODEX_SQLITE_VOLUME=1' "COMPOSE_FILE=${selected}")"
    run bash -c 'cd "$1" && exec bash "$2" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
    assert_success
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    if [ -z "${selected}" ]; then assert_success; else assert_failure; fi
  done
}

@test "bind writer check covers writable parents but ignores readonly mounts and siblings" {
  local descriptor='{"type":"bind","sourceName":"/test/repo/codex"}'
  for source in /test/repo/codex /test/repo /test /; do
    run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< "[{\"Name\":\"legacy\",\"Mounts\":[{\"Type\":\"bind\",\"Source\":\"${source}\",\"RW\":true}],\"active\":false}]"
    assert_failure
    assert_output --partial 'stop the existing Codex source writer'
  done
  for source in /test/repo/codex-other /test/repo-other /test/other; do
    run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< "[{\"Name\":\"sibling\",\"Mounts\":[{\"Type\":\"bind\",\"Source\":\"${source}\",\"RW\":true}],\"active\":false}]"
    assert_success
  done
  for source in /test/repo/codex /test/repo; do
    run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< "[{\"Name\":\"reader\",\"Mounts\":[{\"Type\":\"bind\",\"Source\":\"${source}\",\"RW\":false}],\"active\":false}]"
    assert_success
  done
  run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< '[{"Name":"ready","Mounts":[{"Type":"bind","Source":"/test/repo","RW":true}],"active":true}]'
  assert_success
}

@test "named volume writer matching stays exact with its active-container exemption" {
  local descriptor='{"type":"volume","sourceName":"project_codex-data"}'
  run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< '[{"Name":"legacy","Mounts":[{"Type":"volume","Name":"project_codex-data","RW":true}],"active":false}]'
  assert_failure
  run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< '[{"Name":"other","Mounts":[{"Type":"volume","Name":"project_codex-data-other","RW":true}],"active":false}]'
  assert_success
  run node "${CODEINFO2_REPO_ROOT}/scripts/codex-sqlite-volume.mjs" check-writers "${descriptor}" <<< '[{"Name":"ready","Mounts":[{"Type":"volume","Name":"project_codex-data","RW":true}],"active":true}]'
  assert_success
}

@test "implicit override discovery is preserved with blank COMPOSE_FILE for every default name" {
  SQLITE_TMP="$(cd "${SQLITE_TMP}" && pwd -P)"
  export CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${SQLITE_TMP}"
  export CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT="$(printf '%s\n' 'CODEINFO_CODEX_SQLITE_VOLUME=1' 'COMPOSE_FILE=')"
  for override in compose.override.yml compose.override.yaml docker-compose.override.yml docker-compose.override.yaml; do
    printf 'services: {}\n' > "${SQLITE_TMP}/${override}"
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    run bash -c 'cd "$1" && exec bash "$2" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
    assert_success
    run grep -F -- 'compose -f ' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
    # An explicit checked-in base intentionally bypasses automatic overrides.
    run_sqlite_wrapper docker-compose.yml
    assert_success
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_success
    rm "${SQLITE_TMP}/${override}"
  done
}

@test "implicit custom base and project-directory selections keep Compose defaults" {
  SQLITE_TMP="$(cd "${SQLITE_TMP}" && pwd -P)"
  export CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${SQLITE_TMP}"
  for base in compose.yaml compose.yml; do
    printf 'services: {}\n' > "${SQLITE_TMP}/${base}"
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    run bash -c 'cd "$1" && exec bash "$2" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
    assert_success
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
    rm "${SQLITE_TMP}/${base}"
  done
  mkdir "${SQLITE_TMP}/custom"
  printf 'services: {}\n' > "${SQLITE_TMP}/custom/compose.yaml"
  for form in separate attached; do
    : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    if [ "${form}" = separate ]; then
      run bash -c 'cd "$1" && exec bash "$2" --project-directory "$1/custom" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
    else
      run bash -c 'cd "$1" && exec bash "$2" --project-directory="$1/custom" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
    fi
    assert_success
    run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
  done
  : > "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  run bash -c 'cd "$1" && exec bash "$2" --project-directory "$1" config' _ "${SQLITE_TMP}" "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh"
  assert_success
  run grep -F -- 'docker-compose.codex-sqlite.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}
