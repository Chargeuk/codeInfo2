Feature: Log APIs

  Scenario: accepts valid log entry
    When I POST "/logs" with body:
      """
      {"level":"info","message":"hello","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}
      """
    Then the log response status code is 202
    And the log response field "sequence" is greater than 0

  Scenario: rejects invalid level
    When I POST "/logs" with body:
      """
      {"level":"verbose","message":"oops","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}
      """
    Then the log response status code is 400

  Scenario: rejects oversize payload
    When I POST an oversize log payload
    Then the log response status code is 400

  Scenario: filters GET by level
    Given these logs exist:
      | level | message | source |
      | info  | hello   | client |
      | error | boom    | client |
    When I GET "/logs?level=error" from logs API
    Then the log response status code is 200
    And all returned log levels are "error"

  Scenario: SSE stream sends heartbeat and events
    When I start the log stream
    And I POST "/logs" with body:
      """
      {"level":"info","message":"stream me","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}
      """
    Then I receive a heartbeat and an SSE log event

  Scenario: redacts sensitive fields
    When I POST "/logs" with body:
      """
      {"level":"info","message":"keep safe","timestamp":"2025-01-01T00:00:00.000Z","source":"client","context":{"password":"secret","note":"ok"}}
      """
    And I GET "/logs" from logs API
    Then the log response status code is 200
    And the latest log context redacts passwords
