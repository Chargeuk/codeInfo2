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
Use the stored `plan_path` and `additional_repositories` as the starting repository scope for this flow.
Treat the current repository as always in scope even if it is not listed in `additional_repositories`.
When honest manual proof requires another repository, you may inspect and research that supporting repository even if it was not declared in `additional_repositories`.
Resolve the same bound task that the loop is preparing to manual-test from `current-task.json` when possible.
After resolving the bound task number when possible, run `python3 "$CODEINFO_ROOT/scripts/manual_testing_guidance_status.py" --task-number <that-number>`.
If the bound task number cannot be resolved, run `python3 "$CODEINFO_ROOT/scripts/manual_testing_guidance_status.py"` without `--task-number`.
Use that JSON output as the source of truth for whether story-level and task-level manual-testing guidance are present in the active plan.

</input_scope>

<story_and_task_guidance_rules>

- If the guidance-status script reports story-level `Story Manual Testing Guidance`, read and summarize it before finishing this runtime-research pass.
- If the guidance-status script reports a bound task `Manual Testing Guidance` section, read and summarize it before finishing this runtime-research pass.
- Treat story-level guidance as optional story-scoped defaults for later manual proof, such as shared startup order, shared proof surfaces, shared access notes, or shared artifact expectations.
- Treat task-level guidance as a task-scoped overlay that may refine or override story-level guidance for the selected task.
- Apply guidance in this precedence order:
  1. repository truth and safety from `AGENTS.md`, `README.md`, `codeinfo_markdown/repository_information.md`, and fresher repository evidence;
  2. task-level `Manual Testing Guidance`;
  3. story-level `Story Manual Testing Guidance`;
  4. no invention beyond those sources.
- If story-level guidance is absent, continue normally and record that it was not present rather than treating that as a blocker.
- If task-level guidance is absent, continue with the best supported repository evidence plus any story-level guidance rather than guessing.
- If task-level guidance overrides story-level guidance for the same decision area, record the override honestly in the runtime research output instead of silently merging contradictory directions.
- If either story-level or task-level guidance conflicts with fresher repository evidence, prefer the repository evidence and record the conflict honestly in the runtime research output instead of silently following or ignoring the guidance.

</story_and_task_guidance_rules>

<supporting_repository_rules>

- Manual-proof scope is broader than implementation scope.
- If story-level or task-level manual-testing guidance names a paired frontend, companion backend, shared worker, or other supporting repository, treat that as a strong lead for runtime research.
- If repository evidence shows the real proof surface lives in another local repository, you may inspect and research that repository even when it is outside the story's declared working repositories.
- Do not treat the need for a supporting repository as a blocker by itself.
- Only stop when the required supporting repository cannot be located, cannot be read, or has no honest supported startup path.

</supporting_repository_rules>

<source_priority>

For each repository in scope, including any supporting repositories discovered during this research pass, gather runtime evidence in this order:

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
- whether story-level `Story Manual Testing Guidance` was consulted
- what startup, access, proof-surface, or artifact-destination directions came from that story-level guidance
- whether bound-task `Manual Testing Guidance` was consulted
- what startup, access, proof-surface, or artifact-destination directions came from that bound task guidance
- whether any task-level direction overrode story-level guidance for the same decision area
- whether any part of the story-level or task-level guidance was ignored because it conflicted with fresher repository evidence

If the best supported proof surface for a task would actually live in a connected repository, record that linked proof surface explicitly.
When browser proof may use Playwright MCP, also record the artifact-transfer path:

- `CODEINFO_ROOT` is the harness repository root, not the target repository root
- the target artifact repository root that owns the active `plan_path`
- how that target artifact repository root was resolved, such as the active working repository path or `git rev-parse --show-toplevel` from the directory containing `plan_path`
- the intended target artifact destination relative to that target repository
- the Playwright MCP output root inside the Playwright runtime, normally `/tmp/playwright-output`
- whether the harness repo exposes that output as `$CODEINFO_ROOT/playwright-output-local`
- the supported copy-out fallback when no host bind mount exposes the output, such as copying from the documented `playwright-mcp` container for the Compose file in use
- do not claim Playwright MCP can write directly to the target repository unless repository/runtime evidence proves that exact write path exists

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

