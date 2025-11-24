Feature: Empty vectors collection is deleted and recreated cleanly

  Scenario: Removing the only root deletes the collection and clears the lock
    Given a temp repo for cleanup with file "src/main.ts" containing "console.log('hi')"
    When I start a real ingest for that repo
    And the ingest run finishes successfully
    And I remove the repo ingest entry
    Then the vectors collection is deleted and the lock is cleared

  Scenario: Re-ingesting after deletion recreates vectors without stale lock
    Given a temp repo for cleanup with file "src/main.ts" containing "console.log('hi again')"
    When I start a real ingest for that repo
    And the ingest run finishes successfully
    And I remove the repo ingest entry
    And I start a real ingest for that repo
    Then the ingest rerun completes and vectors are stored
