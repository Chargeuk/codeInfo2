codeinfo2_shell_harness_setup() {
  export CODEINFO2_BATS_ROOT="${BATS_TEST_DIRNAME}"
  export CODEINFO2_REPO_ROOT
  CODEINFO2_REPO_ROOT="$(cd "${CODEINFO2_BATS_ROOT}/../../../.." && pwd)"
  export CODEINFO2_FIXTURE_BIN_DIR="${CODEINFO2_BATS_ROOT}/fixtures/bin"
  export PATH="${CODEINFO2_FIXTURE_BIN_DIR}:${PATH}"
  export BATS_LIB_PATH="${CODEINFO2_BATS_ROOT}/vendor${BATS_LIB_PATH:+:${BATS_LIB_PATH}}"

  bats_load_library bats-support
  bats_load_library bats-assert
}

codeinfo2_run_fixture() {
  run "$@"
}
