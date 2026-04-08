# Goal

Run the blind-spot challenge for changed bulk loops so per-item helper side effects get one more adversarial check.

<challenge_rules>

- Apply this file when the evidence artifact or findings artifact shows a changed loop that calls helpers with refreshes, reloads, rerenders, resets, or similar side effects.
- Attempt a contradiction where:
  - one-per-item side effects produce multiplied refreshes, fetches, rerenders, or model reloads;
  - or helper-level error swallowing makes batch-level success reporting misleading.
- Prefer bulk paths where one-per-batch behavior appears likely but the implementation still performs the side effects per item.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
