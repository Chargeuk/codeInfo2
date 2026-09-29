#!/usr/bin/env bats

load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
  export CODEINFO2_TASK9_TMPDIR
  CODEINFO2_TASK9_TMPDIR="$(codeinfo2_make_temp_dir)"
  export CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO2_TASK9_TMPDIR}/docker.log"
}

teardown() {
  rm -rf "${CODEINFO2_TASK9_TMPDIR}"
}

codeinfo2_run_compose_wrapper() {
  local compose_file="$1"
  local compose_fixture="$2"
  shift 2

  run env \
    CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}" \
    CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${CODEINFO2_COMPOSE_FIXTURE_DIR}/${compose_fixture}" \
    CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO_TEST_DOCKER_FIXTURE_LOG}" \
    CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS=1 \
    CODEINFO_DOCKER_DESKTOP_HOST_NETWORKING_ENABLED=1 \
    "$@" \
    bash "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh" \
    --env-file server/.env \
    --env-file server/.env.local \
    -f "${compose_file}" \
    up -d
}

codeinfo2_make_darwin_share_fixture() {
  local fixture_bin="$1"
  mkdir -p "${fixture_bin}"
  cat > "${fixture_bin}/uname" <<'EOF'
#!/bin/sh
printf 'Darwin\n'
EOF
  cat > "${fixture_bin}/mount" <<'EOF'
#!/bin/sh
sleep "${CODEINFO_TEST_MOUNT_DELAY:-0}"
printf '%s\n' "${CODEINFO_TEST_MOUNT_OUTPUT}"
EOF
  printf '%s\n' 'Object.defineProperty(process, "platform", { value: "darwin" });' > "${fixture_bin}/darwin.cjs"
  chmod +x "${fixture_bin}/uname" "${fixture_bin}/mount"
}

codeinfo2_run_system_bash_optional_share() {
  local fixture_bin="$1" share_path="$2"
  shift 2

  run env \
    CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}" \
    CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${CODEINFO2_COMPOSE_FIXTURE_DIR}/host-network-local-valid.json" \
    CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO_TEST_DOCKER_FIXTURE_LOG}" \
    "CODEINFO_TEST_DOCKER_EXPECT_FINAL_ARG=${CODEINFO_TEST_DOCKER_EXPECT_FINAL_ARG:-}" \
    CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS=1 \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    "PATH=${fixture_bin}:${PATH}" \
    "NODE_OPTIONS=--require=${fixture_bin}/darwin.cjs" \
    "CODEINFO_TEST_MOUNT_OUTPUT=//server/share on ${share_path} (smbfs, nodev)" \
    "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}" \
    /bin/bash "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh" \
    --env-file server/.env \
    --env-file server/.env.local \
    -f docker-compose.local.yml \
    "$@"
}

codeinfo2_make_linux_share_fixture() {
  local fixture_bin="$1"
  mkdir -p "${fixture_bin}"
  cat > "${fixture_bin}/uname" <<'EOF'
#!/bin/sh
printf 'Linux\n'
EOF
  # The Linux wrapper invokes GNU timeout, which is absent on macOS test hosts.
  cat > "${fixture_bin}/timeout" <<'EOF'
#!/bin/sh
shift
exec "$@"
EOF
  printf '%s\n' 'Object.defineProperty(process, "platform", { value: "linux" });' > "${fixture_bin}/linux.cjs"
  chmod +x "${fixture_bin}/uname" "${fixture_bin}/timeout"
}

@test "compose wrapper fails before startup when host networking is unsupported" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=0

  assert_failure
  assert_output --partial "host networking is not supported"
  assert_output --partial "docker-compose.local.yml"
  run grep -F "compose --env-file server/.env --env-file server/.env.local -f docker-compose.local.yml up -d" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "compose wrapper rejects Docker Desktop versions earlier than 4.34 when host networking is required" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_TEST_DOCKER_INFO_JSON='{"OperatingSystem":"Docker Desktop","ServerVersion":"29.1.3"}' \
    CODEINFO_TEST_DOCKER_SERVER_PLATFORM_NAME='Docker Desktop 4.33.2 (100000)'

  assert_failure
  assert_output --partial "Docker Desktop 4.33.2 does not provide the host-network support"
}

