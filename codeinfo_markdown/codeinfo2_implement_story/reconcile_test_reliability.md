# Reconcile canonical requirements in the local plan

Read `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md` and `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/tracking.md` as harness-owned prompts. Discover target-local canonical requirements and instructions from the verified repository root, if any. Continue the same main conversation; do not invoke a story picker, create a story, apply a fixed template, or wait for user input.

For CodeInfo2 documentation delegation, follow [shared.md’s CodeInfo2 subagent rules](shared.md#codeinfo2-subagent-rules). The documentation worker owns only local plan edits and never writes Jira.

Stage goal: reconcile the selected writable local plan against each applicable canonical requirement, user instruction, and target-repository practice. Discover documented defaults in the target repository and applicable skills when available; do not import product-specific assumptions. Assess each applicable requirement independently on the local plan and, only as read-only comparison, the external parent. Preserve semantic equivalents, explicit overrides, identity, IDs, history, scope, exclusions, proof, and the existing plan layout. If no applicable defaults are available, report an honest retained/no-applicable-default outcome rather than inventing policy.

The external parent’s Overview/Description and Acceptance Criteria, including custom and rich-text fields, are strictly READ ONLY. Never propose or perform parent-field synchronization, full-parent replacement, or read-merge-write. Put justified reconciliation in the local plan; optional authorized comments or correctly mapped child subtasks follow `tracking.md`. Missing external integrations do not block local work.

For the local plan, CREATE only genuinely missing in-scope content, UPDATE only evidenced gaps, or RETAIN a satisfactory equivalent. This stage is documentation-only: do not create implementation/testing tasks, alter implementation/testing checkboxes, execute proof, repair product/tests, or commit/push. Existing later proposal/planning stages may task genuine work within accepted scope. Keep simple `## Implementation` versus structured `# Tasks` layout unchanged; do not renumber items, close proof, or create competing structure.

Report concise changed/retained sections, source evidence, unavailable defaults, and any remaining owner/action. No external-only gap is a blocker to the local plan update.
