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
