Feature: Chat cancellation
  As an operator
  I want chat streaming to stop when the client disconnects
  So that LM Studio work is cancelled promptly

  Scenario: Aborting chat stops generation
    Given chat cancellation scenario "chat-stream"
    When I start a chat stream and abort after first token
    Then the chat prediction is cancelled server side
    And the streamed events stop before completion
