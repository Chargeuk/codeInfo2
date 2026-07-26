# Repository-Owned Test Stack Lifecycle

Use this contract whenever an agent starts, reuses, stops, repairs, or classifies a Docker or Compose stack for a testing or proof step.

The stack lifecycle belongs to the repository testing workflow, not to the individual agent or flow step that happened to start the containers. Do not require per-agent ownership files, launch tokens, leases, or handoff records.

## Repository And Testing Scope

A running stack is reclaimable only when current repository evidence supports both of these conclusions:

1. the stack belongs to a repository that the calling prompt currently permits the agent to test; and
2. the stack is the documented test or proof stack needed by the current testing or proof step.

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

If the available evidence does not establish both repository ownership and testing applicability, do not stop the stack. Report the remaining conflict honestly.

## Reclaim Rules

When a pre-existing, stale, freshness-unknown, or conflicting stack is proven to be the repository-owned test stack required by the current proof:

1. record that the stack is being reclaimed;
2. stop it with the repository's documented shutdown wrapper;
3. restart it with the documented startup workflow when the current proof requires a running stack;
4. retry the affected proof step; and
5. record the resulting lifecycle and proof outcome.

It does not matter which earlier agent or flow step started that repository-owned test stack. Do not classify it as external or human-owned solely because the current agent did not start it.

Do not interrupt the same healthy stack between an already-completed startup item and its later test and shutdown items merely because it is now running. Reclaim it only when it predates the current lifecycle, is stale or freshness-unknown, conflicts with the required startup step, or must be restarted after relevant changes.

Use repository wrappers instead of directly removing containers whenever a supported wrapper exists.

## Protected And Uncertain Stacks

Never stop or restart:

- `compose:local`, a `*-local` Compose project, or `*-local` containers when repository guidance protects the local development stack;
- a stack owned by another repository or worktree;
- a stack that is unrelated to the current testing or proof step;
- or a stack whose ownership remains uncertain.

An explicit user instruction may override a protected local-stack rule. A normal testing requirement does not.

If a port conflict is caused by an unidentified or protected stack, preserve it and report the exact evidence needed to continue. Do not guess, change the tested port contract, or substitute a narrower runtime solely to avoid the conflict.

## Blocker Classification

A proven repository-owned test stack that can be stopped through its documented workflow is recoverable test environment state, not an external dependency, human-owned runtime blocker, or reason to stop the flow.

Attempt the supported reclaim-and-retry path before writing or preserving a live blocker. A blocker is appropriate only when ownership cannot be established, the stack is protected, supported cleanup fails after credible bounded attempts, or another genuine stopping condition from the calling prompt remains.
