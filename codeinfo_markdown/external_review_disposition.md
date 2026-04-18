Read and follow `$CODEINFO_ROOT/codeinfo_markdown/review_disposition.md` first as the base disposition contract for this step.

Then apply these external-review-specific additions:

1. Preserve the external-review adjudication trail already written into the findings artifact, including the rejected or non-adopted external review comments section.
2. Do not treat the external review input markdown as a durable review artifact. The durable artifacts for this flow remain the evidence file and findings file created during the current review pass.
3. Preserve the same rejected-risk and blind-spot fallback contract as the base disposition prompt: use the optional challenge artifact when present, and otherwise derive the same reasoning from the evidence and findings artifacts without failing an in-progress older flow.
4. If the plan is reopened because of findings, ensure the resulting plan changes still respond to the endorsed external review findings, not merely to the existence of external comments.
5. When endorsed external review findings create or rewrite follow-up tasks, preserve the base review task-shape rules so `Subtasks` stay implementation- and proof-authoring-focused while runnable wrapper or test commands stay in `Testing`, except for harness or wrapper repair tasks.
6. Do not encode routine `Implementation Notes` refreshes as standalone or future-dependent subtasks. Keep those note updates as plan-maintenance after the related subtask or testing step completes.
7. When the stored review handoff says actionable findings are present, this step is not complete until you re-open the canonical plan from disk and confirm that the plan now contains a new `Code Review Findings` section for the current `review_pass_id`, newly added review-created `Task Status: __to_do__` tasks that answer those endorsed findings, and a fresh final revalidation task after them.
8. Do not stop after artifact capture, rejected-comment adjudication, or wording-only cleanup when the stored review handoff still says actionable findings are present.
9. If your first edit does not create the required review-fix tasks, continue editing the plan in this same step until it does.
