Feature: ingest embedding models endpoint
  Returns embedding-capable models and handles LM Studio failures

  Scenario: returns only embedding models
    Given ingest models scenario "many"
    When I request ingest models
    Then the ingest models response status code is 200
    And the ingest models body has 1 model

  Scenario: LM Studio failure returns 502
    Given ingest models scenario "chat-error"
    When I request ingest models
    Then the ingest models response status code is 502
    And the ingest models field "status" equals "error"
