Feature: ingest start endpoint
  Start ingest jobs, enforce model lock, support dry-run.

  Background:
    Given chroma stub is empty

  Scenario: happy path starts ingest from a canonical repository root
    Given ingest start models scenario "many"
    And temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start with model "embed-1"
    Then the ingest start status code is 202
    And ingest status for the last run becomes "completed"

  Scenario: model lock rejects the empty-collection queued admission before enqueueing
    Given chroma stub locked to "embed-locked"
    When I POST ingest start with model "embed-1"
    Then the ingest start status code is 409
    And the ingest start error code is "MODEL_LOCKED"

  Scenario: dry run completes without embeddings
    Given ingest start models scenario "many"
    And temp repo with file "b.ts" containing "export const b=2;"
    When I POST ingest start with model "embed-1" and dryRun
    Then the ingest start status code is 202
    And ingest status for the last run becomes "completed"
    And ingest status embedded count is 1

  Scenario: malformed configured workdir fails closed before queue admission
    Given ingest start models scenario "many"
    And temp repo with file "c.ts" containing "export const c=3;"
    And configured queueable workdir is "/allowed/workdir/"
    When I POST ingest start with model "embed-1"
    Then the ingest start status code is 400
    And the ingest start error code is "CONFIGURATION"
    And the ingest start error message is "CODEINFO_CODEX_WORKDIR must be an absolute normalized repository root path or the exact placeholder \"$CODEINFO_CODEX_WORKDIR\""

  Scenario: the exact configured-workdir placeholder remains intentionally accepted
    Given ingest start models scenario "many"
    And temp repo with file "d.ts" containing "export const d=4;"
    And configured queueable workdir is "$CODEINFO_CODEX_WORKDIR"
    When I POST ingest start with model "embed-1"
    Then the ingest start status code is 202
    And ingest status for the last run becomes "completed"
