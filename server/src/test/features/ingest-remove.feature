Feature: Ingest remove

  Scenario: remove root clears lock using the persisted root-path payload
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots first entry has canonical and alias lock parity
    When I POST ingest manage remove for the temp repo
    When I GET ingest manage roots
    Then ingest manage roots count is 0
    And ingest manage locked model id is null

  Scenario: direct production remove rejects a waiting queue-owned root before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/queue-waiting" with legacy model "embed-1"
    And ingest manage mongo queue has waiting request for "/queue-waiting"
    When I POST ingest manage remove for root "/queue-waiting"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove rejects a running queue-owned root before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/queue-running" with legacy model "embed-1"
    And ingest manage mongo queue has running request for "/queue-running" with run id "run-remove-running"
    When I POST ingest manage remove for root "/queue-running"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove rejects a cleanup-blocked queue-owned root before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/queue-cleanup" with legacy model "embed-1"
    And ingest manage mongo queue has cleanup-blocked request for "/queue-cleanup" with run id "run-remove-cleanup"
    When I POST ingest manage remove for root "/queue-cleanup"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove rejects a partial cleanup-blocked queue-owned root before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/queue-partial-cleanup" with legacy model "embed-1"
    And ingest manage mongo queue has partial cleanup-blocked request for "/queue-partial-cleanup" with run id "run-remove-partial-cleanup"
    When I POST ingest manage remove for root "/queue-partial-cleanup"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove rejects an active-run-owned root before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/active-remove" with legacy model "embed-1"
    And ingest manage active runtime owns root "/active-remove" with run id "run-remove-active"
    When I POST ingest manage remove for root "/active-remove"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove rejects a non-exact alias selector before destructive removal
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/alias-remove" with legacy model "embed-1"
    When I POST ingest manage remove for root "/alias-remove/../alias-remove"
    Then ingest manage response status is 404 with code "NOT_FOUND"
    When I GET ingest manage roots
    Then ingest manage roots count is 1

  Scenario: direct production remove prefers target queue ownership over unrelated active work
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/queue-priority" with legacy model "embed-1"
    And ingest manage mongo queue has waiting request for "/queue-priority"
    And ingest manage active runtime owns root "/unrelated-active" with run id "run-remove-unrelated"
    When I POST ingest manage remove for root "/queue-priority"
    Then ingest manage response status is 409 with code "QUEUE_STATE_BLOCKED"
    When I GET ingest manage roots
    Then ingest manage roots entry for "/queue-priority" has queue state "waiting"
