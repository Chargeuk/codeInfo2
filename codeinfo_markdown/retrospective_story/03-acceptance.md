# Verify Acceptance Criteria

Read `$CODEINFO_ROOT/codeinfo_markdown/retrospective_story/shared.md` and the selected plan's `### Acceptance Criteria`. Check each delivered behavior in the supported base-to-initial-HEAD diff when available, changed tests, current implementation, newly added or modified comments, and relevant implementation commit subjects and bodies. Use comments and messages to identify intended behavior and rationale, then verify every criterion against the delivered code. Write concise acceptance bullets for behavior actually delivered, including evidenced error and boundary behavior. These criteria verify the branch work and do not authorize new features, interface changes, or unrelated cleanup. Do not claim a test passed because its source exists. Edit only the plan.

Always include acceptance criteria, in wording appropriate to the story, that require all four of these outcomes:

- Newly added code is used: no unused variables, parameters, functions, statements, or redundant lines remain.
- Substantive new or modified code has accurate high-level comments explaining both what it does and why the change was made.
- Changes do not leave variables or parameters in previously existing code unused after their former use was removed or replaced.
- Appropriate automated tests cover the new behavior already delivered, including relevant error and boundary cases. This is a criterion for later validation; this documentation flow does not judge coverage, write tests, or execute them.

State explicitly that no additional user-facing behavior, interface, visual, or API changes are required beyond what the branch demonstrably implements. When the work is internal only, describe its observed performance, stability, or maintenance outcome without implying a new screen, interaction, or external contract. Existing visible behavior and interfaces remain as evidenced by the branch. Use changed code, callers, and test sources only to describe what the branch implemented and to keep criteria within that observed scope. Do not assess whether the code or test coverage passes these criteria, list suspected defects, add blockers to Implementation notes, or expand the final task with perceived missing work. Leave final validation to the later execution of the open final task. Do not build, run tests, lint, format, start services, or perform manual testing.
