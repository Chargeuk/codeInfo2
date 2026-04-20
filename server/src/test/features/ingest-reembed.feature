Feature: Ingest re-embed

  Scenario: re-embed updates root with new run
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots first model is "embed-1"
    When I change ingest manage temp file "a.ts" to "export const a=2;"
    And I POST ingest manage reembed for the temp repo
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots first model is "embed-1"

  @mongo
  Scenario: re-embed rejects a non-allowlisted lock-derived OpenAI model before queue admission
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/tmp/reembed-root" with legacy model "embed-1"
    And ingest manage lock is provider "openai" model "text-embedding-3-small" dimensions 1536
    When I POST ingest manage reembed for root "/tmp/reembed-root"
    Then ingest manage response status is 409 with code "OPENAI_MODEL_UNAVAILABLE"

  @mongo
  Scenario: re-embed rejects a non-canonical selector alias before queue admission
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage root metadata exists for "/tmp/reembed-root" with legacy model "embed-1"
    When I POST ingest manage reembed for root "/tmp/reembed-root/../reembed-root"
    Then ingest manage response status is 404 with code "NOT_FOUND"
    And ingest manage mongo queue remains empty

  @mongo
  Scenario: waiting queued re-embed roots view keeps the persisted stable display name
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/tmp/reembed-root" named "legacy-repo"
    When I GET ingest manage roots
    Then ingest manage roots entry for "/tmp/reembed-root" has name "legacy-repo"
    And ingest manage roots entry for "/tmp/reembed-root" has request id present
    And ingest manage roots entry for "/tmp/reembed-root" has run id null
    And ingest manage roots entry for "/tmp/reembed-root" has queue state "waiting"
    And ingest manage roots entry for "/tmp/reembed-root" has queue position 1

  @mongo
  Scenario: queue pump replays waiting re-embed using the canonical target as the executable root
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/tmp/recover-waiting"
    And ingest manage queue runtime records started paths
    When ingest manage queue pump runs
    Then ingest manage queue runtime started paths are "/tmp/recover-waiting"

  @mongo
  Scenario: startup recovery does not replay barrier-backed committed running work
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has barrier-backed running request for "/tmp/recover-finished" with run id "run-recovered-finished"
    And ingest manage mongo queue has waiting request for "/tmp/recover-second"
    And ingest manage queue runtime records started paths
    When ingest manage startup recovery runs
    Then ingest manage queue runtime started paths are empty

  @mongo
  Scenario: startup recovery resumes genuinely unfinished running work before newer waiting work
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has running request for "/tmp/recover-first" with run id "run-recovered"
    And ingest manage mongo queue has waiting request for "/tmp/recover-second"
    And ingest manage queue runtime records started paths
    When ingest manage startup recovery runs
    Then ingest manage queue runtime started paths are "/tmp/recover-first"
    And ingest manage logs include "QUEUE_STARTUP_RECOVERY_RESUMED_IN_ORDER"

  @mongo
  Scenario: startup recovery rejects mismatched persisted re-embed paths before replay
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage temp repo with file "src/recover-mismatch.ts" containing "export const recoverMismatch = true;"
    And ingest manage mongo queue has running request for the temp repo with run id "run-recovered-mismatch" and mismatched persisted path
    When ingest manage startup recovery runs
    Then ingest manage status for run "run-recovered-mismatch" becomes "error"
    And ingest manage status for run "run-recovered-mismatch" has last error "queued reembed requestPayload.path must match canonicalTargetPath"

  @mongo
  Scenario: startup recovery falls back to the canonical target when persisted re-embed path is missing
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has running request for "/tmp/recover-missing-path" with run id "run-recovered-missing-path" missing persisted path
    And ingest manage queue runtime records started paths
    When ingest manage startup recovery runs
    Then ingest manage queue runtime started paths are "/tmp/recover-missing-path"

  @mongo
  Scenario: queue pump fails closed when live root-state validation degrades before replay starts
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage temp repo with file "src/feature-invalid-state.ts" containing "export const featureInvalidState = true;"
    And ingest manage root metadata exists for the temp repo in state "error"
    And ingest manage mongo queue has waiting request for the temp repo
    And ingest manage queue runtime records started paths
    When ingest manage queue pump runs
    Then ingest manage queue runtime started paths are empty
    And ingest manage runtime status for the last queue run is error "INVALID_REEMBED_STATE" with message "INVALID_REEMBED_STATE"

  @mongo
  Scenario: startup recovery rejects malformed canonical embedding fields before replay writes started state
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage temp repo with file "src/feature-invalid-model.ts" containing "export const featureInvalidModel = true;"
    And ingest manage mongo queue has running request for the temp repo with run id "run-recovered-invalid-canonical-model" and canonical model value 42
    And ingest manage queue runtime records started paths
    When ingest manage startup recovery runs
    Then ingest manage queue runtime started paths are empty
    And ingest manage runtime status for run "run-recovered-invalid-canonical-model" reports error "VALIDATION" with message "embeddingProvider and embeddingModel are required when canonical fields are present"
