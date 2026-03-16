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

The story is about deterministic lookup priority and user expectation. It is not about inventing a new free-form path syntax. References should continue to resolve through their established subfolders inside each candidate repository. A command reference should still map to the candidate repository's `codex_agents/<agent>/commands/<commandName>.json` location, and a markdown reference should still map to the candidate repository's `codeinfo_markdown/<relativePath>` location. The change is the repository candidate order, not the subfolder conventions. Direct command execution outside flows follows the same ownership rule: the current working repository remains first, and the repository that owns the selected command file is the owner slot used second for any references that command makes.

This story also needs one explicit contract for duplicate candidates. In common cases the same repository can appear in more than one conceptual position, such as when the current working repository is also the owner of the referencing file, or when the owner of the referencing file is `codeInfo2`. In those cases the runtime should keep the first occurrence and skip later duplicates while preserving the order of the remaining distinct repositories.

Finally, the current working repository must be defined by one stable runtime signal so the server, websocket events, and REST-triggered execution all behave the same way. The chosen canonical identity for this story is the absolute repository root path because that is what the GUI already selects and displays to the user. If the product cannot identify a current working repository for a particular request, lookup should skip the first slot and proceed deterministically with owner -> `codeInfo2` -> others, and observability should explicitly log that no working repository was available for that lookup. The user has also chosen that the selected current folder must no longer be ephemeral UI state. Agent conversations, chat conversations, flow runs, and command runs should all persist the selected current folder and restore it when the user switches between conversations in the GUI. The editable canonical value should live on the owning conversation or thread record for each chat, agent, flow, or command context, while each individual run stores the exact working-folder snapshot that it actually used at run start. Existing conversations must also remain editable from the GUI: if the user changes the selected folder path for an existing chat, agent conversation, command run context, or flow run context, that new value should become the saved current working repository for future restores and future reference resolution. However, this editability only applies when the relevant chat, agent conversation, flow run, or command run is not currently in progress. While execution is active, the working folder must be locked against edits so runtime behavior cannot change underneath an in-flight operation. If a flow creates or uses a child agent conversation, that child conversation should inherit and save the folder path actually used by the flow step so that switching into that agent conversation later shows the same path the flow used. If a saved working-folder path later becomes invalid because it no longer exists or is no longer ingested, the product should clear it automatically and log a warning rather than preserving stale state. Without that persistence, editability, inheritance, invalid-path recovery behavior, and explicit missing-working-repo handling, the new working-repo-first lookup rule would be hard to reason about and would appear to drift unexpectedly between runs.

The user-visible restore behavior should also be treated as explicit scope for this story. When the user switches to an existing chat, agent conversation, flow run context, or command run context, the same current-folder picker already shown in the GUI should immediately show the saved absolute repository path if that path is still valid. If there is no saved path, or if the saved path has been cleared because it is invalid, the picker should show its normal empty or no-folder-selected state rather than a placeholder, stale label, or silently substituted repository. In that empty state the runtime should behave exactly like the missing-working-repository contract described above.

This story also includes a repository-wide environment-variable normalization pass because current env names are colliding with variables in user repositories. The desired end state is that repository-owned environment variables should use an uppercase `CODEINFO_` namespace, with browser-exposed Vite variables using uppercase `VITE_CODEINFO_` names. This includes updating committed `.env` files, `.env.local` examples and guidance, e2e configuration, docker-compose files, wrappers, and documentation so the product stops depending on generic names that can clash with unrelated repositories. The env rename should ship as one clean cutover once documentation, compose files, wrappers, tests, and committed defaults are updated. The goal is consistent naming and safer overrides, not cosmetic renaming for its own sake.

Repository inspection for this story also found three concrete scope facts that should stay explicit when the plan is taskified. First, the current owner-first lookup logic is duplicated in `server/src/flows/service.ts` for flow-to-command resolution and in `server/src/flows/markdownFileResolver.ts` for markdown resolution, so this story is not only a ranking tweak; it should consolidate those ordered-repository rules behind one shared contract so the two paths cannot drift. Second, `working_folder` already exists for agent, flow, and command entrypoints, but chat REST currently does not accept or persist a working-folder field, so the requirement that chat conversations also persist and restore the selected current folder is real net-new scope rather than a small wiring change. Third, OpenAI token heuristics currently drive both preflight guardrails and the OpenAI provider model's `countTokens()` path, while chunking still falls back to whitespace estimates when token counting fails, so the OpenAI bug fix must keep those counting paths aligned instead of patching only one of them.

