# Update Models and Fix Native Review Execution

## Overview

We want CodeInfo2 to use the agreed current model names consistently and to run its native Codex and OpenCode review workflows successfully, with retained evidence proving that both actually executed and completed.

The model mapping is:

| Existing model  | Replacement   |
| --------------- | ------------- |
| `gpt-5.6-sol`   | `gpt-6.1-sol` |
| `gpt-5.6-terra` | `gpt-6.1-sol` |
| `gpt-5.6-luna`  | `gpt-6-luna`  |
| `gpt-6-sol`     | `gpt-6.1-sol` |

The regular and manual-testing agent configurations already use these target names, but older names remain in active defaults, bootstrap templates, the model catalog, the inner native Codex review instructions, documentation and test fixtures. Updating these references will make newly selected defaults and generated configurations consistent. It will not automatically rewrite existing user configurations or model identities saved in conversations and flow resume state.

Both native review workflows are currently blocked in a runtime that exposes terminal tools only through `functions.exec`. Their prompts require direct `exec_command` and `write_stdin` calls while explicitly forbidding the available nested interface. That restriction was introduced to prevent an enclosing JavaScript cell from returning while a native process was still running and losing its process session handle. The repair must support the available interface while retaining the original requirement to preserve the process handle and wait for a numeric process exit status.

Most relevant automated tests use mocked providers, intercepted browser requests or fake executables. They do not need updating because retired model names cannot be called, but tests asserting changed defaults, catalogs, capabilities or review instructions must have their expectations updated. Other obsolete fixture identities should be refreshed as part of the requested cleanup without collapsing scenarios that require distinct models.

This work will update model selection and review execution instructions, preserve deterministic automated coverage, and separately prove both real review workflows. Passing mocked tests, producing an unavailable report or passing a workspace checker does not establish that a native review ran.

## Five-Step Plan

### 1. Update model selection consistently

- Reconfirm the literal inventory before editing and apply the mapping above to active defaults, bootstrap templates, example configurations and the inner native Codex review prompt.
- Cover `server/src/config/chatDefaults.ts`, `codexConfig.ts`, `runtimeConfig.ts` and `codexEnvDefaults.ts`, plus `server/src/routes/chatDiscovery.ts`, agent and command fallbacks, `server/src/flows/service.ts`, `config.toml.example` and `codeinfo_markdown/run_codex_review_workspace.md`.
- Deduplicate the default catalog so it contains `gpt-6.1-sol`, `gpt-6-luna` and the existing `gpt-6-astra`. Preserve explicit configuration overrides and existing reasoning settings where supported.
- Update current documentation. Distinguish superseded historical descriptions from active settings and preserve immutable review evidence rather than rewriting what previously ran.
- Record any remaining obsolete references with their purpose. Do not silently migrate saved conversation identities or existing provider-home configurations.

### 2. Update affected tests and fixtures

- Update expectations for changed defaults, bootstrap output, model catalogs and native Codex launcher arguments.
- Refresh obsolete model names in shared fixtures, temporary provider-home setup, client tests, server tests and browser tests using the agreed mapping.
- Preserve distinct-model scenarios. Where two old identities converge on `gpt-6.1-sol`, revise the fixture and assertions deliberately so switching, selection, deduplication and resume tests continue to exercise their intended behavior.
- Align Sol reasoning expectations with the existing `gpt-6.1-sol` capability handling: `low`, `medium`, `high` and `xhigh`. Do not retain incompatible `minimal` expectations merely by renaming the model.
- Keep ordinary automated tests deterministic and mocked. Real provider execution belongs to the separate workflow proof in step 5.

### 3. Repair both review execution contracts

- Update `codeinfo_markdown/review_job_workspace_contract.md`, `run_codex_review_workspace.md`, `run_open_code_review_workspace.md` and `verify_review_batch_jobs.md` consistently.
- Permit direct terminal tools when exposed, or nested `tools.exec_command` and `tools.write_stdin` through `functions.exec` when that is the available interface.
- Require every nested call to be awaited and its complete result emitted into the conversation. Retain the returned process `session_id` across calls and poll that exact process until its result contains a numeric `exit_code`.
- Keep orchestration-cell completion separate from native-process completion. If an orchestration call itself yields, recover its tool result before deciding whether the native command completed or needs process-session polling.
- Do not relaunch a running review, start a dependent OpenCode command early or treat growing artifacts as final. If continuation is genuinely lost, retain useful partial evidence and report the limitation without claiming a provider failure or successful completion.
- Allow the verifier to accept trustworthy terminal process evidence from either interface. Preserve the existing launchers, model reasoning effort, native command flags, assigned workspace boundaries and exclusions.
- Update the Python prompt-contract tests and Codex/OpenCode flow tests that currently enforce the direct-only prohibition. Align current documentation with the repaired protocol.

### 4. Prove process continuation and run automated validation

- In the agent runtime, use a controlled process held at a deterministic gate so that its first terminal-tool result returns a live session handle before the command is allowed to finish.
- Prove the handle survives across separate orchestration calls, the same session is polled, the command launches exactly once and completion is established by its numeric exit status.
- Cover both successful and nonzero process exits. Verify that a completed JavaScript cell with a still-running process is not classified as native completion or provider failure.
- Exercise the nested interface that caused the original availability problem, and the direct interface where available. State any interface that could not be exercised.
- Run focused checks while iterating, including the updated Python prompt-contract tests and affected client/server tests.
- Run one final full repository validation with `npm run test:summary:all:stress`, plus `npm run lint` and `npm run format:check`. Use repository-supported formatting where needed and rerun affected checks after resulting changes.
- Retain command outcomes and evidence. Passing mocked tests establishes implementation contracts; it does not replace step 5.

### 5. Prove both real review workflows

- Use a fresh, small scheduler-created batch with pinned comparison and reviewed commits, known reviewable changes, and an excluded planning change. Preserve the existing assigned batch and its evidence.
- Execute through the supported Agents workflow with the repaired instructions. Use the repository-supported proof environment and confirm that it exposes the relevant terminal interface; do not restart or stop the protected local development stack.
- Confirm the live instruction files match the repaired source before launching. Use fresh reviewer invocations so earlier direct-only instructions do not remain the operative contract.
- For Codex, verify that the native launcher actually runs with `gpt-6.1-sol`, reaches terminal completion and retains its numeric process exit status, native JSONL evidence and response under the assigned job boundary.
- For OpenCode, verify that `prepare` completes, every reviewable bundle is attempted, and `validate-comments` and `report` execute in dependency order with retained numeric process exit evidence for each command.
- Independently verify the exact commits, exclusions, useful findings, coverage limitations and ownership of the final artifacts. Use the known changes to assess review coverage without equating a no-findings result with successful defect detection.
- Check and reopen the actual output and verification files. A non-empty unavailable report or a passing workspace checker alone is insufficient proof.
- Require both native workflows to execute and complete before claiming this objective achieved. If real execution exposes another issue, diagnose and resolve it within scope, then repeat the affected proof; otherwise record the remaining limitation honestly and leave the objective incomplete.
