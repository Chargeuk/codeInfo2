@mongo
Feature: Flow execution retry ownership

  Scenario: Ambiguous fresh-run retry returns the accepted launch and leaves later fresh runs independent
    Given a flow execution test server
    And the flow execution fixture "llm-basic" is available
    When I start flow "llm-basic" with conversation id "retry-attempt-1" and retry ownership "retry-1"
    Then the flow execution response status code is 202
    When I remember the started conversation as "acceptedRun"
    And I start flow "llm-basic" with conversation id "retry-attempt-2" and retry ownership "retry-1"
    Then the flow execution response status code is 202
    And the latest started conversation matches "acceptedRun"
    When I start flow "llm-basic" with conversation id "later-run"
    Then the flow execution response status code is 202
    When I remember the started conversation as "laterRun"
    And remembered conversations "acceptedRun" and "laterRun" are different
