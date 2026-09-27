# Verify Acceptance Criteria

Read `$CODEINFO_ROOT/codeinfo_markdown/retrospective_story/shared.md` and the selected plan's `### Acceptance Criteria`. Check each observable behavior in the base-to-initial-HEAD diff, changed tests, and current implementation. Write concise acceptance bullets for behavior actually delivered. Include important error and boundary behavior when it is evidenced. Do not turn an unimplemented idea or an unrun test into an acceptance claim. Update the section and recheck every bullet against concrete code or proof evidence.

Always include acceptance criteria, in wording appropriate to the story, that require all three of these outcomes:

- Newly added code is used: no unused variables, parameters, functions, statements, or redundant lines remain.
- Substantive new or modified code has accurate high-level comments explaining both what it does and why the change was made.
- Changes do not leave variables or parameters in previously existing code unused after their former use was removed or replaced.

Inspect the changed code and its callers to check each outcome; do not treat the presence of a lint command or a comment as proof by itself. If an outcome is not met, keep its acceptance criterion and record the concrete affected files and unresolved gap under `### Questions`. Do not claim the criterion passed, remove it to make the plan appear complete, or mark the associated work done. The later questions gate must stop tasking until the gap is resolved in the repository.
