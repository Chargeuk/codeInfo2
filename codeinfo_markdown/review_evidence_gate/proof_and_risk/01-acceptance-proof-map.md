# Goal

Capture the acceptance-proof map for the evidence artifact before the deeper risk and hotspot passes begin.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after canonical plan scope, branch alignment, and repository validation are already complete.
- Treat this file as the owner of acceptance-criteria proof mapping for the evidence artifact.

</usage_rules>

<proof_mapping_rules>

- For every acceptance criterion in the canonical plan, identify the current proof source:
  - code path;
  - tests;
  - wrapper/test logs;
  - screenshots/manual proof;
  - or note that the proof is weak/missing.
- Record whether each proof source is direct, indirect, or missing when the later findings and disposition steps will need that distinction explicitly.
- Call out any acceptance criterion whose strongest proof is only indirect so later review steps know that area still needs adversarial pressure.

</proof_mapping_rules>
