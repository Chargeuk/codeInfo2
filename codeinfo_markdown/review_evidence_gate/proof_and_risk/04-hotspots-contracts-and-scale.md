# Goal

Capture contract-surface, compatibility, and scale-shape hotspots for the evidence artifact.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after the lifecycle hotspot pass.
- Treat this file as the owner of contract, compatibility, and scale hotspot capture.

</usage_rules>

<hotspot_rules>

- For each changed file or helper outside the allowed spelling/grammar-only support-file set, record any review hotspot involving:
  - shared log markers or shared response fields;
  - query builders, delete filters, or bulk selectors whose size grows with repository, file, chunk, or symbol count, especially `$or`, `$in`, `$nin`, and per-file delete payloads;
  - fallback-selection logic;
  - duplicate/conflicting object keys;
  - UI enable/disable/visibility or mode-gating logic versus the payload, persistence, or submission path it is supposed to control;
  - any alias-migration or backward-compatibility helper where legacy and canonical fields can partially coexist in mixed-shape configs.
- Identify any changed external contract surfaces outside the allowed spelling/grammar-only support-file set that need explicit before/after comparison in findings:
  - API routes;
  - config file shapes;
  - persisted artifacts;
  - wrapper outputs;
  - log marker/event schemas;
  - legacy alias/deprecated-input compatibility where old and new field shapes may coexist.
- Note where backward-compatibility risk exists and where the canonical plan explicitly permits an edge-case deviation from generic best practice.
- For each changed env/config parser, record the value domain the downstream code expects, including empty-string or whitespace behavior, lower and upper bounds, and whether invalid values must clamp, fallback, or fail.
- For each changed query/filter/bulk selector that scales with repository, file, chunk, or symbol count, record the growth dimension, whether the implementation batches or bounds request size, and whether the active story explicitly targets large-repository or large-file behavior.

</hotspot_rules>
