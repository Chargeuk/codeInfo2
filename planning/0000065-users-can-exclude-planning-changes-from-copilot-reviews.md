# Story 0000065 – Users can exclude planning changes from Copilot reviews

## Implementation Plan

This story follows the repository task contract in `planning/plan_format.md`. Work is limited to making the existing local Copilot CLI review ignore changed planning files while retaining the compact story context that the review needs.

### Description

Local Copilot CLI reviews receive an exact committed `base...head` range and a compact prepared description of the story requirements. The prepared review context already identifies `planning/**` as excluded, but the immutable Copilot `/review` prompt did not repeat that exclusion or direct Git inspection through an excluding pathspec. Copilot could therefore spend review tokens reading planning-file changes that are not reviewable implementation evidence.

After this story, every local Copilot review explicitly excludes changes under `planning/**`. The launcher tells Copilot not to inspect, read, summarize, cite, or report those changes, directs Git diff inspection through the exact excluding pathspec, and records the exclusion in secret-free invocation and normalized-result artifacts. The compact supplied story context remains available as the authoritative requirements source.

### Acceptance Criteria

- Every locally launched Copilot `/review` prompt explicitly excludes `planning/**` changes from inspection and findings.
- The prompt includes the exact pinned `base...head` range and a Git diff command using `-- . ':(exclude)planning/**'`.
- Copilot continues reading the prepared review-instructions file so excluding changed plans does not remove necessary story requirements.
- Invocation metadata and normalized review results record `planning/**` under `excluded_paths`.
- The review remains read-only, local, non-interactive, and prohibited from creating or exporting a remote GitHub review.
- Focused automated tests prove the prompt, pathspec, artifact accounting, and wrapper contract.

### Out Of Scope

- Adding a synthetic commit, filtered repository, Git shim, or provider-specific hard filesystem sandbox to hide planning files mechanically.
- Changing the shared `planning/**` review exclusion used by other review harnesses.
- Changing review scheduling, model selection, endpoint selection, concurrency, resume, cancellation, reconciliation, or usage aggregation.
- Fixing unrelated failures in parallel test wrappers or parallel test suites.
- Running or repairing `npm run test:summary:all:parallel`; this focused story uses sequential targeted tests and the repository build wrappers.
- Manual testing, manual Compose startup proof, screenshots, and other human-operated validation are not desired for this story.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

No manual testing is desired for this story. The behavior is a non-interactive launcher prompt and artifact contract covered by focused automated tests and build validation.

### Questions

## Implementation Ideas

- Keep one exported `planning/**` exclusion constant in the Copilot launcher and reuse it in the prompt and persisted artifacts.
- Reinforce the immutable launcher prompt with the same exclusion already present in the prepared story context.
- Direct Copilot's Git diff inspection through Git's excluding pathspec without changing the pinned commits.
- Protect the behavior through the fake-Copilot launcher test and the Python review prompt-contract suite.

# Tasks

### Task 1. Exclude planning changes from local Copilot reviews

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits: `9dff3f7d`

#### Overview

Make the existing local Copilot CLI review conserve review tokens by excluding changed planning files at the immutable launcher boundary. Preserve the prepared story context and record the exclusion so downstream consumers can audit what was intentionally omitted.

#### Task Exit Criteria

- Every Copilot `/review` launch explicitly excludes `planning/**` while reviewing the exact pinned commits.
- Secret-free invocation and normalized artifacts identify the excluded path.
- Focused automated tests and the server and Compose build wrappers pass.

#### Documentation Locations

- GitHub Copilot CLI reference and the installed `copilot --help` and `copilot help permissions` output: confirm that `/review` has no native changed-path exclusion flag and that prompt/pathspec guidance is the simplest supported approach.

#### Subtasks

1. [x] Inspect `server/src/copilot/reviewLauncher.ts`, `codeinfo_markdown/run_copilot_review_workspace.md`, `server/src/flows/reviewContext.ts`, and the Codex and OpenCode review prompts to establish the existing exclusion behavior and available launcher boundary.
2. [x] Update `server/src/copilot/reviewLauncher.ts` with one `planning/**` exclusion constant, explicit `/review` instructions, the pinned Git exclusion pathspec, and `excluded_paths` fields in invocation and normalized artifacts.
3. [x] Update `server/src/test/unit/copilot-review-launcher.test.ts` to prove the exact prompt range, planning exclusion, Git pathspec, and both artifact contracts.
4. [x] Update `codeinfo_markdown/run_copilot_review_workspace.md` so the wrapper-generated instructions explicitly preserve the planning exclusion and use supplied story context instead of changed planning files.
5. [x] Update `scripts/test/test_review_prompt_contracts.py` and `README.md` to protect and document the planning exclusion.
6. [x] Run `npx eslint server/src/copilot/reviewLauncher.ts server/src/test/unit/copilot-review-launcher.test.ts --max-warnings=0` and resolve every reported issue.
7. [x] Run `npx prettier --check server/src/copilot/reviewLauncher.ts server/src/test/unit/copilot-review-launcher.test.ts codeinfo_markdown/run_copilot_review_workspace.md README.md`, using targeted `npx prettier --write` where needed, and resolve every reported issue.

#### Testing

1. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --file server/src/test/unit/copilot-review-launcher.test.ts`; all 11 tests passed sequentially.
2. [x] Run `python3 -m unittest scripts.test.test_review_prompt_contracts`; all 47 tests passed sequentially.
3. [x] Run `npm run build:summary:server`; the server build passed without warnings.
4. [x] Run `npm run compose:build:summary`; both Compose build items passed.
5. [x] Run `npx eslint server/src/copilot/reviewLauncher.ts server/src/test/unit/copilot-review-launcher.test.ts --max-warnings=0`; lint passed.
6. [x] Run `npx prettier --check server/src/copilot/reviewLauncher.ts server/src/test/unit/copilot-review-launcher.test.ts codeinfo_markdown/run_copilot_review_workspace.md README.md`; formatting passed after applying the targeted automatic fix.

#### Implementation notes

- Added `COPILOT_REVIEW_EXCLUDED_PATHS` as the single launcher-owned exclusion source and reused it in the prompt and persisted artifacts.
- Kept the exact `base...head` review contract and supplied story context instead of introducing a synthetic commit, filtered repository, or Git wrapper.
- The initial format check found one test-file formatting difference; targeted Prettier corrected it before validation continued.
- Parallel-suite repair and all manual testing were deliberately omitted according to the story scope.

---
