# Goal

Run the focused blind-spot challenge for admission-vs-execution validation drift.

<challenge_rules>

- Use this file only as part of the `review_blind_spot_challenge` review-agent command.
- For one changed queued, deferred, promoted, resumed, or startup-recovered execution path, attempt an admission-vs-execution challenge: assume validation passed when the request was first accepted, then verify whether the same critical preconditions are still enforced when the work actually starts.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
