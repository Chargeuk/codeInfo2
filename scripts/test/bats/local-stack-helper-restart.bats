#!/usr/bin/env bats

load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
  export CODEINFO2_HELPER_TMPDIR
  CODEINFO2_HELPER_TMPDIR="$(codeinfo2_make_temp_dir)"
  export CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO2_HELPER_TMPDIR}/docker.log"
}

teardown() {
  rm -rf "${CODEINFO2_HELPER_TMPDIR}"
}

@test "local stack helper restart dry-run prints the local compose sequence" {
  run bash "${CODEINFO2_REPO_ROOT}/scripts/local-stack-helper-restart.sh" \
    --dry-run \
    --delay-seconds 0 \
    --repo-root "${CODEINFO2_REPO_ROOT}" \
    --log-path "${CODEINFO2_HELPER_TMPDIR}/helper.log"

  assert_success
  assert_output --partial "DRY RUN bash ${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml down"
  assert_output --partial "DRY RUN bash ${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml build"
  assert_output --partial "DRY RUN bash ${CODEINFO2_REPO_ROOT}/scripts/docker-compose-with-env.sh --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml up -d"
}

@test "local stack helper restart uses the checked-in compose wrapper sequence with the docker fixture" {
  run env \
    CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}" \
    CODEINFO_TEST_DOCKER_COMPOSE_CONFIG_JSON="${CODEINFO2_COMPOSE_FIXTURE_DIR}/host-network-local-valid.json" \
    CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO_TEST_DOCKER_FIXTURE_LOG}" \
    CODEINFO_TEST_DISABLE_REAL_PORT_CHECKS=1 \
    CODEINFO_DOCKER_DESKTOP_HOST_NETWORKING_ENABLED=1 \
    CODEINFO_HOST_NETWORK_SUPPORTED_OVERRIDE=1 \
    bash "${CODEINFO2_REPO_ROOT}/scripts/local-stack-helper-restart.sh" \
    --delay-seconds 0 \
    --repo-root "${CODEINFO2_REPO_ROOT}" \
    --log-path "${CODEINFO2_HELPER_TMPDIR}/helper.log"

  assert_success
  run grep -F "compose --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml down" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  run grep -F "compose --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml build" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  run grep -F "compose --env-file server/.env --env-file server/.env.local --env-file client/.env.local -f docker-compose.local.yml up -d" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}
