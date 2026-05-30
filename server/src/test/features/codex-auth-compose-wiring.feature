Feature: Codex auth compose wiring
  Scenario: checked-in main and e2e server services keep the host Codex mount distinct from the runtime Codex volume
    Then the main compose server service mounts the host Codex home read-only at /host/codex
    And the main compose server service keeps codex-data mounted at /app/codex
    And the e2e compose server service mounts the host Codex home read-only at /host/codex
    And the e2e compose server service keeps codex-data mounted at /app/codex