@test "compose wrapper blocks startup when a checked-in host port is already occupied" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_TEST_OCCUPIED_PORTS=5510

  assert_failure
  assert_output --partial "required host port 5510 is already in use"
  assert_output --partial "docker-compose.local.yml"
}

@test "compose wrapper rejects host-network services that still declare incompatible ports or networks" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-invalid-shape.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_failure
  assert_output --partial "service server"
  assert_output --partial "cannot declare 'ports'"
}

@test "compose wrapper passes through to docker compose when host-network preflight succeeds" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_success
  assert_output --partial "fake compose execution"
  assert_output --partial "\"result\":\"passed\""
  run grep -F "compose --env-file server/.env --env-file server/.env.local -f docker-compose.local.yml up -d" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}

@test "optional local share stays disabled when the resolved setting is absent" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_success
  refute_output --partial "optional network share unavailable"
  run grep -F 'docker-compose.optional-share.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "optional local share stays disabled when the resolved setting is blank" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    'CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=   '

  assert_success
  refute_output --partial "optional network share unavailable"
  run grep -F 'docker-compose.optional-share.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "optional local share does not hide Compose environment errors" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_EXIT_CODE=1

  assert_failure
  assert_output --partial "unable to resolve Compose interpolation environment"
  run grep -F ' up -d' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "optional local share warns and keeps base config for an empty unmounted directory" {
  local share_path
  share_path="${CODEINFO2_TASK9_TMPDIR}/empty share"
  mkdir -p "${share_path}"

  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}"

  assert_success
  assert_output --partial "optional network share unavailable"
  run grep -F 'docker-compose.optional-share.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "optional local share accepts read-only and writable WSL 9p mounts with spaces" {
  local share_path fixture_bin
  share_path="${CODEINFO2_TASK9_TMPDIR}/network share"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/bin"
  mkdir -p "${share_path}" "${fixture_bin}"
  cat > "${fixture_bin}/findmnt" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"filesystems":[{"source":"\\x5c\\x5cfileserver\\x5cShared","fstype":"9p","options":"'"${CODEINFO_TEST_SHARE_MODE}"',relatime,aname=drvfs;path=UNC\\x5cfileserver\\x5cShared;uid=1000"}]}'
EOF
  chmod +x "${fixture_bin}/findmnt"
  codeinfo2_make_linux_share_fixture "${fixture_bin}"

  local mode
  for mode in ro rw; do
    codeinfo2_run_compose_wrapper \
      docker-compose.local.yml \
      host-network-local-valid.json \
      CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
      "PATH=${fixture_bin}:${PATH}" \
      "NODE_OPTIONS=--require=${fixture_bin}/linux.cjs" \
      "CODEINFO_TEST_SHARE_MODE=${mode}" \
      "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}"

    assert_success
    refute_output --partial "optional network share unavailable"
    assert_output --partial 'docker-compose.optional-share.yml'
    run grep -F 'docker-compose.optional-share.yml up -d' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_success
  done
}

@test "optional local share rejects 9p mounts with incorrect UNC or drvfs metadata" {
  local share_path fixture_bin
  share_path="${CODEINFO2_TASK9_TMPDIR}/other 9p"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/bin"
  mkdir -p "${share_path}" "${fixture_bin}"
  cat > "${fixture_bin}/findmnt" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${CODEINFO_TEST_FINDMNT_JSON}"
EOF
  chmod +x "${fixture_bin}/findmnt"
  codeinfo2_make_linux_share_fixture "${fixture_bin}"

  local fixture
  for fixture in \
    '{"filesystems":[{"source":"localshare","fstype":"9p","options":"rw,relatime,aname=drvfs;path=UNC\\x5cfileserver\\x5cShared"}]}' \
    '{"filesystems":[{"source":"\\x5c\\x5cfileserver\\x5cShared","fstype":"9p","options":"rw,relatime,aname=drvfs;path=UNC\\x5cother\\x5cShared"}]}'; do
    codeinfo2_run_compose_wrapper \
      docker-compose.local.yml \
      host-network-local-valid.json \
      CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
      "PATH=${fixture_bin}:${PATH}" \
      "NODE_OPTIONS=--require=${fixture_bin}/linux.cjs" \
      "CODEINFO_TEST_FINDMNT_JSON=${fixture}" \
      "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}"

    assert_success
    assert_output --partial "optional network share unavailable"
    run grep -F 'docker-compose.optional-share.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_failure
  done
}

