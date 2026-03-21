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
