@batch-flush
Feature: Ingest batch flushing

  Scenario: flushes after each file when batch size is 1
    Given a batch flush temp repo with 3 files
    When I start a batch flush ingest run
    Then the batch flush run completes with state "completed"
    And the vectors add calls should be at least 3
    And the vectors embedding count should be at least 3
