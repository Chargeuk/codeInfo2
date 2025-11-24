Feature: Ingest discovery handles git availability

  Scenario: Git repo uses tracked files only
    Given a git repo with tracked file "tracked.ts" and untracked file "untracked.log"
    When I discover files from that folder
    Then the discovered files include "tracked.ts"
    And the discovered files do not include "untracked.log"

  Scenario: Missing or broken git falls back to walking the directory
    Given a folder with an invalid git repo containing "fallback.ts"
    When I discover files from that folder
    Then the discovered files include "fallback.ts"

  Scenario: Empty git repo surfaces a no-eligible-files error via ingest start
    Given an empty git repo
    When I start ingest for that folder with model "embed-1"
    Then ingest status becomes "error" with last error containing "No eligible files found"
