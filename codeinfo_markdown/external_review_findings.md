The base `code_review_findings` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Read the `external_review_input_file` referenced by the current review handoff and treat it as candidate review input, not as automatically valid findings.
2. For each external review comment, explicitly decide whether it is:
   - an endorsed finding;
   - a partially valid but non-reopening concern;
   - a rejected comment.
3. Record the reasoning for each decision so a human can see why the external review was or was not adopted.
4. If an external comment identifies a valid, low-risk consistency problem in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification`.
5. Preserve the base prompt's `Rejected Risk Notes` section. When an external comment overlaps one of the top-risk helpers/functions, make that overlap explicit so later blind-spot challenge and disposition steps can see whether the external comment strengthened, weakened, or left unchanged the rejected-risk reasoning.
6. After the findings list, add a short section for rejected or non-adopted external review comments and explain why they were not accepted as findings.
7. When updating the review handoff, preserve the same `findings_file` behavior required by the shared base findings sequence and keep any useful counts or disposition hints.
8. Preserve the shared base findings sequence's remote-first base metadata. If any repository used `resolved_base_source: local_fallback`, carry that residual-risk context into the external-review adjudication notes when it affects confidence in an external comment.
9. Apply the shared base findings sequence's consistency and portability scan when evaluating external comments too, especially for duplicated literals that should reuse a canonical constant, absolute local filesystem links in changed user-facing docs, and changed mocks or test helpers that accept cancellation inputs but may mishandle already-aborted or already-cancelled state.
10. When an external comment claims that provider or bootstrap setup happens before a zero-work, delete-only, metadata-only, or no-op fast path proves that real work still exists, evaluate that ordering directly and prefer `should_fix` when the fast path is intended to be dependency-free but still fails under provider or bootstrap unavailability.
