Feature: Ingest cancel

  Scenario: cancel an in-flight ingest
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest manage start with model "embed-1"
    When I POST ingest manage cancel for the last run
    Then ingest manage status for the last run becomes "cancelled"
    When I GET ingest manage roots
    Then ingest manage roots first status is "cancelled"

  Scenario: cancel ignores late provider results that finish after cancellation
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "controlled-embedding"
    And ingest manage temp repo with file "a.txt" containing "alpha beta gamma"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage waits for 1 controlled embedding calls
    When I POST ingest manage cancel for the last run
    And ingest manage releases controlled embedding call 0
    Then ingest manage status for the last run becomes "cancelled"
    And ingest manage logs include "DEV-0000054:embedding_result_ignored_after_cancel"