@test "optional local share accepts an exact macOS SMB or NFS mountpoint" {
  local share_path fixture_bin mount_type
  share_path="${CODEINFO2_TASK9_TMPDIR}/network share"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/darwin-bin"
  mkdir -p "${share_path}"
  codeinfo2_make_darwin_share_fixture "${fixture_bin}"

  for mount_type in smbfs nfs; do
    codeinfo2_run_compose_wrapper \
      docker-compose.local.yml \
      host-network-local-valid.json \
      CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
      "PATH=${fixture_bin}:${PATH}" \
      "NODE_OPTIONS=--require=${fixture_bin}/darwin.cjs" \
      "CODEINFO_TEST_MOUNT_OUTPUT=//server/share on ${share_path} (${mount_type}, nodev)" \
      "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}"

    assert_success
    refute_output --partial "optional network share unavailable"
    run grep -F 'docker-compose.optional-share.yml up -d' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_success
  done
}

@test "optional local share times out a stalled macOS mount check and keeps base config" {
  local share_path fixture_bin
  share_path="${CODEINFO2_TASK9_TMPDIR}/network share"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/darwin-bin"
  mkdir -p "${share_path}"
  codeinfo2_make_darwin_share_fixture "${fixture_bin}"

  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    "PATH=${fixture_bin}:${PATH}" \
    "NODE_OPTIONS=--require=${fixture_bin}/darwin.cjs" \
    CODEINFO_TEST_MOUNT_DELAY=12 \
    "CODEINFO_TEST_MOUNT_OUTPUT=//server/share on ${share_path} (smbfs, nodev)" \
    "CODEINFO_TEST_DOCKER_COMPOSE_ENVIRONMENT_OUTPUT=CODEINFO_OPTIONAL_SHARE_PATH=${share_path}"

  assert_success
  assert_output --partial "optional network share unavailable"
  run grep -F 'docker-compose.optional-share.yml' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_failure
}

@test "optional share forwards no-tail down and build under macOS system Bash" {
  local share_path fixture_bin command
  share_path="${CODEINFO2_TASK9_TMPDIR}/network share"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/darwin-bin"
  mkdir -p "${share_path}"
  codeinfo2_make_darwin_share_fixture "${fixture_bin}"

  for command in down build; do
    codeinfo2_run_system_bash_optional_share "${fixture_bin}" "${share_path}" "${command}"
    assert_success
    run grep -F "docker-compose.optional-share.yml ${command}" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
    assert_success
  done
}

@test "optional share preserves a spaced build argument under macOS system Bash" {
  local share_path fixture_bin
  share_path="${CODEINFO2_TASK9_TMPDIR}/network share"
  fixture_bin="${CODEINFO2_TASK9_TMPDIR}/darwin-bin"
  mkdir -p "${share_path}"
  codeinfo2_make_darwin_share_fixture "${fixture_bin}"

  CODEINFO_TEST_DOCKER_EXPECT_FINAL_ARG='SHARE_LABEL=network files' \
    codeinfo2_run_system_bash_optional_share "${fixture_bin}" "${share_path}" \
      build --build-arg 'SHARE_LABEL=network files'
  assert_success
  run grep -F 'docker-compose.optional-share.yml build --build-arg SHARE_LABEL=network files' "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}

@test "compose wrapper preserves explicit display locale and time-zone overrides" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_TEST_RECORD_DISPLAY_ENV=1 \
    CODEINFO_DISPLAY_LOCALE=fr-FR \
    CODEINFO_DISPLAY_TIME_ZONE=Europe/Paris

  assert_success
  run grep -F "display_env locale=fr-FR time_zone=Europe/Paris" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}

@test "compose wrapper infers non-empty display settings when overrides are absent" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_TEST_RECORD_DISPLAY_ENV=1 \
    CODEINFO_DISPLAY_LOCALE= \
    CODEINFO_DISPLAY_TIME_ZONE=

  assert_success
  run grep -E "display_env locale=.+ time_zone=.+" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}

