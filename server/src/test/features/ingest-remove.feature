Feature: Ingest remove

  Scenario: remove root clears lock
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    When I POST ingest manage remove for the temp repo
    When I GET ingest manage roots
    Then ingest manage roots count is 0
    And ingest manage locked model id is null
