# Story 0000048 – Working Repo First Reference Resolution For Flows And Commands

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

This story also includes one critical OpenAI ingest bug fix even though it is not naturally part of the reference-resolution feature. The bug is important enough that the user wants it tracked and implemented at the start of this story. Current OpenAI embedding guardrails estimate token counts heuristically from bytes and word count instead of using an OpenAI-compatible tokenizer. That heuristic can undercount code-heavy inputs and allow an oversized chunk to pass local validation, only to fail when OpenAI rejects it with an input-too-large error. Research for this plan confirmed that OpenAI's third-generation embedding models `text-embedding-3-small` and `text-embedding-3-large` both use an 8192-token max input and that OpenAI's own embeddings guidance points to `tiktoken` with `cl100k_base` for accurate token counting. For this repository, the recommended implementation is to replace heuristic counting with tokenizer-backed counting using the Node `tiktoken` package by default, with `js-tiktoken` as a fallback option only if packaging or runtime constraints make the WASM path impractical. The real provider hard limit should stay aligned with OpenAI model truth, while operational headroom should continue to come from the existing ingest chunking safety margin rather than by redefining the upstream max token limit.

Commands and flows can already reference other workflow files, especially command JSON files and markdown instruction files, but the current lookup behavior is rooted too heavily in the repository that owns the flow or command definition. That is technically consistent, but it does not match how a user thinks about the product when they are actively working on one specific repository in the UI.

The intended user experience for this story is different. When a user selects or otherwise works inside a current working repository, that repository should be the first place the product looks for any referenced workflow file. This should apply even when the flow definition itself lives in the local `codeInfo2` repository. For example, if the user is working in `/Users/danielstapleton/Documents/dev/game_repo` and runs a flow from `codeInfo2/flows/flow_1.json`, then a referenced markdown file such as `updated_tests.md` should be searched for in the markdown area of `game_repo` before looking in `codeInfo2` or other repositories.

This story therefore changes reference resolution from an owner-first model to a working-repo-first model. The user has already chosen the intended four-place search order:

- the current working repository;
- the repository that owns the referencing file;
- the local `codeInfo2` repository;
- all other ingested repositories.

This order should be applied consistently for every reference lookup, not only the first one in a run. Nested references must restart the same lookup order for each new lookup. In other words, if a flow resolves a command file and that command later resolves a markdown file, the markdown lookup must again start at the current working repository, then the owner of the referencing command file, then `codeInfo2`, then the remaining repositories. The previous lookup winner must not become an implicit new root for the next lookup unless that winner is also the owner of the file making the new reference.

The story is about deterministic lookup priority and user expectation. It is not about inventing a new free-form path syntax. References should continue to resolve through their established subfolders inside each candidate repository. A command reference should still map to the candidate repository's `codex_agents/<agent>/commands/<commandName>.json` location, and a markdown reference should still map to the candidate repository's `codeinfo_markdown/<relativePath>` location. The change is the repository candidate order, not the subfolder conventions.

This story also needs one explicit contract for duplicate candidates. In common cases the same repository can appear in more than one conceptual position, such as when the current working repository is also the owner of the referencing file, or when the owner of the referencing file is `codeInfo2`. In those cases the runtime should keep the first occurrence and skip later duplicates while preserving the order of the remaining distinct repositories.

Finally, the current working repository must be defined by one stable runtime signal so the server, websocket events, and REST-triggered execution all behave the same way. The chosen canonical identity for this story is the absolute repository root path because that is what the GUI already selects and displays to the user. If the product cannot identify a current working repository for a particular request, lookup should degrade deterministically to the remaining positions in the same order rather than silently inventing a second inconsistent rule. The user has also chosen that the selected current folder must no longer be ephemeral UI state. Agent conversations, chat conversations, flow runs, and command runs should all persist the selected current folder and restore it when the user switches between conversations in the GUI. Existing conversations must also remain editable from the GUI: if the user changes the selected folder path for an existing chat, agent conversation, command run context, or flow run context, that new value should become the saved current working repository for future restores and future reference resolution. However, this editability only applies when the relevant chat, agent conversation, flow run, or command run is not currently in progress. While execution is active, the working folder must be locked against edits so runtime behavior cannot change underneath an in-flight operation. If a saved working-folder path later becomes invalid because it no longer exists or is no longer ingested, the product should clear it automatically and log a warning rather than preserving stale state. Without that persistence, editability, and invalid-path recovery behavior, the new working-repo-first lookup rule would be hard to reason about and would appear to drift unexpectedly between runs.

