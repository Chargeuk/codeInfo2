# Story 0000062 - Flow loop control uses wrapper scripts under scripts/flow_control

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Flow loop control currently depends on `loop_control_agent` prompts that ask an LLM to read workflow-state files, run one or more helper scripts, reconcile the results, and then answer `{"answer":"yes"}` or `{"answer":"no"}`. That shape is too fragile for control-flow decisions. A recent `flows/implement_next_plan.json` run entered an infinite loop after the loop-control agent read the right sources but answered from the wrong mental source of truth, letting stale `current-task.json` state override the prompt's intended `plan_status.py` decision rule.

The product goal for this story is not to remove LLM-based loop control entirely yet. The current flow engine still requires an agent-backed `break` or `continue` step. Instead, this story makes `loop_control_agent` as cheap, basic, and non-reasoning-heavy as possible by moving the real decision logic into deterministic wrapper scripts under `scripts/flow_control/`.

Each loop-control gate should stop asking the model to inspect multiple files or interpret multi-field script output. Instead, each gate should call one narrow script that does all necessary state reads and decision logic internally, then prints exactly one authoritative JSON object to stdout: `{"answer":"yes"}` or `{"answer":"no"}`. The `loop_control_agent` prompt should become a transport instruction that runs the command and returns stdout exactly, with no extra reasoning, recomputation, or file reads.

This story should also be designed so the same logic can later be reused if the flow engine grows native non-LLM loop control. The decision code should therefore live in shared Python helpers under `scripts/flow_control/`, with tiny named entrypoint scripts for each gate. That keeps today's flow JSON prompts simple while making tomorrow's native engine path able to call the same logic directly.

The first practical target is `flows/implement_next_plan.json`, because that flow already has the highest-value and highest-risk `loop_control_agent` gates. The same pattern should also be applicable to the sibling flow templates that share this control style, such as `flows/improve_task_implement_plan.json`, `flows/task_and_implement_plan.json`, and review-loop control gates that currently ask agents to interpret `story_workflow_status.py` or related workflow-state files.

### Acceptance Criteria

- Loop-control decision logic moves into Python code under `scripts/flow_control/` rather than being expressed primarily in `loop_control_agent` prompt reasoning.
- Each loop-control gate that adopts the new pattern has a tiny named entrypoint script whose stdout is exactly `{"answer":"yes"}` or `{"answer":"no"}`.
- Each new loop-control entrypoint script lives under `scripts/flow_control/`.
- Shared reusable loop-control logic also lives under `scripts/flow_control/` instead of being duplicated across many standalone scripts.
- `loop_control_agent` prompts for migrated gates become command-running instructions that return stdout exactly, rather than asking the model to read workflow-state files and infer a boolean itself.
- The migrated prompts explicitly forbid recomputing the answer from other files, prior conversation state, or the model's own reasoning.
- The first migrated flow is `flows/implement_next_plan.json`.
- The wrapper-script pattern is structured so it can later be reused by native non-LLM loop control without rewriting the decision logic from scratch.
- Wrapper-script failures fail conservatively and deterministically for each gate instead of leaving the decision ambiguous to the model.
- The design remains compatible with the existing flow engine contract that currently expects agent-backed `break` and `continue` answers.
- Tests cover both the shared loop-control decision helpers and the migrated flow-facing behavior for the highest-risk gates.

### Out Of Scope

- Removing `loop_control_agent` from the engine in this story.
- Designing a brand-new non-LLM flow-step type in this story.
- Replacing every command, flow, planner, or manual-testing prompt that reads state from disk; this story is about loop-control gates first.
- Reworking unrelated flow semantics such as run-in-place, waiting-for-input, or transcript rendering unless the wrapper-script migration directly requires a minimal change there.
- Keeping the current multi-source reasoning prompts as the long-term preferred control path.

### Additional Repositories

- No Additional Repositories

### Questions

None. The planning direction is now fixed: use wrapper scripts under `scripts/flow_control/`, keep `loop_control_agent` prompts minimal, and structure the logic for later native reuse.

## Decisions

1. Wrapper-script location
   - The question being addressed: Where should the new loop-control helper scripts live?
   - Why the question matters: The repository needs a stable home that keeps flow-control logic discoverable now and reusable later if the engine stops depending on an LLM for loop control.
   - What the answer is: Put the new loop-control wrappers and shared helpers under `scripts/flow_control/`.
   - Where the answer came from: User direction in this planning discussion.
   - Why it is the best answer: It keeps the scope explicit, avoids scattering small control scripts at the top level of `scripts/`, and gives a future native caller a clear seam to reuse.
