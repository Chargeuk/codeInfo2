# Goal

Capture detailed evidence for changed UI gating rules so the evidence artifact distinguishes direct proof from adjacent or indirect proof.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file when changed code affects UI enable/disable, visibility, selection, or mode-gating behavior.
- Apply this file only to changed non-support implementation or test files.
- Record the outcome in the evidence artifact rather than raising findings from this file.

</usage_rules>

<check_rules>

- For each changed UI gating helper or disabled/hidden/selectable condition, enumerate the exact affordances it is supposed to control:
  - row-level buttons;
  - bulk-action buttons;
  - checkboxes or row selection;
  - submit actions;
  - payload construction, submission, or reset paths.
- Record whether each affordance has direct proof, indirect proof, or missing proof.
- Do not treat proof for one affordance as sufficient proof for another affordance governed by the same invariant.
- When one affordance is blocked but another sibling affordance could still trigger the same semantic action, add that mismatch to the review hotspots and the `Risk-Invariant Matrix`.
- When UI state is disabled, hidden, or mode-gated, explicitly compare the UI rule against the payload, persistence, and submission paths it is supposed to control.

</check_rules>
