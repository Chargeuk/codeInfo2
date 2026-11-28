# Repository-Owned Test Stack Lifecycle

Use this contract whenever an agent starts, reuses, stops, repairs, or classifies a Docker or Compose stack for a testing or proof step.

The stack lifecycle belongs to the repository testing workflow, not to the individual agent or flow step that happened to start the containers. Do not require per-agent ownership files, launch tokens, leases, or handoff records.

## Repository And Testing Scope

A running stack may be stopped only when current repository evidence establishes both of these conclusions:

1. the stack belongs to a repository that the calling prompt currently permits the agent to test; and
2. the stack is a documented test or proof stack for the selected target repository, and either is needed by the current step or is eligible for normal late-flow cleanup.

Use the calling prompt's repository scope. Automated proof normally uses the persisted plan repositories. Manual proof may also use a supporting repository when its prompt permits that repository for honest proof.

Do not stop unrelated services merely because they use a desired port.

## Ownership Evidence

Determine ownership from the best current evidence available rather than requiring one exact metadata shape. Useful evidence includes:

- the repository's documented startup and shutdown wrappers;
- the Compose file or project resolved by those wrappers;
- `docker compose ps` run through the repository-supported Compose path;
- Docker Compose project, config-file, working-directory, and service labels or metadata;
- and current repository runtime guidance.

Container names, project names, or occupied ports may support the decision, but none of them alone proves repository ownership. An occupied port by itself is never authority to stop a container.

If the available evidence does not establish repository ownership and one of those applicable lifecycle purposes, do not stop the stack. Report the remaining conflict honestly.

## Reclaim Rules

When a pre-existing, stale, freshness-unknown, or conflicting stack is proven to be the repository-owned test stack required by the current proof, it may be reclaimed regardless of which agent started it:

1. record that the stack is being reclaimed;
2. stop the exact verified project and configuration with the repository's shutdown path, preserving volumes and other persistent data; if the standard wrapper removes volumes, use a verified volume-preserving Compose stop path rather than that destructive teardown;
3. restart it with the documented startup workflow when the current proof requires a running stack;
4. retry the affected proof step; and
5. record the resulting lifecycle and proof outcome.

Do not classify it as external or human-owned solely because the current agent did not start it. Explicitly verified disposable test-only runtime state may be stopped and recreated under the documented test lifecycle; removing its containers may discard writable-layer data. Mounted uploads, named or external volumes, persistent or human data, and active users remain protected. If the disposable classification, protected-data boundary, or active use is uncertain, do not stop the stack; report the specific uncertainty.

Do not interrupt the same healthy stack between an already-completed startup item and its later test and shutdown items merely because it is now running. Reclaim it only when it predates the current lifecycle, is stale or freshness-unknown, conflicts with the required startup step, or must be restarted after relevant changes.

Reconcile a stale manifest or receipt only when its identity and staleness are verified, and only after safe shutdown; do not guess the target or change a human-selected offset. This lets a later preparation proceed without treating stale bookkeeping as live ownership.

## Normal Late-Flow Cleanup

Only the parent-designated late flow step after native review owns normal all-stack cleanup. A per-task, whole-story, or parallel PR proof subflow must not independently initiate global late cleanup. The parent-designated cleanup owner waits until all active work that can use the selected target repository's test/proof stacks has reached a terminal result, then stops **all** verified test/proof stacks belonging to that selected target repository, including stacks not needed by another test. This is ordinary lifecycle cleanup, not cancellation handling. Before stopping each stack, check current active owners and verify the repository root/worktree, Compose project, config-file and working-directory metadata, and any human-selected port offset. Preserve the selected offset; do not switch ports or infer ownership from a port or container name. Do not stop a stack while an active owner still needs it.

Use the selected target repository's verified shutdown path for the exact project and configuration. Preserve persistent data: do not pass volume-removal options, remove named or external volumes, or delete uploads or bind-mounted data. A standard teardown that removes volumes is not suitable; use a verified exact-project/configuration volume-preserving stop path. Uncertainty about writable-layer data does not block stopping explicitly verified disposable test-only runtime state; if the disposable classification, protected-data boundary, or active use is uncertain, leave the stack intact and report the exact unresolved action. Do not guess the target, substitute another repository's commands, or change the human-selected offset.

The protected `compose:local` / `*-local` live development stack remains excluded unless the user explicitly authorizes stopping it. Preserve unrelated repositories' stacks and all human-selected offsets. Cancellation follows the caller's existing cancellation and ownership rules; this section adds no cancellation or cancellation-leak behavior. On cancellation, do not perform this normal late-flow all-stack cleanup unless the cancellation flow independently authorizes it.

## Protected And Uncertain Stacks

Never stop or restart:

- `compose:local`, a `*-local` Compose project, or `*-local` containers when repository guidance protects the local development stack;
- a stack owned by another repository or worktree;
- a stack unrelated to the selected target repository's test/proof lifecycle, including during normal late-flow cleanup;
- or a stack whose ownership remains uncertain.

An explicit user instruction may override a protected local-stack rule. A normal testing requirement does not.

If a port conflict is caused by an unidentified or protected stack, preserve it and report the exact evidence needed to continue. Do not guess, change the tested port contract, or substitute a narrower runtime solely to avoid the conflict.

## Blocker Classification

A proven repository-owned test stack that can be stopped through its documented workflow is recoverable test environment state, not an external dependency, human-owned runtime blocker, or reason to stop the flow.

Attempt the supported reclaim-and-retry path before writing or preserving a live blocker. A blocker is appropriate only when ownership cannot be established, the stack is protected, supported cleanup fails after credible bounded attempts, or another genuine stopping condition from the calling prompt remains.