2. Loop-control architecture
   - The question being addressed: Should loop-control behavior be implemented as many standalone scripts or as shared logic plus tiny entrypoints?
   - Why the question matters: The choice affects prompt simplicity, duplication risk, future maintainability, and whether later engine-native loop control can reuse the same logic.
   - What the answer is: Use shared Python logic under `scripts/flow_control/` plus tiny named entrypoint scripts for each loop gate.
   - Where the answer came from: This planning discussion's analysis of control-flow fragility and future native-control goals.
   - Why it is the best answer: It keeps prompts cheap and basic today, avoids copy-paste drift across gates, and gives the future engine a direct code seam to call.
3. Loop-control prompt contract
   - The question being addressed: What should `loop_control_agent` actually do after the wrapper scripts exist?
   - Why the question matters: The infinite-loop failure happened because the model was still asked to reconcile multiple workflow-state sources instead of simply relaying a deterministic command result.
   - What the answer is: Each migrated prompt should run one authoritative command and return stdout exactly, with no additional reasoning or file reads.
   - Where the answer came from: This planning discussion's root-cause analysis of the `implement_next_plan` infinite-loop failure.
   - Why it is the best answer: It turns the model into a thin transport layer for a deterministic answer rather than the place where workflow truth is reconstructed.

## Implementation Ideas

- Create a shared module in `scripts/flow_control/` that exposes plain functions for the main loop-control decisions, such as:
  - current-task handoff validity;
  - implementation complete;
  - task blocked;
  - automated-proof complete;
  - story complete;
  - review-loop exit conditions.
- Keep the entrypoint surface literal and named per gate rather than using one giant `--mode` script, so flow prompts can call a single obvious filename and later native engine support can target the same named seams.
- Make each entrypoint print exactly one JSON object to stdout and nothing else:
  - `{"answer":"yes"}`
  - `{"answer":"no"}`
- Let shared helpers return richer internal metadata, such as reason codes or evidence fields, while keeping the entrypoint stdout minimal.
- If richer debugging is needed, write optional sidecar JSON artifacts under `codeInfoStatus/flow-state/` or another bounded scratch location rather than polluting stdout.
- Keep gate-specific conservative-failure behavior inside code. For example, if required state is missing or malformed, the wrapper should decide whether that gate fails as `yes` or `no` according to the control contract instead of delegating that ambiguity back to the model.
- Migrate `flows/implement_next_plan.json` first, replacing the current multi-source prompts with command-only prompts that run the new `scripts/flow_control/` entrypoints.
- After the first migration, apply the same pattern to the matching gates in:
  - `flows/improve_task_implement_plan.json`
  - `flows/task_and_implement_plan.json`
  - any review-loop flow gates that currently ask the model to interpret `story_workflow_status.py` or similar workflow-state output.
- Add focused tests around the shared helper functions so control truth is asserted directly without going through an LLM harness.
- Add flow-facing tests that prove the migrated gates behave correctly when workflow-state files disagree, because the whole point of this story is to keep the agent from choosing the wrong source of truth.

### Task 1. Build shared flow-control helpers and wrapper entrypoints

- Task Status: `__done__`

#### Subtasks

1. [x] Read `AGENTS.md`, this Story 62 plan, `scripts/plan_status.py`, `scripts/story_workflow_status.py`, `scripts/check_current_task_handoff.py`, and `scripts/flow_state_utils.py`, then map the reusable decision seams that belong under `scripts/flow_control/`.
2. [x] Create the `scripts/flow_control/` package with shared modules for current-task, story, review, and plan-scope decisions plus common answer-printing helpers.
3. [x] Add the thin entrypoint scripts for the current-task, story, review, and final plan-scope yes/no gates, keeping stdout limited to the exact answer object.
4. [x] If needed, make minimal safe changes to existing top-level workflow scripts so the new flow-control package can import reusable helper functions instead of re-parsing subprocess output ad hoc.
5. [x] Add optional debug-sidecar support that stays out of stdout while recording reason codes or freshness context for later diagnosis.
6. [x] Run lint-oriented static checks for the new Python files if a repository-owned Python lint or format command already exists for this scope; otherwise do the repo's available static sanity check for these files.
7. [x] Run the repository's format or formatting-equivalent check for the touched Python files if one exists; otherwise use the repo's supported static sanity path for this seam.

#### Testing

1. [x] Run focused command-line smoke checks for each new wrapper family under `scripts/flow_control/` and confirm each script prints only `{"answer":"yes"}` or `{"answer":"no"}` on stdout for representative local states.
2. [x] Run the dedicated automated tests that cover the new shared helper module and wrapper entrypoints.
3. [x] Run the repository's lint proof for the changed files.
4. [x] Run the repository's format-check or prettier-equivalent proof for the changed files.

#### Implementation Notes

