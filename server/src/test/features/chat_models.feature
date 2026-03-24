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

  Scenario: Copilot stays visible when authentication is required
    Given chat models scenario "copilot-auth-required"
    When I request chat providers
    Then the chat providers response status code is 200
    And the chat provider "copilot" is visible with availability "false" and reason "copilot authentication required"
    And the Copilot Cucumber registration log records scenario "copilot-auth-required"

  Scenario: Copilot returns shared model payload through the fake scenario
    Given chat models scenario "copilot-happy-path"
    When I request chat models for provider "copilot"
    Then the chat models response status code is 200
    And the chat models response provider is "copilot"
    And the chat models list includes model "copilot-gpt-5"
