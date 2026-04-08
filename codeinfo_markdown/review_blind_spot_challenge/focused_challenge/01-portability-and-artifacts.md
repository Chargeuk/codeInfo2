# Goal

Run the focused blind-spot challenge for low-risk consistency, portability, and tracked-artifact issues outside the main risk matrix.

<challenge_rules>

- Use this file only as part of the `review_blind_spot_challenge` review-agent command.
- Inspect one additional changed non-helper file, if present, for a low-risk consistency or portability defect that would not naturally appear in the risk matrix.
- Prefer changed `README.md` or `docs/**` links, duplicated literals that should reuse a nearby canonical constant, changed test-support mocks that accept cancellation inputs, or tracked local/runtime artifact files that should not have been committed.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