- Subtask 1 complete: re-read the workflow scripts and flow-state helpers, then mapped the real reusable seams into four decision families: current-task status, story completion, review-loop disposition, and final plan-scope completion.
- Subtask 2 complete: created `scripts/flow_control/` with shared modules for current-task, story, review, and plan-scope decisions plus the shared `decision.py` output helper and `_bootstrap.py` import shim for nested script execution.
- Subtask 3 complete: added the thin wrapper entrypoints for each yes/no gate, with stdout now emitted as compact exact JSON such as `{"answer":"yes"}` so the loop agent can relay current command output without extra formatting drift.
- Subtask 4 complete: refactored `scripts/check_current_task_handoff.py` to expose `get_current_task_handoff_status(...)`, which lets the new wrapper layer reuse the existing handoff-validation logic directly instead of shelling out and reparsing stdout.
- Subtask 5 complete: added env-controlled debug-sidecar support through `CODEINFO_FLOW_CONTROL_DEBUG_DIR`, keeping stdout minimal while allowing later diagnosis to capture `evaluated_at_utc`, `reason_code`, and decision details out of band.
- Subtask 6 complete: there is no repository-owned Python linter for this seam, so the available static sanity path was the new focused Python unit coverage plus direct wrapper smoke execution; repo-wide `npm run lint` was also run later and failed only on unrelated pre-existing client import-order warnings.
- Subtask 7 complete: ran the repository-supported formatting proof with `npm run format:check`; it passed, while no Python-specific formatter/check exists in this repo for the new wrapper files.
- Testing complete: wrapper smoke commands returned only compact answer JSON, and `python3 -m unittest scripts.test.test_flow_control_current_task scripts.test.test_flow_control_story scripts.test.test_flow_control_review scripts.test.test_flow_control_plan_scope` passed for the new deterministic helper surface.

### Task 2. Migrate flow loop-control prompts to command-only wrapper usage

- Task Status: `__done__`

#### Subtasks

1. [x] Re-open `flows/implement_next_plan.json`, `flows/task_and_implement_plan.json`, `flows/improve_task_implement_plan.json`, `flows/review_plan.json`, and `flows/ingest_external_review_plan.json`, then inventory which `break` and `continue` gates should migrate to the new `scripts/flow_control/` entrypoints.
2. [x] Update `flows/implement_next_plan.json` so the migrated `loop_control_agent` prompts run one fresh authoritative wrapper command, explicitly forbid reuse of previous output or conversation memory, and return current stdout exactly.
3. [x] Apply the same wrapper-command prompt pattern to the matching gates in `flows/task_and_implement_plan.json` and `flows/improve_task_implement_plan.json`.
4. [x] Apply the same wrapper-command prompt pattern to the matching review-loop gates in `flows/review_plan.json` and `flows/ingest_external_review_plan.json`.
5. [x] Re-open the edited flow files and confirm no legacy prompt still asks the model to reconcile multiple workflow-state files for any gate now covered by `scripts/flow_control/`.
6. [x] Run lint-oriented static checks for the touched JSON and adjacent flow-support files if the repository provides one for this scope.
7. [x] Run the repository's format-check or formatting-equivalent proof for the touched flow files if one exists.

#### Testing

1. [x] Parse each edited flow JSON file to confirm the new prompt strings still produce valid JSON documents.
2. [x] Run focused automated tests that cover flow loop-control execution and prompt-driven wrapper usage for the migrated gates.
3. [x] Run the repository's lint proof for the changed files.
4. [x] Run the repository's format-check or prettier-equivalent proof for the changed files.

#### Implementation Notes

- Subtask 1 complete: re-opened all five target flow files, mapped every fragile current-task and review-disposition gate to the new `scripts/flow_control/` wrappers, and left the intentionally unconditional `Exit Task-Up Path After Encoding Review Findings` gate unchanged.
- Subtask 2 complete: migrated `flows/implement_next_plan.json` to wrapper-command prompts that require fresh execution in the current step and forbid reuse of prior output, cached results, or conversational memory.
- Subtask 3 complete: applied the same wrapper-command contract to `flows/task_and_implement_plan.json` and `flows/improve_task_implement_plan.json`, including the final plan-scope completion checks through `check_plan_scope_story_complete.py`.
- Subtask 4 complete: migrated `flows/review_plan.json` and `flows/ingest_external_review_plan.json` review-loop gates to wrapper commands and normalized those migrated gates onto `loop_control_agent` / `loop_controller` so the control path stays lightweight and consistent.
- Subtask 5 complete: re-open verification confirmed the migrated gates no longer use the old “read files and infer” prompt shape for any seam now covered by `scripts/flow_control/`.
- Testing complete: parsed all edited flow JSON files successfully and added prompt-contract assertions in `scripts/test/test_flow_control_story.py` to prove the migrated gates call wrapper scripts and explicitly demand fresh command execution.
- Repo proof note: `npm run lint` was executed for the touched surface but fails only on unrelated existing client import-order warnings, while `npm run format:check` passes.

