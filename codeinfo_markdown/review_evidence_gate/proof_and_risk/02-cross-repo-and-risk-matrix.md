# Goal

Capture cross-repository evidence and build the `Risk-Invariant Matrix` for the highest-risk changed helpers/functions.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after the acceptance-proof map is complete.
- Treat this file as the owner of cross-repository evidence and `Risk-Invariant Matrix` construction.

</usage_rules>

<proof_mapping_rules>

- For multi-repository stories, add a dedicated cross-repository evidence section covering:
  - integration seams;
  - ownership boundaries;
  - dependency direction;
  - compatibility expectations;
  - any before/after contract comparison that only becomes visible when two or more repositories are considered together.
- Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
- In addition, when present, include:
  - one changed startup, bootstrap, recovery, dispatcher, or other default entrypoint that can determine whether the standard runtime or degraded contract is reachable;
  - one changed proof-owning test file, step-definition file, or equivalent proof surface that can determine whether the claimed invariant is being asserted honestly.
- If one selected item already satisfies one of those extra categories, record that overlap instead of selecting a duplicate item.
- For any selected helper/function or extra review item that performs a pre-read before a later write or update, record an `intervening state change between read and write` contradiction candidate in addition to any other malformed or contradictory input.
- Add a `Risk-Invariant Matrix` section to the evidence summary for the selected high-risk items. For each one, record:
  - the helper/function, entrypoint, or proof-owning file and repository scope;
  - the semantic invariant or contract it must preserve;
  - the highest-risk contradictory input, state, or mixed-shape condition that could break that invariant;
  - whether current proof is direct, indirect, or missing;
  - which later review step must challenge that invariant explicitly.

</proof_mapping_rules>
