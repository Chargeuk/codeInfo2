@skip
Feature: health endpoint
  Scenario: returns ok
    When I call the health endpoint
    Then I receive status ok