@test "compose wrapper creates missing repo-owned local bind-mount directories before startup" {
  local workspace_root
  workspace_root="${CODEINFO2_TASK9_TMPDIR}/workspace"
  mkdir -p "${workspace_root}"

  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${workspace_root}"

  assert_success
  [ -d "${workspace_root}/logs" ]
  [ -d "${workspace_root}/codex" ]
  [ -d "${workspace_root}/codex/chat" ]
  [ -d "${workspace_root}/codex_agents" ]
  [ -d "${workspace_root}/flows" ]
  [ -d "${workspace_root}/flows-sandbox" ]
  [ -d "${workspace_root}/playwright-output-local" ]
}

@test "compose wrapper creates empty local env overlay files when missing" {
  local workspace_root
  workspace_root="${CODEINFO2_TASK9_TMPDIR}/workspace-env"
  mkdir -p "${workspace_root}/server" "${workspace_root}/client"

  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_COMPOSE_REPO_ROOT_OVERRIDE="${workspace_root}"

  assert_success
  [ -f "${workspace_root}/server/.env.local" ]
  [ -f "${workspace_root}/client/.env.local" ]
  [ ! -s "${workspace_root}/server/.env.local" ]
  [ ! -s "${workspace_root}/client/.env.local" ]
}

@test "compose wrapper does not require playwright-mcp for compose files that are out of scope" {
  codeinfo2_run_compose_wrapper \
    docker-compose.e2e.yml \
    host-network-e2e-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_success
  assert_output --partial "\"playwrightServicePresent\":false"
  assert_output --partial "\"checkedPorts\":[6010,6011,6012]"
}

@test "compose wrapper failure output names the affected compose file or service" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-invalid-shape.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_failure
  assert_output --partial "docker-compose.local.yml"
  assert_output --partial "service server"
}

@test "compose wrapper keeps the local host-network Chrome DevTools contract on 9222" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1

  assert_success
  assert_output --partial "\"checkedPorts\":[5510,5511,5512,9222,8931]"
}

@test "compose wrapper skips host-port occupancy failures for restart on an already-running host-network stack" {
  run env \
    CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}" \
    CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${CODEINFO2_COMPOSE_FIXTURE_DIR}/host-network-local-valid.json" \
    CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO_TEST_DOCKER_FIXTURE_LOG}" \
    CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS=1 \
    CODEINFO_DOCKER_DESKTOP_HOST_NETWORKING_ENABLED=1 \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_TEST_OCCUPIED_PORTS=5510 \
    bash "${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh" \
    --env-file server/.env \
    --env-file server/.env.local \
    -f docker-compose.local.yml \
    restart

  assert_success
  assert_output --partial "fake compose execution"
}

@test "compose wrapper can probe docker-host ports when the launcher itself runs inside a container" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_HOST_PORT_CHECK_SCOPE=docker_host \
    CODEINFO_TEST_RUNNING_IN_CONTAINER=1

  assert_success
  run grep -F "run --rm --network host --entrypoint node codeinfo2-server-local" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}

@test "compose wrapper fails closed when the docker-host probe image is unavailable" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-missing-probe-image.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_HOST_PORT_CHECK_SCOPE=docker_host \
    CODEINFO_TEST_RUNNING_IN_CONTAINER=1

  assert_failure
  assert_output --partial "docker-compose.local.yml"
  assert_output --partial "unable to verify required host port 5510"
  assert_output --partial "probe image is unavailable"
}

@test "compose wrapper fails closed when the docker-host probe process cannot launch" {
  codeinfo2_run_compose_wrapper \
    docker-compose.local.yml \
    host-network-local-valid.json \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    CODEINFO_HOST_PORT_CHECK_SCOPE=docker_host \
    CODEINFO_TEST_RUNNING_IN_CONTAINER=1 \
    CODEINFO_TEST_DOCKER_RUN_EXIT_CODE=125 \
    CODEINFO_TEST_DOCKER_RUN_STDERR="probe image pull failed"

  assert_failure
  assert_output --partial "docker-compose.local.yml"
  assert_output --partial "unable to verify required host port 5510"
  assert_output --partial "probe image pull failed"
  run grep -F "run --rm --network host --entrypoint node codeinfo2-server-local" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}
