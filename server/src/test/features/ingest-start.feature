Feature: ingest start endpoint
  Start ingest jobs, enforce model lock, support dry-run.

  Background:
    Given chroma stub is empty

  Scenario: happy path starts ingest
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
