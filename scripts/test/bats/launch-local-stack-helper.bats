#!/usr/bin/env bats

load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
  export CODEINFO2_HELPER_TMPDIR
  CODEINFO2_HELPER_TMPDIR="$(codeinfo2_make_temp_dir)"
  export CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO2_HELPER_TMPDIR}/docker.log"
  : > "${CODEINFO2_HELPER_TMPDIR}/docker.sock"
}

teardown() {
  rm -rf "${CODEINFO2_HELPER_TMPDIR}"
}

@test "local stack helper launcher dry-run prints build and detached run commands" {
  run env \
    CODEINFO_LOCAL_HELPER_SOCKET_PATH="${CODEINFO2_HELPER_TMPDIR}/docker.sock" \
    bash "${CODEINFO2_REPO_ROOT}/scripts/launch-local-stack-helper.sh" \
    --dry-run \
    --helper-dry-run \
    --delay-seconds 0 \
    --repo-root "${CODEINFO2_REPO_ROOT}" \
    --log-relative-path "logs/helper-dry-run.log"

  assert_success
  assert_output --partial "DRY RUN docker build -f ${CODEINFO2_REPO_ROOT}/Dockerfile.local-restarter -t codeinfo2-local-restarter:latest ${CODEINFO2_REPO_ROOT}"
  assert_output --partial "DRY RUN docker rm -f codeinfo2-local-restarter"
  assert_output --partial "DRY RUN docker run -d --name codeinfo2-local-restarter --group-add"
  assert_output --partial "bash /workspace/scripts/local-stack-helper-restart.sh --repo-root /workspace --delay-seconds 0 --log-path /workspace/logs/helper-dry-run.log --dry-run"
}

@test "local stack helper launcher can issue build and detached run calls through the docker fixture" {
  run env \
    CODEINFO_DOCKER_BIN="${CODEINFO2_DOCKER_FIXTURE_BIN}" \
    CODEINFO_LOCAL_HELPER_SOCKET_PATH="${CODEINFO2_HELPER_TMPDIR}/docker.sock" \
    CODEINFO_TEST_DOCKER_FIXTURE_LOG="${CODEINFO_TEST_DOCKER_FIXTURE_LOG}" \
    bash "${CODEINFO2_REPO_ROOT}/scripts/launch-local-stack-helper.sh" \
    --helper-dry-run \
    --delay-seconds 0 \
    --repo-root "${CODEINFO2_REPO_ROOT}" \
    --log-relative-path "logs/helper-launch.log"

  assert_success
  run grep -F "build -f ${CODEINFO2_REPO_ROOT}/Dockerfile.local-restarter -t codeinfo2-local-restarter:latest ${CODEINFO2_REPO_ROOT}" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  run grep -F "rm -f codeinfo2-local-restarter" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
  run grep -F "run -d --name codeinfo2-local-restarter --group-add" "${CODEINFO_TEST_DOCKER_FIXTURE_LOG}"
  assert_success
}
