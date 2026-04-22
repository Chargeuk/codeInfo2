Feature: Ingest start accepts JSON bodies

  Background:
    Given the ingest start test server is running with mock chroma and lmstudio
    And ingest chroma stores are empty

  Scenario: Valid JSON body is accepted with an immediate queue response
    When I POST the ingest start endpoint with JSON body
    Then the response status should be 202
    And the response body should contain an immediate queue acceptance

  Scenario: Canonical ingest fields take precedence over legacy model
    When I POST ingest start with canonical and legacy model fields
    Then the response status should be 202
    And the ingest start request uses provider "openai" and model "text-embedding-3-small"

  Scenario Outline: Malformed typed body fields are rejected before queue admission
    When I POST ingest start with malformed "<field>" body field
    Then the response status should be 400
    And the validation response message should be "<message>"
    And no ingest start queue request should be admitted

    Examples:
      | field       | message                           |
      | name        | name must be a string             |
      | description | description must be a string      |
      | dryRun      | dryRun must be a boolean          |
      | unexpected  | unexpected body field: unexpected |
