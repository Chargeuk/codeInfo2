# Goal

Run the non-test focused blind-spot challenges that do not naturally belong to a single seam-specific audit.

<step_rules>

1. Inspect one additional changed non-helper file, if present, for a low-risk consistency or portability defect that would not naturally appear in the risk matrix. Prefer changed `README.md` or `docs/**` links, duplicated literals that should reuse a nearby canonical constant, changed test-support mocks that accept cancellation inputs, or tracked local/runtime artifact files that should not have been committed.
2. For one changed orchestration function, attempt a focused failure-ordering challenge: assume the external provider, model bootstrap, or dispatcher setup fails before any real work begins, and verify whether a no-op, metadata-only, delete-only, or zero-work fast path would still complete correctly. Prefer paths where the existing tests prove terminal status semantics but do not explicitly prove behavior under provider or bootstrap failure.
3. For one changed queued, deferred, promoted, resumed, or startup-recovered execution path, attempt an admission-vs-execution challenge: assume validation passed when the request was first accepted, then verify whether the same critical preconditions are still enforced when the work actually starts.
4. For one changed producer-consumer error path, attempt a wrapped-error mismatch challenge: assume the lower layer now emits a normalized or provider-specific error instead of the old raw SDK error shape, and verify whether the caller still reaches the correct cancel, retry, ignore, or terminal branch.

</step_rules>