### Task 3. Prove stale-state and stale-answer regressions stay fixed

- Task Status: `__done__`

#### Subtasks

1. [x] Add or update automated tests that model conflicting workflow state, especially the case where `current-task.json` is stale while `plan_status.py` resolves the live task as complete or unblocked.
2. [x] Add or update automated tests that prove the migrated loop-control path depends on fresh wrapper execution rather than LLM reasoning over file contents.
3. [x] Add or update automated tests for review-loop exit decisions so the same wrapper-command pattern covers `review-disposition-state.json` and `story_workflow_status.py` seams safely.
4. [x] Record in this plan which proof homes now cover the original infinite-loop regression class and the fresh-execution prompt contract.
5. [x] Run lint-oriented static checks for the touched test files if the repository provides them for this scope.
6. [x] Run the repository's format-check or formatting-equivalent proof for the touched test files if one exists.

#### Testing

1. [x] Run the focused automated tests added for stale-state and stale-answer loop-control coverage.
2. [x] Run the broader server automated proof that exercises flow execution after the migrated wrapper-command gates land.
3. [x] Run the repository's lint proof for the changed files.
4. [x] Run the repository's format-check or prettier-equivalent proof for the changed files.

#### Implementation Notes

- Subtask 1 complete: `scripts/test/test_flow_control_current_task.py` now covers the original stale-state regression class by proving a stale `current-task.json` payload cannot override the live `plan_status.py` result when task 3 is actually complete and unblocked.
- Subtask 2 complete: `scripts/test/test_flow_control_story.py` now inspects the migrated flow JSON files and asserts the wrapper prompts explicitly require fresh execution, forbid replaying cached or remembered answers, and relay current stdout exactly.
- Subtask 3 complete: `scripts/test/test_flow_control_review.py`, `scripts/test/test_flow_control_story.py`, and `scripts/test/test_flow_control_plan_scope.py` cover the review-loop and story-level yes/no seams that now flow through deterministic wrapper commands.
- Subtask 4 complete: the proof homes for the original infinite-loop class are the stale-state current-task tests plus the migrated flow prompt-contract assertions, which together cover both the deterministic source-of-truth decision and the fresh-execution transport contract.
- Testing complete: the focused Python unit suite passed; the broader `npm run test:summary:server:unit` wrapper failed in unrelated existing server/runtime tests and its log did not reference the new `scripts/flow_control/` files or migrated flow JSON.
- Repo proof note: repo-wide lint still fails only on unrelated existing client import-order warnings, while `npm run format:check` remains green.

### Task 4. Final Story 62 validation and close-out

- Task Status: `__done__`

#### Subtasks

1. [x] Re-open `AGENTS.md`, this Story 62 plan, the edited `scripts/flow_control/` files, and the migrated flow JSON files, then confirm the final implementation still matches the accepted wrapper-script architecture and fresh-execution prompt contract.
2. [x] Re-read the retained automated-proof outputs for Tasks 1 through 3 and verify this plan's notes clearly identify the proof homes for wrapper behavior, flow migration, and stale-state regression coverage.
3. [x] Summarize the final migrated gate set and the exact future-facing reuse seam for eventual native non-LLM loop control.
4. [x] Run lint-oriented static checks for the full touched surface if the repository provides them for this scope.
5. [x] Run the repository's format-check or formatting-equivalent proof for the full touched surface if one exists.

#### Testing

1. [x] Run the full relevant server automated proof wrapper for the touched flow and script surface.
2. [x] Run the full relevant repo lint wrapper.
3. [x] Run the full relevant repo format-check or prettier-equivalent wrapper.

#### Implementation Notes

- Subtask 1 complete: re-opened the repo instructions, Story 62 plan, wrapper modules, and migrated flow JSON after the final edits to confirm the architecture still matches the intended `shared helpers + tiny entrypoints + fresh wrapper prompt` design under `scripts/flow_control/`.
- Subtask 2 complete: verified the retained proof homes are now explicit in this plan: wrapper smoke commands, focused Python unit tests, flow prompt-contract assertions, JSON parse checks, repo `format:check`, repo `lint` output, and the broader server-unit wrapper summary.
- Subtask 3 complete: the migrated gate set now covers current-task handoff validity, implementation completion, blocker detection, manual-testing readiness, unchecked-subtask/testing reroute, story completion, review minor-fix/task-up exits, review-loop exits, and final plan-scope completion; the future native non-LLM seam is the shared Python decision modules under `scripts/flow_control/`.
- Validation complete: `npm run format:check` passed, `npm run lint` failed only on unrelated existing client import-order warnings, and `npm run test:summary:server:unit` failed in unrelated existing server/runtime tests without implicating the new flow-control wrapper surface.
