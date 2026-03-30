@embedding-dispatch
Feature: Ingest embedding dispatch

  Scenario: dispatcher refills a free slot immediately instead of waiting for a whole wave
    Given ingest embedding dispatch chroma stub is empty
    And ingest embedding dispatch models scenario "controlled-embedding"
    And ingest embedding dispatch temp repo has files:
      | relPath    | content            |
      | first.txt  | alpha beta gamma   |
      | second.txt | delta epsilon zeta |
      | third.txt  | eta theta iota     |
    When I POST ingest embedding dispatch start with model "embed-1"
    Then ingest embedding dispatch waits for 2 controlled embedding calls
    When ingest embedding dispatch releases controlled embedding call 0
    Then ingest embedding dispatch waits for 3 controlled embedding calls
    When ingest embedding dispatch releases all controlled embedding calls
    Then ingest embedding dispatch status for the last run becomes "completed"
    And ingest embedding dispatch logs include "DEV-0000054:embedding_dispatch_slot_filled"
