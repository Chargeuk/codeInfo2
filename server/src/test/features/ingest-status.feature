Feature: ingest status progress fields
  Ingest status should expose the current file path, position, percent, and ETA during a run.

  Background:
    Given ingest status models scenario "many"

  Scenario: status includes per-file progress and AST counts while embedding
    And temp repo for ingest status with 3 files
    When I POST ingest start for status with model "embed-1"
    Then ingest status eventually includes progress fields and AST counts for 3 files
