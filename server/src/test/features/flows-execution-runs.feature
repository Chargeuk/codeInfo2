@mongo
Feature: Flow execution-scoped parent state

  Scenario: Fresh starts create new parent conversations while resume keeps the same execution
    Given a flow execution test server
    And the flow execution fixture "resume-basic" is available
    When I start flow "resume-basic" with conversation id "story53-parent"
    Then the flow execution response status code is 202
    And I remember the started conversation as "firstRun"
    And the stored flow execution id for "firstRun" is recorded as "firstExecution"
    And the child conversation execution id for "firstRun" matches "firstExecution"
    When I start flow "resume-basic" with remembered conversation "firstRun"
    Then the flow execution response status code is 202
    And I remember the started conversation as "secondRun"
    And remembered conversations "firstRun" and "secondRun" are different
    And the stored flow execution id for "secondRun" differs from "firstExecution"
    When I resume flow "resume-basic" for remembered conversation "firstRun" from step path:
      | 0 |
    Then the flow execution response status code is 202
    And the latest started conversation matches "firstRun"
    And the stored flow execution id for "firstRun" still matches "firstExecution"
    And the child conversation execution id for "firstRun" matches "firstExecution"
