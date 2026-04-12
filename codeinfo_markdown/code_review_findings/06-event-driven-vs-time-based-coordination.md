# Goal

Run the findings-phase audit for time-based coordination where a stronger event-driven, callback-driven, subscription-driven, or state-boundary-driven control path may already exist.

<review_rules>

- Apply this file when changed code uses timers, sleeps, polling loops, retry delays, heartbeat waits, debounce windows, or elapsed-time assertions to coordinate state changes, completion, cleanup, retries, or proof.
- Inspect whether the changed path already has, or could reasonably expose, a stronger coordination primitive such as:
  - a completion callback;
  - an event emitter or listener;
  - a stream or subscription update;
  - a queue state transition;
  - a persisted state change with explicit ownership;
  - a deterministic scheduler, latch, or resource boundary in tests.
- Do not raise a finding merely because a timer exists. Timers are valid as fallback guards, deadlines, backoff controls, or product-facing waits when no trustworthy event boundary exists.
- Raise a finding when a timer or polling loop is used as the primary coordination path even though a stronger event-driven or deterministic boundary already exists and would materially reduce race risk, stale-state delay, duplicate work, or proof weakness.
- Raise a finding when an elapsed-time assertion in a test is standing in for a stronger deterministic boundary that the code under test already exposes.
- Raise a finding when timer-based cleanup, retry, or takeover logic can mask an ownership bug, stale-state misclassification, or missing completion signal rather than addressing the real coordination boundary.
- When a timer is intentionally the primary mechanism, verify that the changed contract makes that choice explicit and that the interval, timeout, or backoff shape is justified by the surrounding runtime or product behavior rather than by implementation convenience alone.

</review_rules>
