@review-wave
Feature: Story review wave orchestration

  Scenario Outline: Every target receives two fast reviews while one story reviewer overlaps the matrix
    Given a review wave pass with <targets> pinned target(s)
    When I expand the production mixed review wave
    Then the review wave contains <jobs> concurrent jobs
    And every target has exactly two fast local review jobs
    And the review wave contains exactly one cross-repository singleton

    Examples:
      | targets | jobs |
      | 1       | 3    |
      | 3       | 7    |

  Scenario Outline: Every target receives one final slow review without a cross-repository rerun
    Given a review wave pass with <targets> pinned target(s)
    When I expand the production slow review wave
    Then the review wave contains <targets> concurrent jobs
    And every target has exactly one slow main review job

    Examples:
      | targets |
      | 1       |
      | 3       |

  Scenario: One target exits the cross-repository review before expensive work
    Given a review wave pass with 1 pinned target(s)
    When I gate the cross-repository review
    Then the cross-repository result is not applicable

  Scenario: A second review pass refreshes every child identity
    Given a review wave pass with 3 pinned target(s)
    When I expand the production mixed review wave
    And I advance every target and expand a second review pass
    Then no second-pass child reuses its first-pass input identity

  Scenario: Partial coverage remains visible and prevents a false-clean closeout
    Given review job statuses "completed,missing,completed,completed"
    When I evaluate review-wave closeout
    Then missing review coverage remains visible
    And review-wave closeout is blocked

  Scenario: Review-created work retains repository ownership
    Then the review-wave consumer contract requires target-owned tasks

  Scenario: Validated multi-target findings retain ownership through downstream tasking
    Given a finalized review wave with 2 validated target owners
    When I route aggregated review findings to downstream tasking
    Then every routed finding retains its validated target owner
    And cross-repository coverage remains visible downstream
    And downstream tasking uses embedded target validation instead of a plan-host-only pointer
