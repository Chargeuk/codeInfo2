# Story 0000039 – Agents Command Info Popover and Working-Folder Prompts

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

On the Agents page, command descriptions are currently always shown in the main layout, including a default message when nothing is selected. This adds visual noise and competes with core actions. We want command descriptions to move behind an info icon interaction, matching the existing Agent info pattern, so the page stays cleaner while still allowing users to inspect details when needed.

We also want to introduce a new prompt execution workflow tied to the selected `working_folder`. When the selected folder contains a `.github/prompts` directory (case-insensitive folder-name matching) and that directory tree contains markdown files, the user should get a `Prompts` selector. The selector should list available prompt files using paths relative to `.github/prompts/`, allow a blank selection, and include an `Execute Prompt` action beside it.

When `Execute Prompt` is clicked, the app should send a normal user instruction to the selected agent using the existing run flow. The instruction must prepend a fixed persona/behavior preamble and include the full resolved runtime/container path to the selected markdown file. This allows the agent runtime to reliably read the file from inside the execution environment while preserving the existing conversation and transcript behaviors.

If the user changes `working_folder` at any point, any selected prompt must be cleared immediately to avoid stale or cross-folder prompt execution.

### Acceptance Criteria

- The Agents page no longer renders command description text in the main page flow beneath the command row.
- The text `Select a command to see its description.` is removed from the main view.
- A command info icon is shown at the end of the command selector row, consistent with the existing Agent info interaction pattern.
- Clicking the command info icon opens a description surface (popover/dialog-style interaction consistent with current Agents UI patterns).
- If no command is selected, the command info interaction remains safe and understandable (disabled state or clear empty message).
- The `Prompts` selector is only shown when all of the following are true:
  - a non-empty `working_folder` is selected,
  - a `.github/prompts` directory exists under that working folder using case-insensitive folder-name matching,
  - at least one markdown file exists under that prompts directory tree.
- Prompt discovery is recursive under `.github/prompts` and includes markdown files (`.md`, case-insensitive extension handling).
- Prompt dropdown option labels show paths relative to `.github/prompts/` (not absolute paths).
- The prompt selector includes an explicit empty option so users can clear/de-select the selected prompt.
- `Execute Prompt` appears at the end of the prompt selector row and is only enabled when a valid prompt file is selected.
- Changing the `working_folder` clears any selected prompt immediately before any subsequent execution.
- If prompt discovery fails (for example permission, path resolution, or inaccessible-directory errors), the `Prompts` area shows a visible inline error state instead of silently hiding the failure.
- Prompt discovery trigger timing for manually typed `working_folder` values is restricted to blur/Enter events (not live per-keystroke discovery), and discovery also runs after directory picker selection.
- Executing a prompt sends a user instruction to the selected agent conversation using existing agent run behavior.
- The executed instruction prepends the exact required preamble text and appends `Here is the file: <full path>` where `<full path>` is the resolved runtime/container path.
- The prompt file path used for execution is the runtime/container-resolved path (not host-only path text).
- Existing Agent run behaviors (conversation selection/new conversation, transcript updates, run-state handling, error handling) remain consistent.
- Automated tests cover:
  - command info icon visibility/interaction and removal of inline description text,
  - prompt discovery gating and recursive file discovery,
  - relative display-path formatting,
  - enable/disable rules for `Execute Prompt`,
  - prompt reset on working-folder change,
  - outbound payload content including required preamble and resolved runtime path.

### Out Of Scope

- Editing, creating, renaming, or deleting prompt files from the UI.
- Supporting non-markdown prompt file types.
- Prompt versioning, tagging, or search/filter UX beyond the dropdown list.
- Changes to agent command-file schema or command execution sequencing.
- Introducing a new protocol distinct from the existing Agents run contract for prompt execution.
- Multi-select prompt execution, prompt batching, or chained execution in a single click.

### Questions

None.

## Implementation Ideas

- Reuse the existing Agents info popover interaction model to add a parallel command-info control and keep behavior visually/interaction consistent.
- Introduce a server-backed prompt discovery endpoint tied to `agentName` + `working_folder` so path resolution and filesystem checks occur in one trusted place.
- Reuse existing `working_folder` resolution logic to compute runtime/container paths and avoid duplicating host/container mapping logic in the client.
- Implement case-insensitive `.github/prompts` folder matching by scanning directory entries and matching each segment in a normalized manner.
- Implement recursive markdown discovery beneath the matched prompts root and return payload entries shaped as `{ relativePath, fullPath }`.
- Trigger prompt discovery only on `working_folder` blur/Enter and directory-picker selection events; avoid per-keystroke scans to keep UI stable and reduce filesystem churn.
- Surface prompt discovery failures inline in the prompts UI block so users can distinguish “no prompts found” from “prompt lookup failed.”
- Keep prompt execution in the client as a thin composition layer: construct instruction text from the fixed preamble + selected `fullPath`, then call existing `runAgentInstruction`.
- Ensure working-folder edits trigger prompt list refresh and selected prompt invalidation, including manual text edits and directory-picker changes.
- Add focused client tests for UI gating/interaction and API payload composition, plus server unit tests for prompt discovery and path-handling edge cases.
