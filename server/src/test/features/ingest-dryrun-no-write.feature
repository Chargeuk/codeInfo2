Feature: Ingest dry-run skips writing vectors

  Scenario: Dry-run leaves vectors empty
    Given a temp repo for dry-run with file "docs/readme.md" containing "hello dryrun"
    When I start a dry-run ingest for that repo
    Then the dry-run run completes with embedded chunks and no vectors stored
