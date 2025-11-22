Feature: LM Studio status
  Scenario: LM Studio returns models
    Given LM Studio scenario "many"
    When I GET "/lmstudio/status"
    Then the response status code is 200
    And the JSON field "status" equals "ok"
    And the JSON array "models" has length 2

  Scenario: LM Studio returns no models
    Given LM Studio scenario "empty"
    When I GET "/lmstudio/status"
    Then the response status code is 200
    And the JSON field "status" equals "ok"
    And the JSON array "models" has length 0

  Scenario: LM Studio is unreachable
    Given LM Studio scenario "timeout"
    When I GET "/lmstudio/status"
    Then the response status code is 502
    And the JSON field "status" equals "error"
