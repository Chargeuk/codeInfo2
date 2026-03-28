# Title

Users can re-ingest the repository they are working in, or the full plan scope around it

# Acceptance

1. Workflow users can re-ingest the repository they are currently working in by using a `working` target.
2. Workflow users can re-ingest the current working repository together with the related repositories from the active plan handoff by using a `plan_scope` target.
3. Workflow users can no longer use the older `current` and `all` target names in newly authored commands and flows.
4. Workflow users still can re-ingest one exact repository by using an explicit `sourceId`.
5. Workflow users get clearer outcomes when plan-scope re-ingest finds missing, invalid, duplicated, or failed related repositories, because the run completes with warnings instead of stopping unnecessarily.
6. Support and engineering users can prove the new behavior through wrapper-based server tests, compose-backed runtime checks, logs, and a final manual browser review of the visible proof output.

# Description

This story makes repository re-ingest actions match how people actually work. Instead of using confusing owner-based targets, users will be able to refresh the repository they have selected as their current working folder, or refresh that repository together with the extra repositories listed in the active plan handoff. This is useful because it makes routine refresh actions easier to understand, keeps explicit single-repository control available when needed, and gives clearer warning-based feedback when part of a wider plan scope cannot be refreshed cleanly.

# Tasks

1. [codeInfo2] - Replace the authored re-ingest targets in command and flow schemas.

- Update the schema files in `server/src/agents/` and `server/src/flows/` to allow only `sourceId`, `working`, and `plan_scope`.
- Update the related schema tests in `server/src/test/unit/` so removed targets fail cleanly.

2. [codeInfo2] - Add the shared test fixture for plan-scope handoff scenarios.

- Create the reusable fixture helper under `server/src/test/support/` for working-repository and `current-plan.json` setups.
- Add focused unit coverage in `server/src/test/unit/` so later tasks can rely on the harness safely.

3. [codeInfo2] - Add the helper that resolves plan-scope repository lists.

- Create the resolver in `server/src/ingest/` to read the working repository first and then ordered `additional_repositories`.
- Add unit tests that prove fallback, deduplication, and warning cases in `server/src/test/unit/`.

4. [codeInfo2] - Implement the new `working` and `plan_scope` re-ingest runtime behavior.

- Update the execution path in `server/src/ingest/` so `working` stays single-repository and `plan_scope` runs as an ordered best-effort batch.
- Add runtime and regression coverage in `server/src/test/unit/` for happy paths, skipped repositories, and failed repository warnings.

5. [codeInfo2] - Update the re-ingest message and persistence contract.

- Extend the server chat lifecycle files in `server/src/chat/` so `plan_scope` results and warnings are recorded correctly.
- Update tests covering tool-result and persistence behavior in `server/src/test/unit/`.

6. [codeInfo2] - Wire direct-command re-ingest to the new runtime contract.

- Update the direct command runner in `server/src/agents/` and add checked-in proof commands under `codex_agents/tasking_agent/commands/`.
- Add command-runner coverage in `server/src/test/unit/` so `working` and `plan_scope` are both exercised.

7. [codeInfo2] - Wire flow re-ingest paths to the new runtime contract.

- Update the flow execution files in `server/src/flows/` and `server/src/agents/` so top-level flow steps and flow-owned command items use the new targets.
- Add flow integration coverage in `server/src/test/` for flow happy paths, warnings, and regressions.

8. [codeInfo2] - Prove the working-folder and compose-mounted runtime path.

- Update the environment-sensitive runtime proof in `server/src/ingest/` and compose-related files at the repository root.
- Add repeatable compose-backed proof steps that show the server can read the working repository handoff through the supported mounted runtime.

9. [codeInfo2] - Run final validation and close out the story documentation.

- Re-check the completed behavior against acceptance, update final docs such as `docs/developer-reference.md`, and record any intentional no-change decisions.
- Run the final wrapper-based proof path and the manual `/logs` browser review so the whole story is validated end to end.
