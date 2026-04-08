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
- Add a `Risk-Invariant Matrix` section to the evidence summary for the top risky helpers/functions. For each one, record:
  - the helper/function name and repository scope;
  - the semantic invariant or contract it must preserve;
  - the highest-risk contradictory input, state, or mixed-shape condition that could break that invariant;
  - whether current proof is direct, indirect, or missing;
  - which later review step must challenge that invariant explicitly.

</proof_mapping_rules>
