#!/usr/bin/env bats

load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
}

@test "shell harness executes a passing fixture from the vendored runtime" {
  codeinfo2_run_fixture fixture-success

  assert_success
  assert_output --partial "fixture-success"
}

@test "shell harness reports an expected fixture failure without crashing" {
  codeinfo2_run_fixture fixture-fail

  assert_failure 7
  assert_output --partial "fixture-fail"
}