This story also includes a repository-wide environment-variable normalization pass because current env names are colliding with variables in user repositories. The desired end state is that repository-owned environment variables should use an uppercase `CODEINFO_` namespace, with browser-exposed Vite variables using uppercase `VITE_CODEINFO_` names. This includes updating committed `.env` files, `.env.local` examples and guidance, e2e configuration, docker-compose files, wrappers, and documentation so the product stops depending on generic names that can clash with unrelated repositories. The env rename should ship as one clean cutover once documentation, compose files, wrappers, tests, and committed defaults are updated. The goal is consistent naming and safer overrides, not cosmetic renaming for its own sake.

### Acceptance Criteria

- Every referenced-file lookup for commands and flows uses the same repository candidate order:
  - current working repository;
  - owner of the referencing file;
  - local `codeInfo2` repository;
  - other ingested repositories.
- The lookup order is restarted fresh for every nested reference lookup rather than inheriting the winner of a previous lookup.
- Duplicate repositories are removed while preserving the first applicable position in the four-place order.
- A flow step that references a command file uses the four-place order to choose the repository candidate before applying the existing command subfolder convention.
- A flow step that references a markdown file uses the four-place order to choose the repository candidate before applying the existing markdown subfolder convention.
- A command item that references a markdown file uses the same four-place order, including when that command is being executed from inside a flow.
- Running a local flow from `codeInfo2/flows/<name>.json` while the current working repository is another repo causes referenced commands and markdown files to be searched in the working repository first.
- Running a flow owned by an ingested repository while the current working repository is a different repo still searches the working repository first, then the flow-owner repository second.
- The selected current folder is persisted for agent conversations, chat conversations, flow runs, and command runs and is restored when the user switches between existing conversations in the GUI.
- The canonical stored identity of the current working repository is the absolute repository root path selected in the GUI.
- The GUI allows the user to change the selected current folder for an existing chat conversation, agent conversation, command run context, or flow run context, and the updated folder path is then saved as the new current working repository for that existing record.
- The GUI does not allow the current working repository to be changed while the relevant chat, agent conversation, flow run, or command run is actively in progress; edits are only allowed once execution is completed.
- The persisted current-folder value is the same canonical signal used by the new working-repo-first reference resolver, so UI restoration and runtime lookup cannot disagree about which repository is active.
- If a saved current working repository path no longer exists or is no longer ingested, the product clears the saved value automatically and emits a warning log.
- Existing relative-path safety rules remain in place for command names and markdown paths; this story changes repository candidate priority, not path traversal policy.
- Fallback continues only for not-found outcomes. Higher-priority read, parse, validation, or decode failures remain fail-fast instead of falling through to lower-priority repositories.
- Observability logs and documentation are updated so the selected candidate order and selected repository are visible and understandable during debugging.
- The behavior is documented with at least one nested-reference example that proves the lookup order restarts for each reference hop.
- Repository-owned environment variables are renamed to uppercase `CODEINFO_` names, and Vite browser-facing variables are renamed to uppercase `VITE_CODEINFO_` names.
- The env renaming work updates committed defaults, local override examples, compose files, e2e configuration, wrappers, and documentation so the renamed variables are used consistently across local, compose, and test workflows.
- The env renaming work is a single clean cutover with no temporary dual-read compatibility for old variable names once the coordinated updates are in place.
- OpenAI embedding token counting no longer uses the current byte-and-word heuristic for local guardrails and chunk sizing; it uses tokenizer-backed counting that matches OpenAI tokenization behavior closely enough to prevent avoidable upstream rejections.
- The OpenAI embedding implementation uses a real tokenizer library recommendation that is documented in this story: prefer Node `tiktoken`, with `js-tiktoken` noted only as a fallback if WASM/runtime constraints block the preferred option.
- The OpenAI per-input hard limit remains aligned with provider truth for `text-embedding-3-small` and `text-embedding-3-large` rather than being reduced to an arbitrary lower ceiling, while the existing ingest safety margin continues to provide operational headroom.
- The OpenAI token-counting implementation documents that the existing `INGEST_TOKEN_MARGIN` behavior remains the soft safety mechanism, so developers do not accidentally layer a second hidden hard limit on top of the tokenizer-backed provider truth.
- Oversized OpenAI embedding inputs are classified deterministically as input-too-large failures even when the upstream provider message uses wording such as maximum input length in tokens.
- The OpenAI bug-fix portion of this story is intentionally limited to tokenizer-backed counting, oversized-input classification, and regression coverage; it does not expand into a broader ingest-batching redesign unless a separate story is created later.

