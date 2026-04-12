# Goal

Run the validation and deferred-execution findings pass for changed non-support implementation files.

<review_rules>

- In the second pass, prioritize:
  - validations that happen at request admission, queue admission, or request preparation time but are not revalidated when deferred, promoted, retried, resumed, or startup-recovered work actually executes;
  - invalid input being silently normalized into success;
  - logic that hides misconfiguration by falling back too early;
  - fast paths that are supposed to be provider-free but still depend on fallback helpers that can call the provider or network indirectly.
- For any changed queued, promoted, retried, resumed, or startup-recovered execution path, compare it directly against the immediate execution path and raise a finding when model-lock checks, allowlist checks, invalid-state checks, authorization checks, or equivalent preconditions are enforced on one path but skipped on another.
- For every changed helper that merges, normalizes, or defaults config/runtime/user input before validation outside the allowed support-file set, verify that malformed input is not silently dropped, coerced into `{}`, or replaced by inherited defaults before validation can reject it. Also check whether validation was deleted, moved later, or made conditional in a way that weakens the previous contract.
- For every changed orchestration path with a no-op, metadata-only, delete-only, or zero-work fast return, verify that external dependency setup such as model lookup, provider client creation, dispatcher creation, lock acquisition, or network/bootstrap probes happens only after the code proves that real work still exists, unless the canonical plan explicitly requires that dependency for the fast path.
- If a fast path is meant to complete without embedding work, compare every helper it calls against that contract and raise a finding when a fallback helper can still reach the provider, network, or runtime dependency indirectly.
- Treat terminal-state tests for fast paths as incomplete proof unless at least one test or direct code inspection also proves behavior when the external provider or bootstrap dependency is unavailable.

</review_rules>
