# Goal

Research and record the best supported startup and shutdown paths for manual proof in every repository and surface that may be relevant to this flow.

<task>

Read the stored current-plan handoff and determine the repositories in scope for this flow.
For each relevant repository, research the best supported way to start and stop runnable systems for later manual proof.
Prefer Docker or Compose wrapper workflows first.
If no supported Docker or Compose path exists, prefer local wrapper or script workflows over direct raw commands.
Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence.
Write the results to `codeInfoStatus/flow-state/manual-testing-runtime.json`.
Do not commit that file in this step.
Treat it as a live local runtime-research artifact rather than durable tracked repository state.

</task>

<input_scope>

Read `codeInfoStatus/flow-state/current-plan.json` first.
Read `codeInfoStatus/flow-state/current-task.json` after `current-plan.json`.
Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
Treat the current repository as always in scope even if it is not listed in `additional_repositories`.
Resolve the same bound task that the loop is preparing to manual-test from `current-task.json` when possible.

</input_scope>

<bound_task_guidance_rules>

- If the bound task can be resolved and it has a `Manual Testing Guidance` section, read that section before finishing this runtime-research pass.
- Use the bound task's `Manual Testing Guidance` as task-specific input for startup order, prerequisite services, target proof surfaces, credential-source pointers, and expected manual-proof artifact destinations.
- Treat task guidance as a task-scoped overlay on top of repository evidence, not as permission to invent unsupported startup paths or variants.
- If the bound task's `Manual Testing Guidance` conflicts with `AGENTS.md`, `README.md`, `codeinfo_markdown/repository_information.md`, or fresher repository evidence, prefer the repository evidence and record the conflict honestly in the runtime research output instead of silently following or ignoring the task guidance.
- If the bound task has no `Manual Testing Guidance`, or it is incomplete for the current proof surface, continue with the best supported repository evidence rather than guessing.

</bound_task_guidance_rules>

<source_priority>

For each repository in scope, gather runtime evidence in this order:

1. `AGENTS.md`
2. `README.md`
3. `codeinfo_markdown/repository_information.md` if it exists
4. repository-native runtime and wrapper files such as:
   - `package.json`
   - `docker-compose*`
   - Dockerfiles
   - Makefiles
   - justfiles
   - language-specific task runners or script manifests
   - CI workflow files if needed to confirm supported wrappers

Use repository evidence first.
Do not guess from memory.
Do not use `code_info` for this step unless repository evidence is still genuinely ambiguous after direct inspection.
If `AGENTS.md` does not define wrapper guidance for a repository, prefer the highest-level safe command discoverable from repository evidence rather than low-level direct commands.
Assume the full normal system should be used for manual proof unless `AGENTS.md`, `README.md`, or `codeinfo_markdown/repository_information.md` explicitly indicates that a specific supported variant, seeded mode, login-helper mode, alternate startup path, or test-support runtime should be preferred instead.

</source_priority>

<runtime_policy>

For each runnable surface, determine the best available proof path using this preference order:

1. Docker or Compose wrapper path supported by repository evidence
2. Local wrapper or script path supported by repository evidence
3. Not currently available

Prefer exposed scripts and wrappers over low-level direct commands.
Starting with Docker or Compose is always preferred over starting locally.
Starting locally is acceptable only when no supported Docker or Compose path exists yet.
If neither a supported Docker or Compose path nor a supported local wrapper path exists, record the surface as unavailable rather than inventing a startup path.
Choose the startup path that follows the repository's normal launcher, wrapper, startup path, or selector flow rather than a narrow one-off route when repository evidence provides more than one option.

</runtime_policy>

<surface_rules>

For each repository, identify the relevant surfaces when they exist, such as:

- frontend or browser-accessible UI
- API or HTTP service
- worker or background service
- compose stack or multi-service runtime
- any connected or paired frontend where a backend change would actually be observed

A repository may have zero, one, or many surfaces.
If a repository is not directly runnable, record that clearly.

</surface_rules>

<availability_rules>

For each surface, classify availability as one of:

- `available_now`
- `available_via_fallback`
- `not_yet_available`

Use `available_now` when the preferred Docker or Compose path is supported and runnable from current repository evidence.
Use `available_via_fallback` when Docker or Compose is not supported but a local wrapper or script path is supported.
Use `not_yet_available` when the story appears to depend on a runnable surface, harness, or startup path that does not yet exist in the repository state.

If a path is `not_yet_available`, explain why.
If repository evidence suggests later tasks in the active plan are expected to create or repair that runtime or harness, record that as a likely future enabler instead of treating the absence as a permanent failure.

</availability_rules>

<credential_source_rules>

- If a runnable proof surface requires credentials, seeded accounts, login helpers, tokens, or other access material, record only the supported source of that access.
- Never write actual usernames, passwords, tokens, API keys, or other credential values into `codeInfoStatus/flow-state/manual-testing-runtime.json`.
- This rule applies even when a credential appears to be non-secret, public, seeded, or intended only for test use.
- Record only where the `manual_testing_agent` should look, such as:
  - env var names;
  - env file paths;
  - README sections;
  - helper scripts;
  - seed or fixture files;
  - repository-documented login helpers.