### Out Of Scope

- Changing the on-disk subfolder conventions for workflow assets inside a repository.
- Adding brand new reference types beyond the currently supported command and markdown references.
- Inventing a variable-substitution system or a free-form path expression language for workflow files.
- Changing how flow files themselves are listed or discovered unless that is required to surface the chosen current working repository signal.
- Altering the existing fail-fast policy for unreadable or invalid higher-priority candidates.
- Defining a new concept of current working repository separately for each transport or UI surface.
- Renaming operating-system, shell, Docker, Node.js, or toolchain environment variables that are not owned by this repository, such as `HOME`, `PATH`, or `NODE_ENV`.
- Reworking the Playwright manual-testing container networking model in this story beyond any documentation notes needed to explain why it is deferred.
- Broader ingest-batching redesign work beyond the specific OpenAI token-counting bug fix captured in this story.

### Questions

- When no current working repository is available, should lookup skip the first slot entirely and proceed with owner -> `codeInfo2` -> others, or should there be an explicit "no working repo" marker in observability output?
- Should direct command execution outside flows use the command file itself as the owner slot when the command was selected from an ingested repository, even if the current working repository is different?
- Which existing logs and API responses should expose the resolved lookup order so debugging remains easy without requiring deep log inspection?

## Implementation Ideas

- Add one shared repository-candidate builder that accepts:
  - current working repository;
  - owner repository for the referencing file;
  - `codeInfo2` root;
  - remaining ingested repositories;
  and returns a de-duplicated ordered candidate list.
- Replace the current OpenAI byte-and-word token estimator with tokenizer-backed counting via Node `tiktoken` using `cl100k_base` for `text-embedding-3-small` and `text-embedding-3-large`, and keep `js-tiktoken` documented as the fallback option if the preferred package proves impractical in this runtime.
- Keep the provider hard limit aligned with OpenAI's documented 8192-token embedding limit for the two allowlisted models, and continue to rely on the existing ingest safety margin for chunking headroom instead of introducing an arbitrary lower hard limit such as 8000.
- Update OpenAI guardrail and error-mapping coverage so token-overflow failures are blocked locally when possible and are still mapped cleanly if OpenAI returns wording such as maximum input length in tokens.
- Reuse that shared candidate builder in all reference-resolution paths so command lookup and markdown lookup cannot drift apart over time.
- Ensure nested flow -> command -> markdown execution passes both the current working repository and the owner of the immediate referencing file into the shared resolver for each lookup.
- Persist the selected current folder as the absolute repository root path on the relevant records so the GUI can restore it on conversation switch and the runtime can reuse the same canonical value for later runs or resumptions.
- Ensure existing conversations and run contexts can update their saved current folder from the GUI only when execution is complete, with that edited absolute path becoming the canonical working-repo signal used for later restores and later execution.
- Clear invalid saved working-folder paths automatically when they no longer exist or are no longer ingested, and emit a warning log so the fallback is observable during debugging.
- Audit chat, agent, flow, and command execution entrypoints so they all write and read the same current-folder field instead of keeping separate page-local state.
- Keep existing safety guards for command name sanitization, markdown relative paths, and path-within-root checks unchanged.
- Inventory every repository-owned env variable currently used by server, client, compose, wrappers, tests, and docs; rename them to `CODEINFO_` or `VITE_CODEINFO_` as appropriate and update all references in one coordinated pass.
- Add explicit cutover notes and validation coverage for renamed env variables so the clean migration fails clearly if any old names remain in use.
- Extend unit and integration coverage with examples for:
  - local `codeInfo2` flow plus external working repo;
  - ingested flow plus different working repo;
  - nested flow -> command -> markdown lookup order restart;
  - duplicate candidate removal;
  - fail-fast on invalid higher-priority candidate.
