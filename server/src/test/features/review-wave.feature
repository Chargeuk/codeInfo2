@review-wave
Feature: Generic story review batches

  Scenario Outline: Configured reviewers receive one ordinary job per requested target or story scope
    Given a generic review batch with <targets> pinned target(s)
    When I schedule two target reviewers and one story reviewer
    Then the generic batch contains <jobs> discoverable job workspaces
    And every scheduled reviewer receives the common workspace contract
    And no job workspace encodes a fast or slow review class

    Examples:
      | targets | jobs |
      | 1       | 3    |
      | 3       | 7    |

  Scenario: An empty or unexpectedly formatted reviewer output remains recoverable
    Given a generic review batch with 1 pinned target(s)
    When I schedule two target reviewers and one story reviewer
    And one reviewer writes an unexpected output filename while another remains empty
    Then both reviewer jobs remain discoverable without parsing their output

  Scenario: Moving a reviewer between scheduling groups does not change its consumer contract
    Given a generic review batch with 1 pinned target(s)
    When I compare the same reviewer in two differently named scheduling groups
    Then both scheduled jobs expose the same common workspace fields
