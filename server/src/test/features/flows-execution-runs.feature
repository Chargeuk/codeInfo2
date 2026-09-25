@mongo
Feature: Flow execution lifecycle and GitHub review-cycle composition

  Scenario: Checked-in GitHub review flow keeps the current conditional close topology
    Given the checked-in GitHub review flow variant exists
    Then the GitHub review flow variant waits before fetching reviews
    And the GitHub review flow variant checks for reviewer feedback before the external review loop
    And the GitHub review flow variant closes the PR only when review work restarts the internal flow

  Scenario: Pre-launch persistence failure clears retry ownership before accepted replay reuse
    Given a flow execution test server
    And the flow execution fixture "llm-basic" is available
    And the flow state write fails once
    When I start flow "llm-basic" with conversation id "retry-attempt-1" and retry ownership "retry-1"
    Then the flow execution response status code is 500
    When I start flow "llm-basic" with conversation id "retry-attempt-2" and retry ownership "retry-1"
    Then the flow execution response status code is 202
    When I remember the started conversation as "acceptedRun"
    And I start flow "llm-basic" with conversation id "retry-attempt-3" and retry ownership "retry-1"
    Then the flow execution response status code is 202
    And the latest started conversation matches "acceptedRun"

  Scenario: Persisted wait resumes from an explicit wake boundary
    Given a flow execution test server
    And the wait resume flow execution fixture is available
    When I start flow "wait-resume" with conversation id "wait-resume-1"
    Then the flow execution response status code is 202
    And the active flow conversation stores a persisted wait at step path "1"
    When I trigger the captured wait wake
    Then the active flow conversation clears its persisted wait

  Scenario: GitHub review runtime keeps the clean cycle reachable before untaken findings state leaks in
    Given a flow execution test server
    And the GitHub review clean-cycle runtime fixture is available
    When I start flow "github-review-runtime-clean" using the active flow working folder with conversation id "github-review-clean-1"
    Then the flow execution response status code is 202
    And the active flow conversation eventually contains user text "Clean-cycle branch stayed reachable."
    And the active flow conversation user texts exclude "Untaken findings branch should stay excluded."

  Scenario: GitHub review runtime keeps findings-present reachable before untaken clean-branch validation
    Given a flow execution test server
    And the GitHub review findings-present runtime fixture is available
    When I start flow "github-review-runtime-findings" using the active flow working folder with conversation id "github-review-findings-1"
    Then the flow execution response status code is 202
    And the active flow conversation eventually contains user text "Findings branch stayed reachable."
    And the active flow conversation user texts exclude "Untaken clean branch should stay excluded."

  Scenario: GitHub review runtime resumes with the repaired review handoff before untaken clean-cycle state leaks in
    Given a flow execution test server
    And the GitHub review resumed runtime fixture is available
    When I start flow "github-review-runtime-resume" using the active flow working folder with conversation id "github-review-resume-1"
    Then the flow execution response status code is 202
    When I remember the started conversation as "resumedReview"
    And the active flow conversation stores a persisted wait at step path "0"
    And I resume flow "github-review-runtime-resume" using the active flow working folder for remembered conversation "resumedReview" from step path:
      | 0 |
    Then the flow execution response status code is 202
    Then the active flow conversation clears its persisted wait
    And the active flow conversation eventually contains user text "Resumed review context stayed on findings branch."
    And the active flow conversation user texts exclude "Stale clean-cycle scratch should stay excluded."
