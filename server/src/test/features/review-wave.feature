@review-wave
Feature: Story review wave orchestration

  Scenario Outline: Every target receives three reviews while one story reviewer overlaps the matrix
    Given a review wave pass with <targets> pinned target(s)
    When I expand the production mixed review wave
    Then the review wave contains <jobs> concurrent jobs
    And every target has exactly three local review jobs
    And the review wave contains exactly one cross-repository singleton

    Examples:
      | targets | jobs |
      | 1       | 4    |
      | 3       | 10   |

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
