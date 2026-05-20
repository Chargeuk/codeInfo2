Feature: Codex auth bootstrap
  Scenario: read-only split host auth seeds the runtime home
    Given a Codex bootstrap container home
    And a distinct Codex bootstrap host home
    And the host bootstrap auth file contains token "host-token"
    And the host bootstrap home is read-only
    When I run Codex auth bootstrap
    Then the Codex bootstrap runtime auth file contains token "host-token"

  Scenario: repeated startup keeps runtime auth and avoids cleanup
    Given a Codex bootstrap container home
    And a distinct Codex bootstrap host home
    And the Codex bootstrap runtime auth file starts with token "runtime-token"
    And the host bootstrap auth file contains token "host-token"
    And the host bootstrap home is read-only
    When I run Codex auth bootstrap twice
    Then the Codex bootstrap runtime auth file contains token "runtime-token"
    And no auth cleanup operations were attempted

  Scenario: missing host auth leaves runtime auth absent
    Given a Codex bootstrap container home
    And a distinct Codex bootstrap host home
    When I run Codex auth bootstrap
    Then the Codex bootstrap runtime auth file is absent
    And no auth cleanup operations were attempted