When the bound task number is known from `current-task.json`, write task-level scratch manual-proof destinations using `codeInfoTmp/manual-testing/<story-number>/<task-number>/`.
When it is helpful to describe later story-closeout curation, also record the durable promotion target `codeInfoStatus/manual-proof/<story-number>/`.

Create or update `codeInfoStatus/flow-state/manual-testing-runtime.json` with this canonical structure:

```json
{
  "plan_path": "<relative plan path from current-plan.json>",
  "proof_scope": {
    "current_repository": "/abs/path/to/current-repo",
    "declared_additional_repositories": [],
    "supporting_repositories": [
      {
        "path": "/abs/path/to/paired-frontend",
        "reason": "Browser proof for this backend task lives here.",
        "source": "manual-testing guidance and repository evidence"
      }
    ]
  },
  "story_guidance": {
    "present": true,
    "section_name": "Story Manual Testing Guidance",
    "summary": ["Use the normal compose stack for shared manual proof."],
    "notes": "Optional story-scoped defaults for later manual proof."
  },
  "task_guidance": {
    "task_number": 7,
    "present": true,
    "section_name": "Manual Testing Guidance",
    "summary": ["Capture the paired frontend queue row after submit."],
    "notes": "Task-scoped guidance may refine or override story guidance."
  },
  "guidance_resolution": {
    "precedence": "repository_truth > task_guidance > story_guidance > no_invention",
    "task_overrides_story": [
      {
        "area": "proof_surface",
        "story_direction": "generic frontend smoke",
        "task_direction": "paired frontend queue-row proof"
      }
    ]
  },
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
          "story_guidance": {
            "consulted": true,
            "notes": "Story guidance preferred the normal compose-backed manual-proof path."
          },
          "task_guidance": {
            "consulted": true,
            "artifact_destination": "codeInfoTmp/manual-testing/0000059/7/",
            "notes": "Bound task Manual Testing Guidance requested frontend proof through the paired UI and task-scoped scratch artifact storage."
          },
          "artifacts": {
            "target_repository_root": "/abs/path/to/repo-that-owns-plan",
            "target_destination": "codeInfoTmp/manual-testing/0000059/7/",
            "curated_story_destination": "codeInfoStatus/manual-proof/0000059/",
            "playwright_mcp_output_root": "/tmp/playwright-output",
            "harness_playwright_output_bind": "$CODEINFO_ROOT/playwright-output-local",
            "copy_out": "Capture with a relative Playwright MCP filename, then copy from the harness output bind when present or from the documented playwright-mcp container output path into the target destination."
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
- confirm story-level `Story Manual Testing Guidance` was consulted when present
- confirm bound-task `Manual Testing Guidance` was consulted when present
- confirm any task-overrides-story decision was recorded honestly rather than silently merged
- confirm any story-guidance or task-guidance conflict with fresher repository evidence was recorded honestly rather than silently followed or ignored
- confirm Playwright MCP artifact handling distinguishes the harness root from the target repository root
- confirm browser-proof artifacts have a supported transfer path from `/tmp/playwright-output` or its harness bind into the target repository destination

</verification_loop>

<output_contract>

Return a concise summary that includes:

1. which repositories were inspected
2. which surfaces are `available_now`
3. which surfaces require local fallback
4. which surfaces are `not_yet_available`
5. whether any connected or paired proof surfaces must be used later
6. whether story-level guidance was present and what defaults it added, if any
7. whether bound-task `Manual Testing Guidance` added any startup, access, or artifact-destination constraints
8. whether task-level guidance overrode any story-level direction
9. which supporting repositories outside the current repository and declared additional repository list were researched for manual proof, if any

Do not perform manual testing in this step.
Do not start or stop systems in this step.
Do not commit changes in this step.

</output_contract>
