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

</task>

<input_scope>

Read `codeInfoStatus/flow-state/current-plan.json` first.
Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
Treat the current repository as always in scope even if it is not listed in `additional_repositories`.

</input_scope>

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

<dependency_checks>

For every recorded startup path, identify:

- the exact source file that justified it
- the startup command
- the shutdown command
- prerequisites that must already exist
- whether the path depends on build outputs, generated files, environment setup, or harness work that may not exist yet
- whether the path is for the edited repository itself or for a connected or paired proof surface

If the best supported proof surface for a task would actually live in a connected repository, record that linked proof surface explicitly.

</dependency_checks>

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
          "prerequisites": [
            "docker running"
          ],
          "notes": "Use the paired frontend for browser proof."
        }
      ]
    }
  ]
}
```

You may extend this shape if needed, but keep it concise and deterministic.
Do not omit the evidence source for startup and shutdown commands.
Do not write commands that are not supported by repository evidence.

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

</verification_loop>

<output_contract>

Return a concise summary that includes:

1. which repositories were inspected
2. which surfaces are `available_now`
3. which surfaces require local fallback
4. which surfaces are `not_yet_available`
5. whether any connected or paired proof surfaces must be used later

Do not perform manual testing in this step.
Do not start or stop systems in this step.
Do not commit changes in this step.

</output_contract>
