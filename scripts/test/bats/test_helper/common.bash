codeinfo2_shell_harness_setup() {
  export CODEINFO2_BATS_ROOT="${BATS_TEST_DIRNAME}"
  export CODEINFO2_REPO_ROOT
  CODEINFO2_REPO_ROOT="$(cd "${CODEINFO2_BATS_ROOT}/../../.." && pwd)"
  export CODEINFO2_FIXTURE_ROOT="${CODEINFO2_BATS_ROOT}/fixtures"
  export CODEINFO2_FIXTURE_BIN_DIR="${CODEINFO2_BATS_ROOT}/fixtures/bin"
  export CODEINFO2_COMPOSE_FIXTURE_DIR="${CODEINFO2_BATS_ROOT}/fixtures/compose"
  export CODEINFO2_DOCKER_FIXTURE_BIN="${CODEINFO2_FIXTURE_BIN_DIR}/docker-fixture"
  export PATH="${CODEINFO2_FIXTURE_BIN_DIR}:${PATH}"
  export BATS_LIB_PATH="${CODEINFO2_BATS_ROOT}/vendor${BATS_LIB_PATH:+:${BATS_LIB_PATH}}"

  bats_load_library bats-support
  bats_load_library bats-assert
}

codeinfo2_run_fixture() {
  run "$@"
}

codeinfo2_make_temp_dir() {
  mktemp -d "${BATS_RUN_TMPDIR}/codeinfo2.XXXXXX"
}
