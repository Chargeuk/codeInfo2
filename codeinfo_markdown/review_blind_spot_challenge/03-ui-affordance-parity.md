# Goal

Run the blind-spot challenge for UI affordance parity so risky disabled, hidden, selectable, or mode-gated behavior gets one more contradiction-focused check.

<challenge_rules>

- Apply this file when the evidence artifact or findings artifact shows changed UI enable/disable, visibility, selection, or mode-gating behavior.
- Choose one high-risk invariant and compare all sibling affordances it is supposed to govern, including:
  - row-level actions;
  - bulk actions;
  - checkboxes or row selection;
  - payload construction, submission, or reset behavior.
- Attempt a contradiction where one affordance remains active or still leaks the same semantic action while a sibling affordance is blocked or hidden.
- If the active plan explicitly names design-target assets intended as implementation references, you may challenge one high-risk changed visual surface for contradiction analysis, but do not add a screenshot-to-design visual mismatch finding from this helper.
- If usable retained screenshots and the relevant design assets both exist, defer visual mismatch finding generation to `"$CODEINFO_ROOT/codeinfo_markdown/review_visual_design_conformance.md"`.
- If that evidence is absent, do not create a new visual finding solely from that absence.
- Record whether that contradiction:
  - creates a new endorsed finding;
  - strengthens a rejected-risk conclusion;
  - or leaves only residual weak proof.

</challenge_rules>
