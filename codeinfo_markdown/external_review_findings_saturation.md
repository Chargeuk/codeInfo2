The base `review_findings_saturation` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Preserve the external-review adjudication trail already written into the findings artifact. If the saturation scan updates the findings artifact in place, keep the endorsed, partially valid, and rejected external-comment reasoning intact rather than replacing it with a fresh summary.
2. Preserve any external-review constraint metadata already attached to an endorsed finding, including lines such as `External Issue Validity`, `External Remedy Compatibility`, `Story Scope Handling`, or `Fix Constraint`. Do not collapse an endorsed-but-constrained finding back into an unconstrained generic summary.
3. Do not rediscover external comments from anywhere else. Use the existing findings artifact and the `external_review_input_file` referenced by the handoff only as additive context for same-class sibling checks.
4. When an external comment reinforced or exposed a same-class sibling defect, make that provenance explicit in the saturation artifact so later blind-spot challenge and disposition can tell whether the external review improved saturation quality.
5. If a promoted sibling finding is materially the same constrained issue as an endorsed external comment whose suggested remedy was out-of-scope, carry forward an equivalent `Fix Constraint` instead of silently treating the sibling as permission to broaden story behavior.
6. If the saturation pass promotes additional findings, explicitly say whether each one came from:
   - the bounded sibling scan alone;
   - the earlier external review comments reinforcing the same defect class;
   - or both together.
7. Preserve the base prompt's bounded-scan rule for consistency and portability issues such as duplicated literals, absolute local filesystem links, or cancellation-aware test-support helpers that may mishandle already-aborted state.
