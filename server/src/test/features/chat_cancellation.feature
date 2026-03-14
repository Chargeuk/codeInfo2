Feature: Chat cancellation
  As an operator
  I want chat runs to continue unless explicitly cancelled
  So that leaving the Chat page does not abort generation

  Scenario: unsubscribe_conversation does not cancel an active run
    Given chat cancellation scenario "chat-stream"
    When I start a chat run and unsubscribe from the conversation stream
    Then the chat prediction is not cancelled server side

  Scenario: cancel_inflight with inflightId stops an active run
    Given chat cancellation scenario "chat-stream"
    When I start a chat run and stay subscribed to the conversation stream
    When I send cancel_inflight for the active run
    Then the WebSocket stream final status is "stopped"

  Scenario: duplicate or late cancel_inflight after completion stays noop and leaves the socket open
    Given chat cancellation scenario "chat-fixture"
    When I start a chat run and stay subscribed to the conversation stream
    And I wait for the active run to complete normally
    And I send late cancel_inflight for the completed run
    Then the late cancel returns cancel_ack and no second terminal event
    And the websocket session remains open

  Scenario: conversation-only cancel_inflight stops an active run
    Given chat cancellation scenario "chat-stream"
    When I start a chat run and stay subscribed to the conversation stream
    And I send conversation-only cancel_inflight for the active run
    Then the WebSocket stream final status is "stopped"
