Feature: ingest status progress fields
Ingest status should expose the current file path, position, percent, and ETA during a run.

Background:
Given ingest status models scenario "many"

Scenario: status includes per-file progress and AST counts while embedding
And temp repo for ingest status with 3 files
When I POST ingest start for status with model "embed-1"
Then ingest status eventually includes progress fields and AST counts for 3 files

@mongo
Scenario: cleanup-blocked queue records keep startup and pump ordering from advancing the next waiting item
Given ingest manage mongo queue is empty
And ingest manage mongo queue has cleanup-blocked request for "/tmp/blocked-root" with run id "run-blocked"
And ingest manage mongo queue has waiting request for "/tmp/waiting-root"
And ingest manage queue runtime records started paths
When ingest manage queue pump runs
Then ingest manage queue pump reports cleanup blocked
And ingest manage queue runtime started paths are empty
