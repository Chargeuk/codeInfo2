# Goal

Run the focused blind-spot challenge for wrapped-error and producer-consumer mismatch paths.

<challenge_rules>

- Use this file only as part of the `review_blind_spot_challenge` review-agent command.
- For one changed producer-consumer error path, attempt a wrapped-error mismatch challenge: assume the lower layer now emits a normalized or provider-specific error instead of the old raw SDK error shape, and verify whether the caller still reaches the correct cancel, retry, ignore, or terminal branch.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
