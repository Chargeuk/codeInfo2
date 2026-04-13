# Goal

Run the findings-phase audit for idempotency, replay safety, and duplicate side effects across retries, resumes, and partial-failure reruns.

<review_rules>

- Apply this file when changed code can be retried, resumed, replayed, redelivered, requeued, restarted, or re-run after a partial success or ambiguous failure.
- Inspect whether the changed path has side effects such as:
  - writes or deletes;
  - enqueue or dispatch operations;
  - external API calls or webhooks;
  - billing, notifications, logs, or audit events meant to happen once;
  - state transitions that should not be duplicated or skipped.
- Raise a finding when the same logical operation can perform the side effect more than once without a dedupe key, idempotency token, ownership proof, compare-and-swap guard, terminal-state check, or equivalent replay barrier.
- Raise a finding when retry or resume logic can reapply an old intent after fresher state has already superseded it.
- Raise a finding when a pre-read guard and a later write or update do not enforce the same rewrite rules, ownership rules, or compare-and-swap conditions. Pay special attention to time-of-check/time-of-use windows where a later `update`, `findOneAndUpdate`, or equivalent write can overwrite state that was inserted or changed after the earlier read.
- Raise a finding when partial-failure handling leaves the system unable to distinguish:
  - not started;
  - started but not committed;
  - committed but response lost;
  - committed and later replayed.
- When an operation is intentionally not idempotent, verify that the changed contract makes that explicit and that the caller, queue, or UI flow does not imply safe replay semantics.

</review_rules>
