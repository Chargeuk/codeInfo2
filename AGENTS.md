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
2. In that tool call, include the full repository path: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2`.
3. Ask for:
   - a concise project overview;
   - the next plan in `./planning`, defined as the lowest `<index>-<title>.md` file that still contains tasks marked `todo` or `in progress`;
   - the current status of that plan.
4. View the last 3 commits in the repository.
5. Confirm the current git branch.
6. Check the planning document that matches the current branch story number, if one exists.
7. Check the latest planning document in `./planning` if it is different from the branch-matched plan.
8. Summarize for the user:
   - the project overview;
   - what was last implemented;
   - what should be implemented next.
9. If no planning file currently contains tasks marked `todo` or `in progress`, state that explicitly and treat the latest numbered planning file as context only.

## Documentation Sources

- When working in React, use the MUI MCP tool for all Material UI references.
- For any other API or SDK, consult current documentation via the Context7 MCP tool.

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

When working from a file in `./planning`, update the plan continuously as implementation progresses.

1. Mark each subtask complete immediately when that subtask is implemented.
2. Mark each testing step complete immediately when that testing step is performed.
3. Change each completed checkbox from `[ ]` to `[x]` at the point of completion.
4. Do not batch multiple checkbox updates later.
5. After marking a subtask or testing step complete, add a brief point to that task’s `Implementation Notes` section.
6. Each implementation note must briefly state:
   - what was done;
   - any issue that had to be overcome;
   - or why the step is blocked.

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
- If `agent_action: wait`, the wrapper is still healthy and running. Do not read the saved log while `do_not_read_log: true`.
- If `agent_action: skip_log`, the wrapper finished with a clean success. Do not read the saved log unless the user asks or later work specifically needs it.
- If `agent_action: inspect_log`, the wrapper ended with warnings, failure, or ambiguous parsing. Open the saved log and diagnose from there.

### Build Failure Diagnosis

1. Run the relevant wrapper.
2. Capture the log path from the wrapper summary output if the wrapper ends with `agent_action: inspect_log` or otherwise fails unexpectedly.
3. Open the log file and inspect the failing command output.
4. Fix the failing dependency, config, or code.
5. Re-run the same wrapper.
6. If a Docker or Compose build fails due to a likely transient network or cache issue, retry once before deeper investigation.

## Run Workflow

### Wrapper-First Rule

- Compose wrappers are the default way to start and stop the AI-agent testing or automation stack.
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

Shortcut:

- `npm run compose` is the equivalent build-plus-up sequence.

### Stop Sequence

1. Run `npm run compose:down`.

### Run Failure Diagnosis

1. Re-run the relevant compose wrapper and capture the terminal output.
2. Tail logs with `npm run compose:logs`.
3. Fix the failing container, config, or env issue.
4. Re-run the same wrapper.

## Test Workflow

### Wrapper-First Rule

- Use test wrappers as the default test path.
- Use raw underlying commands only when wrapper maintenance or diagnosis requires them.
- Wrapper logs are the source of full diagnostic detail.

### Test Wrappers

- `npm run test:summary:client` runs the client test suite with compact summary output. Timeout budget: up to 6 minutes. Full log: `test-results/client-tests-<timestamp>.log`. JSON: `test-results/client-tests-<timestamp>.json`.
- `npm run test:summary:server:unit` runs the server `node:test` unit and integration suites with compact summary output. Timeout budget: up to 12 minutes. Full log: `test-results/server-unit-tests-<timestamp>.log`.
- `npm run test:summary:server:cucumber` runs the server cucumber feature suites with compact summary output. Timeout budget: up to 10 minutes. Full log: `test-results/server-cucumber-tests-<timestamp>.log`.
- `npm run test:summary:e2e` runs the e2e flow with setup, build, tests, and teardown. Timeout budget: up to 10 minutes. Full log: `logs/test-summaries/e2e-tests-latest.log`.

### Targeted Test Runs

- Client Jest supports `--file`, `--subset`, and `--test-name`.
- Server `node:test` wrapper supports `--file` and `--test-name`.
- Server cucumber wrapper supports `--tags`, `--feature`, and `--scenario`.
- E2E Playwright wrapper supports `--file` and `--grep`.
- For final validation, run the full relevant summary wrapper without targeted args.

### Test Failure Diagnosis

1. Run the relevant wrapper.
2. Capture the log path from the wrapper summary output if the wrapper ends with `agent_action: inspect_log` or otherwise fails unexpectedly.
3. Open the full log file and locate the failing test block.
4. Fix the failing code, config, or dependency.
5. Re-run targeted wrappers for diagnosis as needed.
6. After fixes, re-run the full relevant summary wrapper without targeted args.
