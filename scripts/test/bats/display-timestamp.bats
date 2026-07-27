#!/usr/bin/env bats

load 'test_helper/common.bash'

setup() {
  codeinfo2_shell_harness_setup
}

@test "display timestamp uses the configured local locale and time zone" {
  run env \
    CODEINFO_DISPLAY_LOCALE=en-GB \
    CODEINFO_DISPLAY_TIME_ZONE=Europe/London \
    node "${CODEINFO2_REPO_ROOT}/scripts/format-display-timestamp.mjs" \
    --instant 2026-01-02T03:04:05Z

  assert_success
  assert_output --partial "2 January 2026"
  assert_output --partial "03:04:05 GMT"
  assert_output --partial "[locale=en-GB; timeZone=Europe/London]"
}

@test "display timestamp converts the same instant for another local zone" {
  run env \
    CODEINFO_DISPLAY_LOCALE=en-US \
    CODEINFO_DISPLAY_TIME_ZONE=America/New_York \
    node "${CODEINFO2_REPO_ROOT}/scripts/format-display-timestamp.mjs" \
    --instant 2026-01-02T03:04:05Z

  assert_success
  assert_output --partial "January 1, 2026"
  assert_output --partial "10:04:05 PM EST"
  assert_output --partial "[locale=en-US; timeZone=America/New_York]"
}

@test "display timestamp rejects an invalid configured time zone" {
  run env \
    CODEINFO_DISPLAY_LOCALE=en-GB \
    CODEINFO_DISPLAY_TIME_ZONE=Not/AZone \
    node "${CODEINFO2_REPO_ROOT}/scripts/format-display-timestamp.mjs" \
    --instant 2026-01-02T03:04:05Z

  assert_failure
  assert_output --partial "Unable to format the display timestamp"
}
