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
