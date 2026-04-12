# Goal

Capture evidence for changed bulk loops so the evidence artifact records whether helper side effects happen once per item or once per batch and whether that behavior is directly proven.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file when changed code adds or changes a loop that calls helpers with refreshes, fetches, rerenders, resets, or similar side effects.
- Apply this file only to changed non-support implementation or test files.
- Record the outcome in the evidence artifact rather than raising findings from this file.

</usage_rules>

<check_rules>

- For each changed bulk loop that calls a helper, record whether the helper performs side effects such as:
  - refreshes;
  - model refreshes or reloads;
  - fetches or network calls unrelated to the direct item action;
  - resets or selection clearing;
  - rerender-driving state updates;
  - logging intended to reflect batch completion.
- State whether the implementation currently performs those side effects once per item or once per batch.
- Record whether current proof makes that side-effect cardinality intentional, indirect, or missing.
- Add a review hotspot whenever per-item helper side effects multiply network requests, rerenders, or model reloads in a bulk path without explicit proof that one-per-item behavior is required.
- When bulk success/failure reporting depends on helpers that catch their own errors, record whether the batch-level status can still distinguish mixed success from full success.

</check_rules>
