Feature: ingest lifecycle logging
  Verify ingest operations append lifecycle entries to the server log store.

  Background:
    Given an ingest logging test server

  Scenario: start and completed logs appear for initial ingest
    Given logging temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest logging start with model "embed-1"
    Then logs for the last run contain state "start" and level "info"
    And ingest logging status for the last run becomes "completed"
    And logs for the last run contain state "completed" and level "info"

  Scenario: no eligible files emits an error log
    Given an empty logging temp repo
    When I POST ingest logging start with model "embed-1"
    Then ingest logging status for the last run becomes "error"
    And logs for the last run contain state "error" and level "error"

  Scenario: re-embed with no files logs skipped
    Given logging temp repo with file "b.ts" containing "export const b=2;"
    When I POST ingest logging start with model "embed-1"
    And ingest logging status for the last run becomes "completed"
    And I delete the file "b.ts" from the logging temp repo
    And I POST ingest logging reembed for the last root
    Then ingest logging status for the last run becomes "skipped"
    And logs for the last run contain state "skipped" and level "info"

  Scenario: remove emits completed log
    Given logging temp repo with file "c.ts" containing "export const c=3;"
    When I POST ingest logging start with model "embed-1"
    And ingest logging status for the last run becomes "completed"
    And I POST ingest logging remove for the last root
    Then logs for the last action contain "remove" entries at level "info"
