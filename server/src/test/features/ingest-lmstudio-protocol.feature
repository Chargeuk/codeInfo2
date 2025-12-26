Feature: LM Studio baseUrl must use ws/wss
  The LM Studio mock should behave like the real SDK and reject non-websocket base URLs.

  Scenario: Rejects http baseUrl
    Given LM Studio base url "http://host.docker.internal:1234"
    When I call the LM Studio probe endpoint
    Then the LM Studio probe status should be 500
    And the LM Studio probe message should contain "Failed to construct LMStudioClient."

  Scenario: Accepts ws baseUrl
    Given LM Studio base url "ws://host.docker.internal:1234"
    When I call the LM Studio probe endpoint
    Then the LM Studio probe status should be 200
    And the LM Studio probe message should contain "ok"