- Update `design.md`, `projectStructure.md`, and any route or runtime documentation that currently describes owner-first resolution so the working-repo-first contract becomes the documented source of truth.

## Questions

1. For flows and commands, where should the editable saved working-folder value live: on the owning conversation/thread record, on each individual run record, or on both?
- Why this is important: the data model choice affects how edits are restored, how reruns behave, and whether past runs remain historically accurate after the user changes the folder later.

## Decisions

1. Canonical stored identity of the current working repository
- Question being addressed: What should be the canonical stored identity of the current working repository: the absolute repository root path, the ingested repository id, or both?
- Why this question matters: the runtime, persistence layer, and GUI restoration all need one stable identity so they do not drift or break when repository metadata changes.
- What the answer is: store the absolute repository root path as the canonical identity.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: the GUI already selects and shows the absolute path, so using the same value avoids translation layers and keeps persisted state aligned with what the user actually chose.

2. Editing the working folder while execution is in progress
- Question being addressed: If a user changes the selected working folder while a flow or command is already running, should that change affect only future runs or also affect later steps that have not executed yet in the current in-flight run?
- Why this question matters: this decides whether execution is stable once started or whether runtime behavior can shift underneath an active run.
- What the answer is: do not allow the working folder to be changed while a chat, agent conversation, flow run, or command run is in progress; allow edits only after completion.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: it guarantees stable execution semantics for in-flight work and avoids surprising partial-run behavior changes.

3. Handling saved working-folder paths that become invalid
- Question being addressed: If a saved working-folder path no longer exists or is no longer ingested, should the GUI keep and show the invalid value, clear it automatically, or block execution until the user chooses a replacement?
- Why this question matters: the product needs one predictable recovery behavior so restore, validation, and fallback logic stay understandable instead of silently doing different things in different screens.
- What the answer is: clear the saved value automatically and emit a warning log.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: it removes stale state quickly while still leaving an observable audit trail for debugging and support.

4. Environment-variable rename rollout strategy
- Question being addressed: Should the environment-variable rename include a temporary compatibility window that still reads the old names, or should the story perform a single clean cutover once docs, compose files, wrappers, and tests are updated?
- Why this question matters: this determines rollout risk, migration complexity, and how much temporary compatibility code and documentation debt the story needs to carry.
- What the answer is: perform one clean cutover with no temporary dual-read compatibility once the coordinated updates are ready.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: it avoids dragging old names forward, keeps the rename easy to reason about, and prevents long-lived split behavior between old and new configuration paths.

5. Scope boundary for the OpenAI embedding bug fix
- Question being addressed: Should the OpenAI embedding bug fix in this story be limited to tokenizer-backed counting, oversized-input classification, and regression coverage, or is it also expected to include a broader redesign of ingest batching if accurate counting reveals more request-limit issues?
- Why this question matters: this sets a clear boundary for the emergency bug fix so implementation does not expand unexpectedly into a larger ingest-architecture rewrite.
- What the answer is: keep the bug fix limited to tokenizer-backed counting, oversized-input classification, and regression coverage only.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: it addresses the live bug directly without slowing the story down with broader ingest redesign work that belongs in its own focused scope.
