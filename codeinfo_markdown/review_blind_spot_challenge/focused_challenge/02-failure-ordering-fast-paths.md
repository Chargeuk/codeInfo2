# Goal

Run the focused blind-spot challenge for failure ordering and fast-path dependency assumptions.

<challenge_rules>

- Use this file only as part of the `review_blind_spot_challenge` review-agent command.
- For one changed orchestration function, attempt a focused failure-ordering challenge: assume the external provider, model bootstrap, or dispatcher setup fails before any real work begins, and verify whether a no-op, metadata-only, delete-only, or zero-work fast path would still complete correctly.
- Prefer paths where the existing tests prove terminal status semantics but do not explicitly prove behavior under provider or bootstrap failure.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
