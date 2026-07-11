# Agent Workflow Guide

## Purpose

Use this file as the repository-specific operating guide for agents working in this repo.
Keep the same behavior and standards described here even when the exact task changes.

## Instruction Priority

1. Follow the user’s direct request.
2. Follow this repository guide unless the user explicitly asks to change repo workflow or policy.
3. Prefer explicit repository facts and current code over assumptions.
4. If required context is missing and can be gathered from the repo or tools, gather it before asking the user.
5. If required context cannot be retrieved, ask the user only for the missing piece.

## Session Start

Re-read this file at the start of each session. Assume it may have changed since the last context window.

## Required Onboarding

Perform this onboarding only when you are first working in this folder structure or when history has been compacted.

1. Before doing anything else, call the `code_info` MCP tool.
2. In that tool call, include the full repository path for this repository when doing so.
3. Ask for:
   - a concise project overview, including a summary of the last 3 git commits.
   - Confirm the current git branch.
   - The current active plan, if any, along with a brief summary status of the plan
4. Without performaing any additional research directly, relying only on thin information provided by code_info, summarize for the user:
   - the project overview;
   - what was last implemented;
   - what should be implemented next.

## Working with Planning Files

1. Do NOT read whole planning files directly unless you are asked specific information about the plan AND the required data cannot be found by using the python files within `$CODEINFO_ROOT/scripts`. The planning files are huge and burn tokens which is expensive, so avoid reading the whole file unless absolutely nesessary.
2. 

## Documentation Sources

- When working in React, use the MUI MCP tool for all Material UI references.
- For any other API or SDK, consult current documentation via the Context7 MCP tool.

## Harness Path Contract

- `CODEINFO_ROOT` always means the harness repository root for this workflow, not the target repository root and not the current `working_folder`.
- Use `"$CODEINFO_ROOT/..."` only for harness-owned assets such as `scripts/**`, `codeinfo_markdown/**`, `flows/**`, and similar workflow support files.
- When you need files from the target repository being worked on, use the selected repository path, `working_folder`, repo-relative paths, or explicit absolute paths instead of `CODEINFO_ROOT`.

## Research And Documentation Order

- For questions about this local repository, use the `code_info` MCP tool first.
- After `code_info`, inspect the local code directly with repository search and file reads as needed.
- For Material UI questions, use the MUI MCP tool first.
- For non-MUI libraries, SDKs, or API documentation, use the Context7 MCP tool first.
- For external GitHub repository documentation or architecture questions, use the DeepWiki MCP tool when it is relevant to the task.
- Do not force a single global tool order across all tasks. Choose the first tool based on whether the task is about the local repo, MUI, another library or SDK, or an external GitHub repository.

## Output Contract

- Keep responses concise and task-focused.
- Include file references when explaining code or repo instructions.
- State clearly when tests, builds, or validation steps were not run.
- Do not invent repository state, tool output, or test results.
- Before substantial work, send a short progress update describing the next action.
- After substantial work, report what changed and how it was validated.

## Working Through Story Plans

When working from a file in `./planning` that is NOT a pr-summary file, update the plan continuously as implementation progresses.

1. Mark each subtask complete immediately when that subtask is implemented.
2. Mark each testing step complete immediately when that testing step is performed.
3. Change each completed checkbox from `[ ]` to `[x]` at the point of completion.
4. Do not batch multiple checkbox updates later.
5. After marking a subtask or testing step complete, add a brief point to that task’s `Implementation Notes` section.
6. Each implementation note must briefly state:
   - what was done;
   - any issue that had to be overcome;
   - or why the step is blocked.
7. This `Implementation Notes` update is plan-maintenance, not a separate subtask or testing item, and should not be pre-modeled as a future-dependent checklist entry.
8. Every unchecked testing checkbox is mandatory blocking work, even if its wording says `optional`, `if needed`, `if targeted diagnosis is needed`, or similar.
9. Do not model optional or failure-only diagnostic commands as unchecked testing checkboxes. Keep them in prose or inside the failure-diagnosis text of a mandatory testing step instead.

## Branching And Phase Flow

1. Create or reuse a feature branch for each story using `feature/<number>-<short-description>`.
2. Create that branch from the currently checked out location unless the user instructs otherwise.
3. Work only within that branch until the story is complete and working.
4. Each commit message must start with `DEV-[Number] -`.
5. Each commit message body should contain 4 or 5 sentences explaining what changed and why.

