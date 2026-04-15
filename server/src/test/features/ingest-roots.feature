Feature: Ingest roots listing

  Scenario: returns root entry after an ingest run reaches completed state
    Given ingest roots chroma stub is empty
    And ingest roots models scenario "basic"
    And ingest roots temp repo with file "docs/readme.md" containing "hello"
    When I POST ingest roots start with model "embed-1"
    Then ingest roots status for the last run becomes "completed"
    When I GET ingest roots
    Then ingest roots response status is 200
    And ingest roots response has 1 root
    And ingest roots first item path is the temp repo
    And ingest roots first item status is "completed"

  Scenario: queued roots exact-state assertion rejects unexpected error status
    Given ingest roots chroma stub is empty
    And ingest roots models scenario "basic"
    When I POST ingest roots start with model "embed-1"
    Then ingest roots status assertion for the last run expecting "completed" fails with mismatch mentioning "error"

  Scenario: returns empty list when no roots exist
    Given ingest roots chroma stub is empty
    When I GET ingest roots
    Then ingest roots response status is 200
    And ingest roots response has 0 roots

  Scenario: roots include canonical and alias lock parity fields
    Given ingest manage chroma stub is empty
    And ingest manage models scenario "basic"
    And ingest manage temp repo with file "docs/canonical.ts" containing "export const canonical=true;"
    When I POST ingest manage start with model "embed-1"
    Then ingest manage status for the last run becomes "completed"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots first entry has canonical and alias lock parity

  Scenario: brand-new queued roots expose canonical repository identity immediately
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/data/queued-root"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots first id is "/data/queued-root"
    And ingest manage roots first status is "ingesting"
    And ingest manage roots first request id is present
    And ingest manage roots first run id is null
    And ingest manage roots first queue state is "waiting"
    And ingest manage roots first queue position is 1

  Scenario: cleanup-blocked rows stay visible in the ingest roots payload
    Given ingest manage chroma stub is empty
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has cleanup-blocked request for "/tmp/blocked-root" with run id "run-blocked"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots first queue state is "cleanup-blocked"

  Scenario: queued roots keep canonical repository identity while fresh waiting metadata updates in place
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/data/queued-root" with legacy model "stale-model"
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/data/queued-root" named "legacy-repo" with provider "openai" model "fresh-model"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots entry for "/data/queued-root" has canonical id "/data/queued-root"
    And ingest manage roots entry for "/data/queued-root" has name "legacy-repo"
    And ingest manage roots entry for "/data/queued-root" has request id present
    And ingest manage roots entry for "/data/queued-root" has run id null
    And ingest manage roots entry for "/data/queued-root" has queue state "waiting"
    And ingest manage roots entry for "/data/queued-root" has queue position 1
    And ingest manage roots first embedding provider is "openai"
    And ingest manage roots first model is "fresh-model"

  Scenario: waiting roots keep one canonical provider/model pair when canonical and legacy model fields coexist
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/data/queued-root" with legacy model "legacy-lmstudio-model"
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/data/queued-root" named "legacy-repo" with canonical provider "openai" canonical model "text-embedding-3-small" and legacy model "legacy-lmstudio-model"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots entry for "/data/queued-root" has embedding provider "openai"
    And ingest manage roots entry for "/data/queued-root" has embedding model "text-embedding-3-small"

  Scenario: waiting roots blank incompatible legacy fallback identity when only a partial canonical provider survives
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/data/queued-root" with legacy model "legacy-lmstudio-model"
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has waiting request for "/data/queued-root" named "legacy-repo" with canonical provider "openai" and legacy model "legacy-lmstudio-model"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots entry for "/data/queued-root" has embedding provider "openai"
    And ingest manage roots entry for "/data/queued-root" has embedding model ""

  Scenario: resumed roots keep canonical repository identity instead of display-derived fallback
    Given ingest manage chroma stub is empty
    And ingest manage root metadata exists for "/data/queued-root" with legacy model "stale-model"
    And ingest manage mongo queue is empty
    And ingest manage mongo queue has running request for "/data/queued-root" with run id "resumed-run-1"
    When I GET ingest manage roots
    Then ingest manage roots count is 1
    And ingest manage roots entry for "/data/queued-root" keeps canonical id "/data/queued-root" when resumed
    And ingest manage roots entry for "/data/queued-root" has run id "resumed-run-1"
    And ingest manage roots entry for "/data/queued-root" has queue state "running"
