Feature: Chat models endpoint
  Scenario: LM Studio returns available models
    Given chat models scenario "chat-fixture"
    When I request chat models
    Then the chat models response status code is 200
    And the chat models body matches the normalized mock models fixture
    And the chat models response includes provider-neutral providers metadata
    And the LM Studio Agent Flags expose only the first-wave option keys

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
    And the chat models response includes provider-neutral providers metadata

  Scenario: External endpoint discovery returns endpoint-backed Codex models
    Given chat models scenario "external-endpoint-discovery"
    When I request chat providers
    Then the chat providers response status code is 200
    And the chat providers response selected provider is "codex"
    And the chat providers response selected endpoint is "discovered endpoint"
    When I request chat models for provider "codex"
    Then the chat models response status code is 200
    And the chat models response provider is "codex"
    And the chat models list includes model "gpt-5.1-codex-max"
    And the chat models response includes model "gpt-5.1-codex-max" on endpoint "discovered endpoint"
    And the chat models response includes provider-neutral providers metadata

  Scenario: Config-pinned external endpoint stays visible in picker bootstrap
    Given chat models scenario "external-endpoint-picker-bootstrap"
    When I request chat providers
    Then the chat providers response status code is 200
    And the chat providers response selected provider is "codex"
    And the chat providers response selected endpoint is "pinned endpoint"
    When I request chat models for provider "codex"
    Then the chat models response status code is 200
    And the chat models response provider is "codex"
    And the chat models list includes model "gpt-5.2"
    And the chat models response includes model "gpt-5.2" on endpoint "pinned endpoint"
    And the chat models response includes provider-neutral providers metadata