### Acceptance Criteria

- Every referenced-file lookup for commands and flows uses the same repository candidate order:
  - current working repository;
  - owner of the referencing file;
  - local `codeInfo2` repository;
  - other ingested repositories.
- One shared repository-candidate builder, or an equivalently shared contract in one place, is used by the current flow-command resolver and markdown resolver so both paths consume the same ordered repository list instead of maintaining separate ordering logic.
- The lookup order is restarted fresh for every nested reference lookup rather than inheriting the winner of a previous lookup.
- Duplicate repositories are removed while preserving the first applicable position in the four-place order.
- A flow step that references a command file uses the four-place order to choose the repository candidate before applying the existing command subfolder convention.
- A flow step that references a markdown file uses the four-place order to choose the repository candidate before applying the existing markdown subfolder convention.
- A command item that references a markdown file uses the same four-place order, including when that command is being executed from inside a flow.
- A directly executed command outside a flow uses the same ownership semantics: the current working repository is still searched first, and the repository that owns the selected command file is used as the owner slot second for any referenced files.
- Running a local flow from `codeInfo2/flows/<name>.json` while the current working repository is another repo causes referenced commands and markdown files to be searched in the working repository first.
- Running a flow owned by an ingested repository while the current working repository is a different repo still searches the working repository first, then the flow-owner repository second.
- The selected current folder is persisted for agent conversations, chat conversations, flow runs, and command runs and is restored when the user switches between existing conversations in the GUI.
- Chat conversations fully participate in the working-folder contract even though chat does not currently accept `working_folder`: chat request validation, persistence, restore, and GUI switching all use the same canonical absolute repository root path model used by agents, flows, and commands.
- When the user switches into an existing chat, agent conversation, flow run context, or command run context, the current-folder picker shows the saved absolute repository path before a new run starts; if no valid saved path exists, the picker shows its normal empty or no-folder-selected state.
- The canonical stored identity of the current working repository is the absolute repository root path selected in the GUI.
- The editable saved current-folder value for chats, agents, flows, and commands lives on the owning conversation or thread record, while each run stores the exact working-folder snapshot it used at run start.
- When no current working repository is available, lookup skips the first slot and continues with owner -> `codeInfo2` -> others, and observability makes that missing working-repo condition explicit.
- The GUI allows the user to change the selected current folder for an existing chat conversation, agent conversation, command run context, or flow run context, and the updated folder path is then saved as the new current working repository for that existing record.
- The GUI does not allow the current working repository to be changed while the relevant chat, agent conversation, flow run, or command run is actively in progress; edits are only allowed once execution is completed.
- The persisted current-folder value is the same canonical signal used by the new working-repo-first reference resolver, so UI restoration and runtime lookup cannot disagree about which repository is active.
- When a flow creates or uses an agent conversation, that child conversation is initialized with the exact folder path used by the flow step so that later restoring that agent conversation shows the actual path that was in effect.
- If a saved current working repository path no longer exists or is no longer ingested, the product clears the saved value automatically and emits a warning log.
- When a saved current working repository path is cleared because it is invalid, the clear happens before the next restore or run uses that value, the GUI returns to its normal empty or no-folder-selected state, and the warning log includes the stale path plus the owning record type and id.
- Existing relative-path safety rules remain in place for command names and markdown paths; this story changes repository candidate priority, not path traversal policy.
- Fallback continues only for not-found outcomes. Higher-priority read, parse, validation, or decode failures remain fail-fast instead of falling through to lower-priority repositories.
- Observability logs and documentation are updated so the selected candidate order and selected repository are visible and understandable during debugging.
- Structured server-side lookup logs are the canonical debugging surface for reference resolution and include, at minimum, the reference type, referencing file, current working repository when present, owner repository, ordered candidate list, selected repository, whether fallback occurred, and whether the working-repo slot was unavailable.
- Execution metadata for runs or steps includes a compact lookup summary that exposes, at minimum, the final selected repository path, whether fallback occurred, and whether a working repository was available for that lookup; when useful, it may also include the ordered candidate repository path list. General high-level API responses remain focused and are not broadly expanded with verbose lookup internals.
- The behavior is documented with at least one nested-reference example that proves the lookup order restarts for each reference hop.
- Repository-owned environment variables are renamed to uppercase `CODEINFO_` names, and Vite browser-facing variables are renamed to uppercase `VITE_CODEINFO_` names.
- The env renaming work updates committed defaults, local override examples, compose files, e2e configuration, wrappers, and documentation so the renamed variables are used consistently across local, compose, and test workflows.
- The env renaming work is a single clean cutover with no temporary dual-read compatibility for old variable names once the coordinated updates are in place.
- After the env rename cutover, no checked-in repository-owned file should still reference the old generic environment-variable names; repo-wide search should only find the new `CODEINFO_` and `VITE_CODEINFO_` names for product-owned variables.
- The env rename inventory explicitly includes currently unprefixed repository-owned families that are already checked in today, including chat-default variables, ingest settings, LM Studio base URL settings, OpenAI embedding credentials, log-config variables, and browser-exposed client variables, so tasking does not silently leave legacy product-owned names behind.
- OpenAI embedding token counting no longer uses the current byte-and-word heuristic for local guardrails and chunk sizing; it uses tokenizer-backed counting that matches OpenAI tokenization behavior closely enough to prevent avoidable upstream rejections.
- The OpenAI embedding implementation uses a real tokenizer library recommendation that is documented in this story: prefer Node `tiktoken`, with `js-tiktoken` noted only as a fallback if WASM/runtime constraints block the preferred option.
- The OpenAI per-input hard limit is corrected from the current local 8191-token constant to the provider-truth 8192-token limit for `text-embedding-3-small` and `text-embedding-3-large`, while the existing ingest safety margin continues to provide operational headroom.
- The OpenAI token-counting implementation documents that the existing `INGEST_TOKEN_MARGIN` behavior remains the soft safety mechanism, so developers do not accidentally layer a second hidden hard limit on top of the tokenizer-backed provider truth.
- Oversized OpenAI embedding inputs are classified deterministically as input-too-large failures even when the upstream provider message uses wording such as maximum input length in tokens.
- The OpenAI bug-fix portion of this story is intentionally limited to tokenizer-backed counting, oversized-input classification, and regression coverage; it does not expand into a broader ingest-batching redesign unless a separate story is created later.
- Tokenizer-backed OpenAI counting replaces the current heuristic everywhere that heuristic currently influences OpenAI ingest decisions in this repository, including local oversized-input checks, chunk-sizing decisions, and regression coverage for overflow handling.
- Tokenizer-backed counting replaces the current OpenAI heuristic in both `validateOpenAiEmbeddingGuardrails(...)` and the OpenAI provider model's `countTokens(...)` path so preflight blocking and chunk sizing cannot disagree about whether a chunk or request is too large.
- Any Node/TypeScript tokenizer package introduced for this story has explicit lifecycle handling documented in the implementation notes and code comments where needed, such as safe encoder reuse and/or required `free()` cleanup, so long-running ingest execution does not leak tokenizer resources across runs.

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
- Start the repository-order refactor from the current owner-first builders in `server/src/flows/service.ts` and `server/src/flows/markdownFileResolver.ts` so both current resolution paths migrate to the same helper rather than receiving parallel hand-edited ordering changes.
- Ensure nested flow -> command -> markdown execution passes both the current working repository and the owner of the immediate referencing file into the shared resolver for each lookup.
- Ensure direct command execution passes the selected command file's owning repository into the same resolver as the owner slot so standalone commands behave consistently with flow-invoked commands.
- Persist the selected current folder as the absolute repository root path on the owning conversation or thread records so the GUI can restore it on conversation switch and the runtime can reuse the same canonical value for later runs or resumptions.
- Extend the chat REST validation and persistence path because `server/src/routes/chat.ts` does not currently accept `working_folder`, even though the story requires chat conversations to share the same saved current-folder behavior as agents, flows, and commands.
- Stamp each run record with the exact working-folder path used at run start so historical execution remains inspectable even after the editable conversation-level value changes later.
- Ensure existing conversations and run contexts can update their saved current folder from the GUI only when execution is complete, with that edited absolute path becoming the canonical working-repo signal used for later restores and later execution.
- Ensure flow-created or flow-linked child agent conversations inherit the folder path actually used by the flow step so cross-navigation between the flow and child agent conversation restores the same path.
- Clear invalid saved working-folder paths automatically when they no longer exist or are no longer ingested, and emit a warning log so the fallback is observable during debugging.
- Audit chat, agent, flow, and command execution entrypoints so they all write and read the same current-folder field instead of keeping separate page-local state.
- Add structured lookup logging and compact execution metadata summaries so the candidate order, selected repository, fallback behavior, and missing-working-repo cases are observable without overloading unrelated high-level API responses.
- Treat the current-folder picker's empty state as the only valid missing-working-repository UI state; do not invent a substitute repository label or a hidden fallback selection when no valid saved path exists.
- Keep existing safety guards for command name sanitization, markdown relative paths, and path-within-root checks unchanged.
- Inventory every repository-owned env variable currently used by server, client, compose, wrappers, tests, and docs; rename them to `CODEINFO_` or `VITE_CODEINFO_` as appropriate and update all references in one coordinated pass.
- Validate the env rename with a repo-wide search before closing the story so no checked-in product-owned files still reference the old generic names.
- Add explicit cutover notes and validation coverage for renamed env variables so the clean migration fails clearly if any old names remain in use.
- Implement the OpenAI tokenizer swap behind one helper that both guardrails and the OpenAI embedding model can call, so `validateOpenAiEmbeddingGuardrails(...)`, `ProviderEmbeddingModel.countTokens(...)`, and chunk-sizing logic all stay in sync.
- If the chosen Node tokenizer requires manual cleanup, centralize that cleanup in one OpenAI tokenizer helper instead of scattering `free()` calls across guardrails, provider, and chunker code.
- Extend unit and integration coverage with examples for:
  - local `codeInfo2` flow plus external working repo;
  - ingested flow plus different working repo;
  - nested flow -> command -> markdown lookup order restart;
  - duplicate candidate removal;
  - fail-fast on invalid higher-priority candidate.
