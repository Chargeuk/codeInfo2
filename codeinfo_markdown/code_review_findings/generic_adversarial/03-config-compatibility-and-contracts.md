# Goal

Run the config-domain, compatibility, and contract-surface findings pass for changed non-support implementation files.

<review_rules>

- In the second pass, prioritize:
  - env/config parsers that accept empty-string, whitespace, zero, negative, or oversized values even though downstream code assumes a smaller safe domain;
  - duplicate or conflicting object keys/payload fields.
- For changed env/config parsers, verify that empty-string and whitespace-only inputs are either treated as unset, clamped safely, or rejected, rather than silently coerced into dangerous values.
- For changed numeric env/config inputs, verify that the parser enforces the domain the downstream code assumes, including lower bounds, upper bounds, and closed or half-open intervals such as `(0, 1]`.
- Raise a finding when downstream code assumes a constrained config domain but the parser accepts a wider range that can produce invalid limits, oversize requests, disabled guards, negative sizes, or pathological performance.
- For every changed API route, config shape, persisted artifact, wrapper output, or shared log marker/event schema outside the allowed support-file set, perform a before/after contract comparison and state whether the change is backward compatible, intentionally breaking, or unclear.
- For any changed normalization, alias-migration, or backward-compatibility helper outside the allowed support-file set, compare old vs new behavior for mixed-shape inputs where legacy and canonical fields partially coexist. Flag regressions where a guard changed from checking whether the canonical field exists to checking only whether the parent object exists, or any similar narrowing that makes previously accepted configs stop working.
- If the same log marker, event name, or response field is emitted from more than one code path outside the allowed support-file set, compare the emitted schema and value vocabulary across those emitters and flag mismatches that would make downstream parsing, analytics, or operational debugging ambiguous.
- For fallback-selection logic outside the allowed support-file set, verify that precedence still matches the canonical plan and does not override explicit user intent.
- Before raising a finding about bootstrap, existence checks, invalid-path handling, config-domain enforcement, scale-bounded query construction, stale-hint precedence, or shared-registration cleanup in the non-support-file changes, compare the implementation against the story's explicit edge cases or failure-mode contract and do not raise a finding solely because the code differs from a generic best practice if it matches the canonical plan's stated contract.

</review_rules>
