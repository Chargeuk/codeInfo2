Feature: chat streaming endpoint

  Scenario: streams token, final, and complete events
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 200
    And the streamed events include token, final, and complete in order

  Scenario: LM Studio failure emits error frame
    Given chat stream scenario "chat-error"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 200
    And the streamed events include an error event "lmstudio unavailable"

  Scenario: tool events are streamed and logged
    Given chat stream scenario "chat-tools"
    When I POST to the chat endpoint with the chat request fixture
    Then the chat stream status code is 200
    And the streamed events include token, final, and complete in order
    And the streamed events include tool request and result events
    And tool events are logged to the log store

  Scenario: chat history is passed to LM Studio
    Given chat stream scenario "chat-fixture"
    When I POST to the chat endpoint with a two-message chat history
    Then the LM Studio chat history length is 4
