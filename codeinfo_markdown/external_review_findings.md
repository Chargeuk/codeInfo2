The base `code_review_findings` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Read and follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"` while adjudicating external comments. External review may identify real defects, but it must not widen approved story behavior scope.
2. Read the `external_review_input_file` referenced by the current review handoff and treat it as candidate review input, not as automatically valid findings.
3. For each external review comment, explicitly decide whether it is:
   - an endorsed finding;
   - a partially valid but non-reopening concern;
   - a rejected comment.
4. Record the reasoning for each decision so a human can see why the external review was or was not adopted.
5. For each external review comment, separate the underlying issue from the reviewer's suggested remedy whenever the comment provides both. The adjudication trail for each comment must explicitly record:
   - `External Issue Validity: valid_in_scope | valid_out_of_scope | invalid_or_unproven`
   - `External Remedy Compatibility: in_scope | out_of_scope | no_remedy_provided`
   - `Story Scope Handling: endorse_and_apply | endorse_but_constrain_fix | reject_as_out_of_scope | reject_as_invalid`
6. Keep the existing top-level external-review outcomes above. Do not replace them with a new top-level taxonomy. A comment whose underlying issue is real and in scope must still become an endorsed finding even when the reviewer's suggested fix is out of scope.
7. When the underlying issue is real and in scope but the reviewer's suggested fix would widen user-facing behavior beyond the approved story, keep the issue actionable as an endorsed finding and add an explicit `Fix Constraint:` line to that finding. That line must say that the issue remains actionable for this story, but downstream steps must preserve approved story behavior and devise an in-scope fix instead of adopting the reviewer's proposed behavior change.
8. If the underlying issue itself is outside approved story behavior scope and is not a current-story regression away from previously approved or preserved behavior, reject the comment as out-of-scope rather than turning it into an endorsed finding.
9. If an external comment identifies a valid, low-risk consistency problem in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification`.
10. Preserve the base prompt's `Rejected Risk Notes` section. When an external comment overlaps one of the top-risk helpers/functions, make that overlap explicit so later blind-spot challenge and disposition steps can see whether the external comment strengthened, weakened, or left unchanged the rejected-risk reasoning.
11. After the findings list, add a short external-comment disposition section that explains how each non-adopted or constrained comment was handled. Do not describe an endorsed finding with a rejected remedy as "not accepted as a finding." Distinguish at least:
   - comments rejected because the underlying issue is outside approved story scope;
   - comments rejected because they are invalid or unproven;
   - comments kept as endorsed findings whose suggested remedy was rejected as out-of-scope.
12. When an endorsed finding uses `Story Scope Handling: endorse_but_constrain_fix`, preserve that wording or an equivalent explicit constraint in the findings artifact so later disposition, minor-fix, and task-up steps do not silently lose the distinction between the real issue and the rejected remedy.
13. When updating the review handoff, preserve the same `findings_file` behavior required by the shared base findings sequence and keep any useful counts or disposition hints.
14. Inherit the shared base findings sequence's semantic handoff-reading behavior: prefer local-HEAD-vs-resolved-base comparison metadata when present, safely infer missing non-critical context from referenced artifacts and git state when possible, and do not ask for repeated regeneration solely to satisfy handoff formatting.
15. Preserve the shared base findings sequence's local-HEAD-vs-resolved-base comparison context, including the pinned `comparison_base_commit` when present or safely inferred. If any repository used or appears to have used `resolved_base_source: local_fallback`, carry that residual-risk context into the external-review adjudication notes when it affects confidence in an external comment.
16. Apply the shared base findings sequence's consistency and portability scan when evaluating external comments too, especially for duplicated literals that should reuse a canonical constant, absolute local filesystem links in changed user-facing docs, and changed mocks or test helpers that accept cancellation inputs but may mishandle already-aborted or already-cancelled state.
17. When an external comment claims that provider or bootstrap setup happens before a zero-work, delete-only, metadata-only, or no-op fast path proves that real work still exists, evaluate that ordering directly and prefer `should_fix` when the fast path is intended to be dependency-free but still fails under provider or bootstrap unavailability.
