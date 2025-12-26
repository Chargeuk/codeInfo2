Feature: Ingest roots endpoint succeeds without null metadata

  Background:
    Given the ingest roots test server is running with mock chroma and lmstudio
    And ingest roots chroma stores are empty

  Scenario: Roots listing returns 200 on clean store
    When I GET the ingest roots endpoint
    Then the response status should be 200
    And the response body should include empty roots and no locked model
