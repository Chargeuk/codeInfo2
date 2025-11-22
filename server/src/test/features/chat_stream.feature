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
