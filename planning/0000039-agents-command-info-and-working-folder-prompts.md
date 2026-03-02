# Story 0000039 – Agents Command Info Popover and Working-Folder Prompts

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

On the Agents page, command descriptions are currently always rendered inline below the command selector, including the default message when no command is selected. This story removes that inline description area and moves command details behind a single command-info icon button in the command row.

This story also adds a prompt-assisted instruction flow based on the selected `working_folder`. If that folder contains a `.github/prompts` directory (case-insensitive match on both path segments) and at least one markdown file anywhere under it, the page shows a `Prompts` dropdown and an `Execute Prompt` button in the same row.

Prompt files are discovered from the server (not directly from the browser filesystem) so path checks and host/container path resolution happen in one trusted place. The UI only displays prompt paths relative to `.github/prompts/` but stores the resolved runtime/container full path for execution.

When the user clicks `Execute Prompt`, the client sends a standard instruction run using the existing agent run API. The instruction text is the canonical preamble in this plan with `<full path of markdown file>` replaced by the resolved runtime/container path of the selected prompt file.

When `working_folder` changes (typing and committing with blur/Enter, or selecting via directory picker), the current prompt selection is cleared immediately before any further prompt execution is allowed.

Canonical `Execute Prompt` preamble (must be used verbatim, with placeholder replacement rule below):

`Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>`

Placeholder replacement rule:
- Replace `<full path of markdown file>` with the resolved runtime/container path of the selected markdown prompt file at execution time.

### Acceptance Criteria

1. The inline command description block is removed from the main Agents page flow.
2. The text `Select a command to see its description.` is no longer rendered anywhere on the page.
3. A command-info icon button is displayed in the command selector row (same row as command selection controls).
4. The command-info icon button is disabled when no command is selected.
5. When a command is selected, clicking the command-info icon opens a popover/dialog that shows the selected command description text.
6. Prompt discovery runs only after `working_folder` commit events:
   - manual input `blur`,
   - manual input `Enter`,
   - directory picker selection.
7. Prompt discovery does not run on every keystroke while the user is typing in `working_folder`.
8. The prompts UI row is shown only when all conditions are true:
   - committed `working_folder` is non-empty,
   - a `.github/prompts` directory exists under the selected folder (case-insensitive match for `.github` and `prompts` segments),
   - at least one markdown file exists under that directory tree.
9. Prompt discovery is recursive below `.github/prompts` and includes `.md` files with case-insensitive extension handling (for example, `.md` and `.MD`).
10. Prompt option labels are relative paths from `.github/prompts/` (for example, `onboarding/start.md`), never absolute host/runtime paths.
11. The prompts dropdown includes an explicit empty option so users can clear selection after previously choosing a prompt.
12. `Execute Prompt` is displayed in the prompts row and is disabled unless a valid prompt is selected.
13. If prompt discovery fails, the prompts row shows an inline error message and does not silently hide the failure.
14. Changing `working_folder` clears previously discovered prompt selection immediately and keeps `Execute Prompt` disabled until a new valid prompt is selected.
15. Clicking `Execute Prompt` uses the existing instruction run path (`POST /agents/:agentName/run`) and does not use command-run execution.
16. The outbound `instruction` string equals:
    - canonical preamble text from this plan, with `<full path of markdown file>` replaced by the selected prompt runtime/container full path.
17. The path inserted into the preamble is the runtime/container-resolved full path returned by discovery, not a host-only path string.
18. Existing agent run behavior remains unchanged for conversation reuse/new conversation creation, run state transitions, transcript streaming, and error handling.
19. Automated tests must cover:
    - command-info visibility, disabled state with no command, and popover opening with selected command,
    - removal of inline command description/default text,
    - prompt discovery trigger timing (blur/Enter/picker only),
    - case-insensitive `.github/prompts` detection and recursive markdown discovery,
    - relative-path label rendering,
    - execute button enable/disable rules,
    - prompt reset on `working_folder` change,
    - outbound instruction payload containing the exact preamble text and resolved runtime full path.

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
- Keep prompt execution in the client as a thin composition layer: construct instruction text from the fixed preamble + selected `fullPath`, then call existing `runAgentInstruction` (`POST /agents/:agentName/run`).
- Ensure working-folder edits trigger prompt list refresh and selected prompt invalidation, including manual text edits and directory-picker changes.
- Add focused client tests for UI gating/interaction and API payload composition, plus server unit tests for prompt discovery and path-handling edge cases.