## Build Workflow

### Wrapper-First Rule

- Use build wrappers as the default build path.
- Use raw underlying commands only when wrapper maintenance or diagnosis requires them.
- Wrapper logs are the source of full diagnostic detail.

### Build Wrappers

- `npm run build:summary:server` builds the server workspace with compact summary output. Full log: `logs/test-summaries/build-server-latest.log`.
- `npm run build:summary:client` runs the client workspace typecheck as a pre-build gate and then the client build with compact summary output. Full log: `logs/test-summaries/build-client-latest.log`.
- `npm run typecheck:summary:client` runs the client workspace typecheck with compact summary output when direct TypeScript diagnosis is needed without the build phase. Full log: `logs/test-summaries/typecheck-client-latest.log`.
- `npm run compose:build:summary` runs Docker Compose build with compact summary output. Full log: `logs/test-summaries/compose-build-latest.log`.

### Summary Wrapper Output Contract

- Summary wrappers emit heartbeat/final guidance fields on wrapper stdout: `timestamp`, `phase`, `status`, `log_size_bytes`, `agent_action`, `do_not_read_log`, and a final `log` path.
- If `agent_action: wait`, the wrapper is still healthy and running.
- While the wrapper continues to emit heartbeat updates at least about every 2 minutes, keeps `do_not_read_log: true`, and shows ongoing progress such as growing `log_size_bytes`, you MUST keep waiting regardless of total elapsed wall-clock time.
- Do not treat elapsed time by itself as evidence that the wrapper is hung.
- Do not read the saved log while `do_not_read_log: true`.
- If `agent_action: skip_log`, the wrapper finished with a clean success. Do not read the saved log unless the user asks or later work specifically needs it.
- If `agent_action: inspect_log`, the wrapper ended with warnings, failure, or ambiguous parsing. Open the saved log and diagnose from there.

### Build Failure Diagnosis

1. Run the relevant wrapper.
2. If the wrapper is still emitting timely `agent_action: wait` heartbeats and ongoing progress, continue waiting and do not interrupt it solely because it has been running for a long time.
3. Capture the log path from the wrapper summary output if the wrapper ends with `agent_action: inspect_log` or otherwise fails unexpectedly.
4. Open the log file and inspect the failing command output.
5. Fix the failing dependency, config, or code.
6. Re-run the same wrapper.
7. If a Docker or Compose build fails due to a likely transient network or cache issue, retry once before deeper investigation.

## Run Workflow

### Wrapper-First Rule

- Compose wrappers are the default way to start and stop the AI-agent testing or automation stack.
- For manual story proof and close-out testing, prefer the checked-in main `codeinfo` stack from `docker-compose.yml`, not `codeinfo:local`.
- Do not run any `*:local:*` commands from this agent.
- These wrappers centralize env-file handling and Docker socket or runtime compatibility through `scripts/docker-compose-with-env.sh`.

### Run Wrappers

- `npm run compose` builds and starts the testing stack.
- `npm run compose:build` builds the testing stack images.
- `npm run compose:up` starts the testing stack when images are already built.
- `npm run compose:down` stops the testing stack.
- `npm run compose:logs` tails testing stack logs.

### Preferred Start Sequence

1. Run `npm run compose:build`.
2. Run `npm run compose:up`.

Manual-proof notes:

- Treat the main stack at `http://localhost:5001` and `http://localhost:5010` as the supported human/manual-testing surface unless the active plan says otherwise.
- The checked-in main stack mounts its editable proof agent catalog from `manual_testing/codeinfo_agents` and `manual_testing/codex_agents`; when later manual proof needs dedicated warning, fallback, duplicate-root, provider-specific, or limited-capability cases, prefer adjusting those `manual_testing` roots rather than disturbing the `codeinfo:local` development catalog.
- Manual testing may be skipped only when repository-owned guidance in `AGENTS.md` or `codeinfo_markdown/repository_information.md` defines a skip condition and that condition is actually being hit during proof. For this repository, missing provider login or auth state that requires human-controlled two-factor authentication is an allowed skip for the affected auth-dependent surface. Autonomous manual proof must not attempt `Re-authenticate` in that case, must not reopen or fail the task by itself, and must not generate implementation work by itself.

Shortcut:

- `npm run compose` is the equivalent build-plus-up sequence.

### Stop Sequence

1. Run `npm run compose:down`.