- Update `design.md`, `projectStructure.md`, and any route or runtime documentation that currently describes owner-first resolution so the working-repo-first contract becomes the documented source of truth.

## Research Findings

1. Current reference resolution is owner-first in two different places
- `server/src/flows/service.ts` currently builds flow-command candidates with `same_source -> codeInfo2 -> others`.
- `server/src/flows/markdownFileResolver.ts` separately builds markdown candidates with the same owner-first shape.
- This confirms story 48 should explicitly consolidate repository ordering into one shared helper or contract rather than editing the two orderings independently.

2. Working-folder support is uneven across surfaces today
- `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, and `server/src/routes/flowsRun.ts` already validate and forward `working_folder`.
- `server/src/routes/chat.ts` does not currently accept a `working_folder` field even though the plan says chat conversations must persist and restore the selected current folder.
- This means chat support is a real scope item for story 48 and should not be treated as already solved infrastructure.

3. The env rename needs a concrete inventory because the repo still mixes namespacing styles
- The repo already uses many `CODEINFO_*` variables, but checked-in files still also rely on unprefixed product-owned names such as `LMSTUDIO_BASE_URL`, `OPENAI_EMBEDDING_KEY`, `INGEST_*`, `CHAT_DEFAULT_*`, `LOG_*`, `VITE_API_URL`, and `VITE_LMSTUDIO_URL`.
- Story 48 should therefore treat the env rename as an explicit inventory-and-cutover task, not as a quick search/replace on a few obvious files.

4. The OpenAI bug fix must cover more than one counting call site
- `server/src/ingest/providers/openaiGuardrails.ts` still uses the byte-and-word heuristic `estimateOpenAiTokens(...)`.
- `server/src/ingest/providers/openaiEmbeddingProvider.ts` exposes the same heuristic through the OpenAI model's `countTokens(...)`.
- `server/src/ingest/chunker.ts` uses `model.countTokens(...)` for chunk sizing and still falls back to whitespace estimates on token-count failures.
- This confirms the tokenizer work must keep guardrails, OpenAI model counting, and chunk sizing aligned or the story will leave one of the failure paths behind.

5. External tokenizer evidence changes one implementation detail that should be visible during tasking
- Official OpenAI documentation says `text-embedding-3-small` and `text-embedding-3-large` support up to 8192 input tokens.
- Context7 documentation for the current JavaScript `tiktoken` package shows Node/TypeScript usage and notes that encoder instances may require explicit `free()` cleanup.
- Story 48 should therefore treat encoder lifecycle handling as part of the implementation contract, not as an afterthought discovered during coding.

## Questions
- No Further Questions

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

6. Where the editable saved working-folder value lives for flows and commands
- Question being addressed: For flows and commands, where should the editable saved working-folder value live: on the owning conversation/thread record, on each individual run record, or on both?
- Why this question matters: the data model choice affects how edits are restored, how reruns behave, and whether past runs remain historically accurate after the user changes the folder later.
- What the answer is: keep the editable canonical value on the owning conversation or thread record, and also store the exact working-folder snapshot on each individual run record at run start. When a flow creates or uses a child agent conversation, initialize that child conversation with the same folder path the flow step actually used.
- Where the answer came from: user discussion and confirmation in this planning conversation on 2026-03-16, incorporating the implementation recommendation raised during the conversation.
- Why it is the best answer: it matches the GUI editing model, preserves accurate historical execution data, and ensures that switching into a child agent conversation created by a flow shows the actual folder path that was used.

7. Missing current working repository fallback behavior
- Question being addressed: When no current working repository is available for a lookup, should resolution simply skip the first slot and continue with owner -> `codeInfo2` -> others, and should observability explicitly log that no working repository was available?
- Why this question matters: the runtime needs one deterministic fallback rule for missing current-folder state, and debugging will be much easier if the missing first slot is visible rather than silent.
- What the answer is: yes. Skip the first slot, continue with owner -> `codeInfo2` -> others, and emit observability that explicitly records that no current working repository was available.
- Where the answer came from: user decision in this planning conversation on 2026-03-16.
- Why it is the best answer: it keeps lookup deterministic without inventing a fake working repo, while still making the degraded behavior obvious during debugging.

8. Direct command ownership semantics outside flows
- Question being addressed: For direct command execution outside flows, if a command is selected from an ingested repository while the current working repository is different, should the command's own repository always be treated as the owner slot for lookup?
- Why this question matters: direct commands need the same owner semantics as flows, otherwise command lookup behavior could diverge in subtle ways that are hard for users to predict.
- What the answer is: yes. The current working repository stays first, and the repository that owns the selected command file becomes the owner slot second for any references that direct command resolves.
- Where the answer came from: user decision in this planning conversation on 2026-03-16 after reviewing a concrete example.
- Why it is the best answer: it keeps standalone command behavior aligned with flow behavior and matches the mental model that the referencing file still contributes the owner slot even when the current working repository is different.

9. Observability surfaces for lookup resolution
- Question being addressed: Which logs or API responses should expose the candidate lookup order and the selected repository so debugging remains easy without requiring deep log inspection?
- Why this question matters: this story changes core lookup behavior, so support and development workflows need a clear and consistent place to see why a particular repository won.
- What the answer is: structured server-side lookup logs are the canonical full debugging surface, and execution metadata for runs or steps includes a compact lookup summary with the final selected repository and, where useful, the candidate order. General high-level API responses should not be broadly expanded with verbose lookup internals.
- Where the answer came from: user decision in this planning conversation on 2026-03-16 after reviewing the proposed observability approach.
- Why it is the best answer: it gives developers and support clear debugging data without cluttering every high-level response contract with low-level lookup details.
