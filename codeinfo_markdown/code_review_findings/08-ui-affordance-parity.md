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
- If the active plan explicitly names design-target assets intended as implementation references, do not add a screenshot-to-design visual mismatch finding from this helper.
- If usable retained screenshots and the relevant design assets both exist, leave visual mismatch finding generation to `"$CODEINFO_ROOT/codeinfo_markdown/review_visual_design_conformance.md"`.
- Otherwise, record at most a residual-risk note explaining that visual comparison could not run yet.
- Do not treat direct proof for one affordance as sufficient proof for another affordance governed by the same invariant when the sibling affordance could still leak the behavior.

</review_rules>
