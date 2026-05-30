@mongo
Feature: Flow execution retry ownership

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
