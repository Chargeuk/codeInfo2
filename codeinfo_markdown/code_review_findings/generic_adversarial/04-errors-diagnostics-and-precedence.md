# Goal

Run the findings pass for error-shape, diagnostics, and stale-precedence issues in changed non-support implementation files.

<review_rules>

- In the second pass, prioritize:
  - warnings/errors/reason values produced by helpers but dropped by callers;
  - raw-to-wrapped error translation mismatches where a lower layer now normalizes or wraps errors but a caller still branches on the old raw error shape;
  - stale persisted hints, cached values, or collection-level metadata that can override fresher values observed during the current run because precedence rules are too broad.
- For any changed function outside the allowed support-file set that returns warnings/errors/reason metadata or otherwise mixes data with diagnostics, trace each changed caller and state whether those diagnostics are surfaced to clients, logged, or intentionally dropped. If dropped, decide whether that is an intentional contract choice or a defect.
- For any changed error-mapping, normalization, retry, or provider wrapper helper outside the allowed support-file set, inspect all changed callers that branch on raw error names, raw SDK classes, provider-specific error codes, retryability, or cancel-vs-terminal semantics. Raise a finding when the producer now emits a wrapped or normalized error shape but the consumer still expects the old raw shape.
- For changed fallback-selection or precedence helpers, explicitly compare stale persisted hints or cached values against fresher values observed during the current execution. Raise a finding when the helper prefers the stale hint even after the current run has learned a more authoritative value.
- For partial-failure logic outside the allowed support-file set, verify what happens when only part of the resolution succeeds and whether the resulting behavior is explicit, safe, and observable.
- Look for new fields that are written but never read, branches that cannot be reached under the current contract, and diagnostics that are intentionally hidden from clients without an actionable log trail in the non-support-file changes.

</review_rules>
