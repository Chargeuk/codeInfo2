Feature: chat tool call visibility

  Scenario: tool events expose call metadata and payload paths
    Given chat visibility scenario "chat-tools"
    When I start a chat run and subscribe to its WebSocket stream
    Then the streamed tool events include call id and name
    And the streamed tool result includes path and repo metadata
