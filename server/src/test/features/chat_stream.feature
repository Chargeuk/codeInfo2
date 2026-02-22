Feature: chat streaming endpoint

  Scenario: starts a run and streams transcript events over WebSocket
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 202
    And I can subscribe via WebSocket and receive an inflight snapshot and a final event

  Scenario: Provider failure emits a failed final event over WebSocket
    Given chat stream scenario "chat-error"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 202
    And the WebSocket stream includes a failed final event "lmstudio unavailable"

  Scenario: tool events are streamed over WebSocket and logged
    Given chat stream scenario "chat-tools"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 202
    And the streamed events include tool request and result events
    And tool events are logged to the log store

  Scenario: chat history is passed to LM Studio
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with a two-message chat history
    Then the LM Studio chat history length is 4

  Scenario: Alternate provider executes when selected/default provider is unavailable
    Given chat stream scenario "chat-fixture"
    And codex detection is unavailable
    When I POST to the chat endpoint with provider "codex" and model "gpt-5.3-codex"
    Then the chat stream status code is 202
    And the chat start response provider is "lmstudio"

  Scenario: No-model alternate provider returns existing unavailable contract
    Given chat stream scenario "empty"
    And codex detection is unavailable
    When I POST to the chat endpoint with provider "codex" and model "gpt-5.3-codex"
    Then the chat stream status code is 503
    And the chat error code is "PROVIDER_UNAVAILABLE"

  Scenario: No provider switch when selected/default provider is available
    Given chat stream scenario "chat-fixture"
    And codex detection is available
    When I POST to the chat endpoint with provider "codex" and model "gpt-5.3-codex"
    Then the chat stream status code is 202
    And the chat start response provider is "codex"

  Scenario: Chat whitespace-only request contract
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with a whitespace-only message
    Then the chat stream status code is 400
    And the chat error code is "VALIDATION_FAILED"
    And the chat error message is "message must contain at least one non-whitespace character"

  Scenario: Chat newline-only request contract
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with a newline-only message
    Then the chat stream status code is 400
    And the chat error code is "VALIDATION_FAILED"
    And the chat error message is "message must contain at least one non-whitespace character"

  Scenario: Chat valid payload with surrounding whitespace remains accepted
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with raw message "  provider fallback check  "
    Then the chat stream status code is 202
    And the user turn content is "  provider fallback check  "
