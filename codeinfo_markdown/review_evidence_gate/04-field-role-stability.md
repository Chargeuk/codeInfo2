# Goal

Capture evidence for changed fields that serve more than one role across identity, display, queue payload, lookup, or persisted metadata seams.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file when changed code uses the same field as an identifier, display value, persisted metadata value, queue payload field, or lookup key across more than one seam.
- Apply this file only to changed non-support implementation or test files.
- Record the outcome in the evidence artifact rather than raising findings from this file.

</usage_rules>

<check_rules>

- For each changed field with more than one role, trace:
  - the canonical writer;
  - every changed reader or downstream consumer;
  - whether runtime-only values can overwrite stable display or persisted values.
- Record which role is canonical:
  - identity;
  - display;
  - persistence;
  - queue/request payload;
  - lookup or normalization.
- Add a review hotspot whenever the implementation allows a mutable runtime identifier, request identifier, or run identifier to flow into a stable display or persisted field.
- Add a review hotspot whenever a display or persisted field is reused as a lookup or identity field without explicit proof that the value is stable across overlays, retries, queue promotion, or resumed execution.
- When legacy and canonical field shapes can coexist, record whether mixed-shape inputs preserve the intended canonical field role or allow the weaker field to win unexpectedly.

</check_rules>
