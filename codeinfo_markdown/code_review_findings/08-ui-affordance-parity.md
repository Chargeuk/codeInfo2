# Goal

Run the findings-phase UI affordance parity audit for changed disabled, hidden, selectable, or mode-gated behavior.

<review_rules>

- Apply this file when changed code affects UI enable/disable, visibility, selection, or mode-gating behavior.
- Compare every affordance governed by the same semantic invariant, including:
  - row-level buttons;
  - bulk-action buttons;
  - checkboxes or row selection;
  - submit actions;
  - payload construction, submission, or reset paths.
- Raise a finding when one affordance is blocked, hidden, or excluded but a sibling affordance still triggers the same semantic action.
- Raise a finding when UI gating does not match the payload-construction, persistence, or reset path it is supposed to control.
- Do not treat direct proof for one affordance as sufficient proof for another affordance governed by the same invariant when the sibling affordance could still leak the behavior.

</review_rules>
