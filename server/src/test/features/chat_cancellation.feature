Feature: Chat cancellation
  As an operator
  I want chat runs to continue unless explicitly cancelled
  So that leaving the Chat page does not abort generation

  Scenario: Unsubscribe does not cancel, but cancel_inflight stops generation
    Given chat cancellation scenario "chat-stream"
    When I start a chat run and unsubscribe from the conversation stream
    Then the chat prediction is not cancelled server side
    When I send cancel_inflight for the active run
    Then the WebSocket stream final status is "stopped"