- If the supported credential source cannot be discovered from repository evidence, record that honestly instead of guessing.

</credential_source_rules>

<dependency_checks>

For every recorded startup path, identify:

- the exact source file that justified it
- the startup command
- the shutdown command
- the system variant or mode to use for manual proof, using the full normal system by default unless repository evidence says otherwise
- prerequisites that must already exist
- whether the path depends on build outputs, generated files, environment setup, or harness work that may not exist yet
- whether access requires credentials, a seeded identity, a login helper, or other access material
- where that access comes from, such as env vars, env files, README guidance, helper scripts, or seed data
- do not inline the actual credential or access values; record only the source
- whether the path is for the edited repository itself or for a connected or paired proof surface
- whether bound-task `Manual Testing Guidance` was consulted
- what startup, access, proof-surface, or artifact-destination directions came from that bound task guidance
- whether any part of the bound task guidance was ignored because it conflicted with fresher repository evidence

If the best supported proof surface for a task would actually live in a connected repository, record that linked proof surface explicitly.

</dependency_checks>

<freshness_guidance_rules>

For each repository or surface, record any supported freshness guidance that later manual testing can use to decide whether an already-running stack may be reused honestly.

When repository evidence supports it, capture:

- whether a running stack may ever be reused safely for manual proof
- which categories of changes require restart-by-default, such as:
  - server code
  - client code
  - compose or runtime configuration
  - environment wiring
  - startup or shutdown behavior
  - or other runtime-loaded code paths
- any supported marker, command, or observable signal that can prove the running stack is current
- whether rebuild or restart is required after relevant code changes even when a stack is already up

If repository evidence does not provide a trustworthy freshness marker, record that reuse is not safely provable from current evidence rather than guessing.

</freshness_guidance_rules>

<file_contract>

Create or update `codeInfoStatus/flow-state/manual-testing-runtime.json` with this canonical structure:

```json
{
  "plan_path": "<relative plan path from current-plan.json>",
  "repositories": [
    {
      "path": "/abs/path/to/repo",
      "surfaces": [
        {
          "name": "frontend",
          "availability": "available_now",
          "preferred_mode": "docker",
          "startup": {
            "command": "npm run compose:up",
            "source": "AGENTS.md"
          },
          "shutdown": {
            "command": "npm run compose:down",
            "source": "AGENTS.md"
          },
          "freshness": {
            "reuse_allowed": false,
            "restart_required_for": ["server code changes"],
            "proof": "No supported freshness marker documented; restart unless a later repository-supported proof is added."
          },
          "access": {
            "required": true,
            "kind": "seeded_account",
            "source": "README.md -> Local Login",
            "locator": ".env file / seeded account helper",
            "notes": "Use the repository-documented seeded account source; never store credential values here."
          },
          "prerequisites": ["docker running"],
          "notes": "Use the paired frontend for browser proof.",
          "task_guidance": {
            "consulted": true,
            "artifact_destination": "codeinfoTmp/manual-testing/0000059/",
            "notes": "Bound task Manual Testing Guidance requested frontend proof through the paired UI and non-final-task scratch artifact storage."
          }
        }
      ]
    }
  ]
}
```

You may extend this shape if needed, but keep it concise and deterministic.
Do not omit the evidence source for startup and shutdown commands.
Do not write commands that are not supported by repository evidence.
Do not write actual credential values into this file; only source pointers are allowed.

Mini-example:

- Bad: `"username": "test-admin@example.com", "password": "secret123"`
- Good: `"access": { "required": true, "source": "README.md -> Local Login", "locator": ".env file / seeded account helper", "notes": "Use the documented source; do not store values here." }`

</file_contract>

<verification_loop>

Before finishing:

- confirm every repository in scope was inspected
- confirm every runnable or proof-relevant surface was classified
- confirm Docker or Compose was preferred over local when supported
- confirm no startup or shutdown command was invented
- confirm unavailable paths were recorded as unavailable instead of guessed
- confirm the file reflects the current repository state, not a hoped-for future state
- confirm likely future runtime or harness changes from later plan tasks are noted when relevant
- confirm freshness or restart-by-default guidance was recorded when repository evidence supported it
- confirm any unsupported freshness assumptions were recorded as unprovable rather than guessed
- confirm no actual credential values were written into the runtime research file
- confirm any required access information was recorded only as a source pointer
- confirm undiscoverable credential sources were recorded as unknown rather than guessed
- confirm bound-task `Manual Testing Guidance` was consulted when present
- confirm any task-guidance conflict with fresher repository evidence was recorded honestly rather than silently followed or ignored

</verification_loop>

<output_contract>

Return a concise summary that includes:

1. which repositories were inspected
2. which surfaces are `available_now`
3. which surfaces require local fallback
4. which surfaces are `not_yet_available`
5. whether any connected or paired proof surfaces must be used later
6. whether bound-task `Manual Testing Guidance` added any startup, access, or artifact-destination constraints

Do not perform manual testing in this step.
Do not start or stop systems in this step.
Do not commit changes in this step.

</output_contract>
