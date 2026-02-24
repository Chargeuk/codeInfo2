Feature: ingest embedding models endpoint
  Returns deterministic provider-aware envelopes for LM Studio and OpenAI

  Scenario: missing key disables OpenAI and keeps LM Studio models
    Given ingest models scenario "many"
    And ingest models OpenAI scenario "disabled"
    When I request ingest models
    Then the ingest models response status code is 200
    And the ingest models body has 1 model
    And the ingest models path "openai.statusCode" equals "OPENAI_DISABLED"

  Scenario: transient OpenAI failure returns warning envelope and preserves LM Studio
    Given ingest models scenario "many"
    And ingest models OpenAI scenario "transient-failure"
    When I request ingest models
    Then the ingest models response status code is 200
    And the ingest models body has 1 model
    And the ingest models path "openai.statusCode" equals "OPENAI_MODELS_LIST_TEMPORARY_FAILURE"

  Scenario: OpenAI allowlist no-match returns warning with retryable false
    Given ingest models scenario "many"
    And ingest models OpenAI scenario "allowlist-no-match"
    When I request ingest models
    Then the ingest models response status code is 200
    And the ingest models body has 1 model
    And the ingest models path "openai.statusCode" equals "OPENAI_ALLOWLIST_NO_MATCH"
    And the ingest models path "openai.warning.retryable" equals "false"

  Scenario: LM Studio failure remains 200 with warning envelope
    Given ingest models scenario "chat-error"
    And ingest models OpenAI scenario "ok"
    When I request ingest models
    Then the ingest models response status code is 200
    And the ingest models path "lmstudio.status" equals "warning"
