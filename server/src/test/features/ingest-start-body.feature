Feature: Ingest start accepts JSON bodies

  Background:
    Given the ingest start test server is running with mock chroma and lmstudio
    And ingest chroma stores are empty

  Scenario: Valid JSON body is accepted
    When I POST the ingest start endpoint with JSON body
    Then the response status should be 202
    And the response body should contain a runId
