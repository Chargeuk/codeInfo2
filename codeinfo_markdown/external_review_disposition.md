Read and follow `$CODEINFO_ROOT/codeinfo_markdown/review_disposition.md` first as the base disposition contract for this step.

Then apply these external-review-specific additions:

1. Preserve the external-review adjudication trail already written into the findings artifact and optional saturation artifact, including the rejected or non-adopted external review comments section.
2. Do not treat the external review input markdown, evidence file, findings file, challenge file, or review handoff as commit-worthy repository artifacts. They are high-quality local review scratch files for the active run only.
3. Preserve the same rejected-risk and blind-spot fallback contract as the base disposition prompt: use the optional challenge artifact when present, and otherwise derive the same reasoning from the evidence and findings artifacts without failing an in-progress older flow.
4. Preserve the base disposition prompt's local-HEAD-vs-resolved-base comparison metadata, including the pinned `comparison_base_commit`. If any repository used `resolved_base_source: local_fallback`, keep that fallback visible in any no-findings closeout or external-review adjudication summary that discusses review confidence.
5. If the plan is reopened because of findings, ensure the resulting plan changes still respond to the endorsed external review findings, not merely to the existence of external comments.
6. When endorsed external review findings create or rewrite follow-up tasks, preserve the base review task-shape rules so `Subtasks` stay implementation- and proof-authoring-focused while runnable wrapper or test commands stay in `Testing`, except for harness or wrapper repair tasks.
7. Do not create one review-fix task per external comment by default. Bundle endorsed external-review findings by repository, repair seam, and proof surface unless a split is required for clarity, ownership, sequencing, or proof honesty.
8. Tiny unrelated low-risk endorsed external-review fixes in the same repository may be absorbed only into another newly created review-fix task from the same appended review-created block, or grouped into one new cleanup task inside that block when no natural parent task exists there.
9. Preserve the adjudication trail in the review artifacts even when multiple endorsed external comments are satisfied by one merged review-fix task.
10. Ensure merged external-review tasks keep durable finding coverage in the plan itself, such as an `Addresses Findings` section or equivalent inline wording that names the endorsed external-review findings they close.
11. Do not repair fragmentation by absorbing endorsed external-review fixes into older pre-existing story tasks. Keep the findings response inside the new appended review-created block.
12. Do not encode routine `Implementation Notes` refreshes as standalone or future-dependent subtasks. Keep those note updates as plan-maintenance after the related subtask or testing step completes.
13. When the stored review handoff says actionable findings are present, this step is not complete until you re-open the canonical plan from disk and confirm that the plan now contains a new `Code Review Findings` section for the current `review_pass_id`, newly added review-created `Task Status: __to_do__` tasks that answer those endorsed findings, durable finding-to-task coverage for them, and a fresh final revalidation task after them.
14. Do not stop after artifact capture, rejected-comment adjudication, or wording-only cleanup when the stored review handoff still says actionable findings are present.
15. If your first edit does not create the required review-fix tasks, continue editing the plan in this same step until it does.
