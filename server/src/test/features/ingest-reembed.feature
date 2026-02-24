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

  Scenario: re-embed uses lock-derived provider and rejects silent switching
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/tmp/reembed-root" with legacy model "embed-1"
    And ingest manage lock is provider "openai" model "text-embedding-3-small" dimensions 1536
    When I POST ingest manage reembed for root "/tmp/reembed-root"
    Then ingest manage response status is 409 with code "MODEL_LOCKED"
