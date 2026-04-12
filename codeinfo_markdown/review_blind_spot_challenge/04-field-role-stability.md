# Goal

Run the blind-spot challenge for fields that cross identity, display, persisted, lookup, or queue/payload seams.

<challenge_rules>

- Apply this file when the evidence artifact or findings artifact shows a changed field serving more than one role across seams.
- Choose one high-risk field and attempt a contradiction where a runtime-only identifier, request identifier, or run identifier overwrites or displaces a stable display or persisted value.
- Trace whether that corrupted or unstable value can later be:
  - rendered to the user;
  - persisted back into metadata;
  - reused as the canonical lookup or identity field.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
