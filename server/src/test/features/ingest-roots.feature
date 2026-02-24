Feature: Ingest roots listing

  Scenario: returns root entry after an ingest run
    Given ingest roots chroma stub is empty
    And ingest roots models scenario "basic"
    And ingest roots temp repo with file "docs/readme.md" containing "hello"
    When I POST ingest roots start with model "embed-1"
    Then ingest roots status for the last run becomes "completed"
    When I GET ingest roots
    Then ingest roots response status is 200
    And ingest roots response has 1 root
    And ingest roots first item path is the temp repo
    And ingest roots first item status is "completed"

  Scenario: returns empty list when no roots exist
    Given ingest roots chroma stub is empty
    When I GET ingest roots
    Then ingest roots response status is 200
    And ingest roots response has 0 roots

  Scenario: roots include canonical and alias lock parity fields
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "docs/canonical.ts" containing "export const canonical=true;"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots first entry has canonical and alias lock parity
