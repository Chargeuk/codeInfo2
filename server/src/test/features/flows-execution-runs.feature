@mongo
Feature: Flow execution lifecycle and GitHub review-cycle composition

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

  Scenario: Checked-in GitHub review flow variant keeps clean cycles out of the findings loopback branch
    Given the checked-in GitHub review flow variant exists
    Then the GitHub review flow variant waits before fetching reviews
    And the GitHub review flow variant checks for reviewer feedback before the external review loop

  Scenario: Checked-in GitHub review flow variant closes findings-present PRs only inside repair paths
    Given the checked-in GitHub review flow variant exists
    Then the GitHub review flow variant closes PRs only inside the findings repair paths
