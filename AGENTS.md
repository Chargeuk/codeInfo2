# Agent Workflow Guide

## Required Onboarding
Note that the following steps only need to be performed when you are first working in this folder structure or when your history has been compacted. You do not need to perform these steps for every question you answer:
- Before doing anything else, call the code_info mcp tool to give you an overview of the project, and to tell you which plan from the ./planning folder is the next one to be worked on based on it being the lowest index numerically based on the filename (<index>-<title>.md) but still having tasks that are marked as in progress or todo. When calling the code_info mcp tool you MUST provide the full path to this repository when you ask it this question so it knows which repository you are interested in. Then you must view the last 3 commits to the repository and using all of this combined information, provide me with an overview of the project, what was last implemented, and what is to be implemented next.
- Confirm the git branch we are currently on & check the equivalent planning document, and the latest planning document (if not the same) from the planning folder.
- Re-read these files at the start of each session; assume they may have changed since your last context window.
- When working in React, use the MUI MCP tool for all Material UI references. For any other APIs or SDKs, consult documentation via the Context7 MCP tool so guidance stays current.

## Working through story plans

- When working through story plans from the ./planning folder you MUST mark each subtask and testing step as complete by marking the [ ] box with an 'x' so it becomes [x] at the point of implementing that subtask or testing step. DO NOT wait until multiple subtasks are complete and then mark them all in a batch. This ensures you know exactly where you are up to if your context is reset, and allows users to follow your progress precicely. Missing this step of marking subtasks complete at the point of implementation has caused multiple issues in the past, so DO NOT FORGET to keep the subtasks and testing steps up to date at the point you complete each of them!
- After marking a subtask or testing step as complete, you must then add an implemention note point to the `Implementation Notes` section of the task, briefly stating what was done and any issues you needed to overcome, or if the subtask is blocked for some reason.

## Branching & Phase Flow

- Create a feature branch for each story (`feature/<number>-<short-description>`) from the currently checked out loction.
- Each commit should be prefixed with DEV-[Number] - and contain a brief description consisting of 4 or 5 sentences explaining what changed and why.
- Work only within that branch until every task in the story is complete and working.

## Builds
### Wrapper-First Workflow
- Build wrappers exist to keep terminal output compact while preserving complete logs.
- Use wrapper commands as the default path for day-to-day build checks.
- Raw underlying commands are documented in header comments in `scripts/*.mjs`; this is reference material for wrapper maintenance and should not normally be needed.

### Build Wrappers
- `npm run build:summary:server`
  - Builds the server workspace with compact summary output.
  - Full log file: `logs/test-summaries/build-server-latest.log`.
- `npm run build:summary:client`
  - Builds the client workspace with compact summary output.
  - Full log file: `logs/test-summaries/build-client-latest.log`.
- `npm run compose:build:summary`
  - Runs Docker Compose build with compact summary output.
  - Full log file: `logs/test-summaries/compose-build-latest.log`.

### Build Failure Diagnosis
1. Run the relevant wrapper and capture the log path from summary output.
2. Open the log file and inspect the failing command output.
3. Fix the failing dependency/config/code and re-run the same wrapper.
4. If Docker/Compose builds fail due to transient network/cache issues, retry once before deeper investigation.

## Run System
### Wrapper-First Workflow
- Compose wrappers are the default way to start/stop AI-agent testing/automation stacks.
- Do not run any `*:local:*` commands from this agent; they manage the local developer systems that the agent is running in.
- These wrappers centralize env-file handling and Docker socket/runtime compatibility through `scripts/docker-compose-with-env.sh`.
- Raw underlying commands are documented in `package.json` scripts and `scripts/docker-compose-with-env.sh`.

### Run Wrappers
- `npm run compose`
  - Builds and starts the testing stack.
- `npm run compose:build`
  - Builds the testing stack images.
- `npm run compose:up`
  - Starts the testing stack (assumes images are already built).
- `npm run compose:down`
  - Stops the testing stack.
- `npm run compose:logs`
  - Tails testing stack logs.

### Start Full AI-Agent Testing Docker Environment (Preferred Sequence)
Run these commands from repo root in this order:
1. `npm run compose:build`
2. `npm run compose:up`

Shortcut:
- `npm run compose` (equivalent build + up sequence).

### Stop Full AI-Agent Testing Docker Environment
Run this command from repo root:
1. `npm run compose:down`

### Run Failure Diagnosis
1. Re-run the relevant compose wrapper and capture terminal output.
2. Tail logs with `npm run compose:logs`
3. Fix the failing container/config/env issue and re-run the same wrapper.

## Testing
### Wrapper-First Workflow
- Test wrappers keep terminal output compact while preserving complete logs for diagnosis.
- Use wrapper commands as the default test execution path.
- Raw underlying commands are documented in header comments in `scripts/*.mjs`; this is reference material for wrapper maintenance and should not normally be needed.

### Test Wrappers
- `npm run test:summary:client`
  - Runs client test suite with compact summary output.
  - Full log file: `test-results/client-tests-<timestamp>.log`.
  - JSON results file: `test-results/client-tests-<timestamp>.json`.
- `npm run test:summary:server:unit`
  - Runs server node:test unit/integration suites with compact summary output.
  - Full log file: `test-results/server-unit-tests-<timestamp>.log`.
- `npm run test:summary:server:cucumber`
  - Runs server cucumber feature suites with compact summary output.
  - Full log file: `test-results/server-cucumber-tests-<timestamp>.log`.
- `npm run test:summary:e2e`
  - Runs e2e flow with setup/build, tests, and teardown.
  - Full log file: `logs/test-summaries/e2e-tests-latest.log`.

### Targeted Test Runs Policy
- Summary wrappers support targeted runs for faster diagnosis:
  - Client Jest: `--file`, `--subset`, `--test-name`
  - Server node:test: `test:summary:server:unit` with `--file`, `--test-name`
  - Server Cucumber: `test:summary:server:cucumber` with `--tags`, `--feature`, `--scenario`
  - E2E Playwright: `--file`, `--grep`
- For final validation, run full wrappers with no targeted args.

### Test Failure Diagnosis
1. Run the relevant wrapper and capture the log path from summary output.
2. Open the full log file and locate the failing test block.
3. Fix the failing code/config/dependency and re-run targeted wrappers for diagnosis.
4. After fixes, re-run full relevant summary wrapper(s) without targeted args.
