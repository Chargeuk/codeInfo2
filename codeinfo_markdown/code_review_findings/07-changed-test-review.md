# Goal

Apply the findings-phase test review rules to changed tests used as proof or changed alongside the implementation.

<review_rules>

- For changed tests, treat test code with the same review rigor as production code.
- Do not accept a changed test as sufficient proof of correctness until you have also checked:
  - isolation;
  - shared-state safety;
  - project membership;
  - worker-safety;
  - teardown behavior;
  - interaction with other suites;
  - whether the test title or description still matches the invariant that its assertions actually prove.
- When a changed test proves that something has not happened yet, prefer a deterministic scheduler, resource, or state boundary over an arbitrary elapsed-time sleep.
- Raise a weak-proof concern or finding when a fixed-delay negative assertion is used even though the code under test exposes a stronger observable boundary.
- Pay special attention to changed mocks or test helpers that accept `AbortSignal`, cancellation flags, or timeout controls but never inspect already-aborted or already-cancelled state at construction time.

</review_rules>