### Run Failure Diagnosis

1. Re-run the relevant compose wrapper and capture the terminal output.
2. Tail logs with `npm run compose:logs`.
3. Fix the failing container, config, or env issue.
4. Re-run the same wrapper.

## Local Stack Safety

- If `docker-compose.local.yml` services are running, assume they may be hosting the current Codex or manual-testing session.
- `codeinfo:local` is the live development stack, not the default close-out proof stack. Keep its bind-mounted `codeinfo_agents` and `codex_agents` trees untouched unless the user explicitly wants development-stack changes there.
- Do not run `npm run compose:local:down`, `docker compose -f docker-compose.local.yml down`, or otherwise stop or remove `codeinfo2-*-local` containers unless the user explicitly instructs you to do so.
- Do not restart or clean up the local stack just because it appears stale. If a task seems to require switching away from the local stack, stop and ask first.
- Reason: the local compose stack may be the live runtime backing the current agent session, browser tooling, or proof flow; taking it down can kill the session and interrupt work in progress.

## Test Workflow

### Wrapper-First Rule

- Use test wrappers as the default test path.
- Use raw underlying commands only when wrapper maintenance or diagnosis requires them.
- Wrapper logs are the source of full diagnostic detail.
- When a task requires running the full automated test suite across client, server, and e2e surfaces, use `npm run test:summary:all:parallel` as the required all-tests wrapper.

### Test Wrappers

- `npm run test:summary:client` runs the client test suite with compact summary output. Full log: `test-results/client-tests-<timestamp>.log`. JSON: `test-results/client-tests-<timestamp>.json`.
- `npm run test:summary:server:unit` runs the server `node:test` unit and integration suites with compact summary output. Full log: `test-results/server-unit-tests-<timestamp>.log`.
- `npm run test:summary:server:cucumber` runs the server cucumber feature suites with compact summary output. Full log: `test-results/server-cucumber-tests-<timestamp>.log`.
- `npm run test:summary:e2e` runs the e2e flow with setup, build, tests, and teardown. Full log: `logs/test-summaries/e2e-tests-latest.log`.
- `npm run test:summary:server:parallel` builds the server workspace once, then runs the server unit and cucumber wrappers in parallel with `--skip-build`.
- `npm run test:summary:all:parallel` builds reusable client, server, and e2e compose artifacts first, then runs the client, server unit, server cucumber, and e2e wrappers in parallel with shared-build skip flags.
- `npm run test:summary:client:parallel` is a convenience validation path that runs `build:summary:client` and then `test:summary:client`; it belongs to the parallel workflow family even though it is not a multi-harness fan-out by itself.
- These wrappers do not have a fixed failure time budget.
- As long as a wrapper continues to emit healthy `agent_action: wait` heartbeats at least about every 2 minutes and shows ongoing progress such as growing `log_size_bytes`, you must keep waiting no matter how long the run takes.
- Standalone wrappers remain the self-contained default for diagnosis. Use the new `*:parallel` commands for batch validation when you want shared prebuilds and cross-harness parallelism.
- Treat `npm run test:summary:all:parallel` as the canonical batch-validation wrapper whenever repo instructions, a plan, or a task says to run "all tests", "the full automated suite", or equivalent full-suite wording.

### Targeted Test Runs

- Client Jest supports `--file`, `--subset`, and `--test-name`.
- Server `node:test` wrapper supports `--file`, `--test-name`, and `--skip-build`.
- Server cucumber wrapper supports `--tags`, `--feature`, `--scenario`, and `--skip-build`.
- E2E Playwright wrapper supports `--file`, `--grep`, and `--skip-compose-build`.
- For final validation, run the full relevant summary wrapper without targeted args.
- When final validation must cover the entire automated repo test surface, that full wrapper is `npm run test:summary:all:parallel`.

### Test Failure Diagnosis

1. Run the relevant wrapper.
2. If the wrapper is still emitting timely `agent_action: wait` heartbeats and ongoing progress, continue waiting and do not interrupt it solely because it has been running for a long time.
3. Capture the log path from the wrapper summary output if the wrapper ends with `agent_action: inspect_log` or otherwise fails unexpectedly.
4. Open the full log file and locate the failing test block.
5. Fix the failing code, config, or dependency.
6. Re-run targeted wrappers for diagnosis as needed.
7. After fixes, re-run the full relevant summary wrapper without targeted args.
