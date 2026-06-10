Feature: chat streaming endpoint

  Scenario: starts a run and streams transcript events over WebSocket
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 202
    When I wait for the WebSocket inflight snapshot and final event
    Then the WebSocket stream includes an inflight snapshot and a final event

  Scenario: Provider unavailable returns existing 503 error envelope
    Given chat stream scenario "chat-error"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 503
    And the chat error code is "PROVIDER_UNAVAILABLE"
    And the chat error message is "lmstudio unavailable"

  Scenario: tool events are streamed over WebSocket and logged
    Given chat stream scenario "chat-tools"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 202
    When I wait for streamed tool request and result events
    Then the streamed events include tool request and result events
    And tool events are logged to the log store

  Scenario: chat history is passed to LM Studio
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with a two-message chat history
    Then the LM Studio chat history length is 4

  Scenario: Omitted-provider provider-model fallback keeps same-provider model repair on the normal route path
    Given chat stream scenario "chat-fixture"
    And chat default provider is "lmstudio"
    And chat default model is "missing-lmstudio-model"
    When I POST to the chat endpoint with the chat request fixture omitting provider and model
    Then the chat stream status code is 202
    And the chat start response provider is "lmstudio"
    And the chat start response model is "llama-3"

  Scenario: External endpoint unavailable falls back to the same provider native path before cross-provider fallback
    Given chat stream scenario "external-endpoint-native-fallback"
    And chat default provider is "codex"
    And chat default model is "gpt-5.3-codex"
    And codex detection is available
    When I POST to the chat endpoint with the chat request fixture omitting provider and model
    Then the chat stream status code is 202
    And the chat start response provider is "codex"
    And the chat start response model is "gpt-5.3-codex"

  Scenario: External endpoint unavailable plus native fallback failure returns the existing unavailable contract
    Given chat stream scenario "external-endpoint-native-failure"
    And later fallback providers are unavailable
    And chat default provider is "codex"
    And chat default model is "gpt-5.3-codex"
    And codex detection is unavailable
    When I POST to the chat endpoint with the chat request fixture omitting provider and model
    Then the chat stream status code is 503
    And the chat error code is "PROVIDER_UNAVAILABLE"

  Scenario: External endpoint repairs to the first selectable model on the same endpoint
    Given chat stream scenario "external-endpoint-repair"
    And chat default provider is "codex"
    And chat default model is "missing-codex-model"
    And codex detection is available
    When I POST to the chat endpoint with the chat request fixture omitting provider and model
    Then the chat stream status code is 202
    And the chat start response provider is "codex"
    And the chat start response model is "alpha"

  Scenario: Explicit provider-model selection fails instead of silently switching providers
    Given chat stream scenario "chat-fixture"
    And codex detection is unavailable
    When I POST to the chat endpoint with provider "codex" and model "gpt-5.3-codex"
    Then the chat stream status code is 503
    And the chat error code is "PROVIDER_UNAVAILABLE"

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

  Scenario: Copilot happy-path scenario streams a successful turn
    Given chat stream scenario "copilot-happy-path"
    When I POST to the chat endpoint with provider "copilot" and model "copilot-gpt-5"
    Then the chat stream status code is 202
    And the chat start response provider is "copilot"
    When I wait for the WebSocket inflight snapshot and final event
    Then the WebSocket stream includes an inflight snapshot and a final event
    And the Copilot Cucumber registration log records scenario "copilot-happy-path"

  Scenario: Copilot streamed failure scenario surfaces the documented error path
    Given chat stream scenario "copilot-stream-error"
    When I POST to the chat endpoint with provider "copilot" and model "copilot-gpt-5"
    Then the chat stream status code is 202
    When I wait for the WebSocket failed final event "copilot fake scenario failed"
    Then the WebSocket stream includes a failed final event "copilot fake scenario failed"
