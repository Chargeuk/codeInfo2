# Goal

Run the findings-phase field-role stability audit for changed fields that serve identity, display, persisted, lookup, or queue/payload roles across more than one seam.

<review_rules>

- Apply this file when changed code uses the same field as an identifier, display value, persisted metadata value, queue payload field, or lookup key across more than one seam.
- Trace the canonical writer and every changed reader or downstream consumer.
- Raise a finding when a mutable runtime identifier, request identifier, or run identifier can overwrite a stable display or persisted field.
- Raise a finding when a display or persisted field is reused as an identity or lookup field without direct proof that the value remains stable across overlays, retries, queue promotion, or resumed execution.
- Raise a finding when legacy and canonical field shapes can coexist and the weaker or less stable field can win in mixed-shape inputs.

</review_rules>
