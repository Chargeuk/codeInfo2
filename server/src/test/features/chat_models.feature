Feature: Chat models endpoint
  Scenario: LM Studio returns available models
    Given chat models scenario "chat-fixture"
    When I request chat models
    Then the chat models response status code is 200
    And the chat models body equals the mock models fixture

  Scenario: LM Studio is unavailable
    Given chat models scenario "chat-error"
    When I request chat models
    Then the chat models response status code is 503
    And the chat models field "error" equals "lmstudio unavailable"
