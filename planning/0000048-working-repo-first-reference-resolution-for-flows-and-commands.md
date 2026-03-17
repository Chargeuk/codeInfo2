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

The persistence side of this story should also use the repository's existing product nouns instead of inventing new storage concepts. In this codebase, chats, direct agent runs, direct command runs, and flows all persist against the existing `Conversation` record in `server/src/mongo/conversation.ts`. A direct command run does not create a separate command-specific collection or command-specific conversation type; it runs inside the owning agent conversation. A top-level flow run uses a flow conversation, and a flow-created child agent conversation remains a normal agent conversation. Story 48 should therefore extend the current conversation and turn storage shapes rather than creating a new working-folder table, command-run collection, or alternate persistence path just for this feature.

This story also needs one explicit contract for duplicate candidates. In common cases the same repository can appear in more than one conceptual position, such as when the current working repository is also the owner of the referencing file, or when the owner of the referencing file is `codeInfo2`. In those cases the runtime should keep the first occurrence and skip later duplicates while preserving the order of the remaining distinct repositories.

Finally, the current working repository must be defined by one stable runtime signal so the server, websocket events, and REST-triggered execution all behave the same way. The chosen canonical identity for this story is the absolute repository root path because that is what the GUI already selects and displays to the user. If the product cannot identify a current working repository for a particular request, lookup should skip the first slot and proceed deterministically with owner -> `codeInfo2` -> others, and observability should explicitly log that no working repository was available for that lookup. The user has also chosen that the selected current folder must no longer be ephemeral UI state. Agent conversations, chat conversations, flow conversations, and direct agent command runs should all persist the selected current folder and restore it when the user switches between conversations in the GUI. The editable canonical value should live on the owning conversation record for each chat, agent, flow, or direct-command surface, while each individual run stores the exact working-folder snapshot that it actually used at run start. Existing conversations must also remain editable from the GUI: if the user changes the selected folder path for an existing chat conversation, agent conversation, or flow conversation, that new value should become the saved current working repository for future restores and future reference resolution. For direct command execution, that same edit happens on the owning agent conversation because direct commands do not have their own separate conversation type. Repository inspection for this story confirmed that the current code does not already expose a dedicated idle-edit REST surface for updating `flags.workingFolder` on an existing conversation, so story 48 must add that server contract and the matching client call path rather than assuming the current list/create/run endpoints already support mid-conversation edits. However, this editability only applies when the relevant chat, agent conversation, flow conversation, or direct command run is not currently in progress. While execution is active, the working folder must be locked against edits so runtime behavior cannot change underneath an in-flight operation. If a flow creates or uses a child agent conversation, that child conversation should inherit and save the folder path actually used by the flow step so that switching into that agent conversation later shows the same path the flow used. If a saved working-folder path later becomes invalid because it no longer exists or is no longer ingested, the product should clear it automatically and log a warning rather than preserving stale state. Without that persistence, editability, inheritance, invalid-path recovery behavior, and explicit missing-working-repo handling, the new working-repo-first lookup rule would be hard to reason about and would appear to drift unexpectedly between runs.

The user-visible restore behavior should also be treated as explicit scope for this story. When the user switches to an existing chat conversation, agent conversation, or flow conversation, the same current-folder picker already shown in the GUI should immediately show the saved absolute repository path if that path is still valid. For direct command execution, the picker should restore from the owning agent conversation because there is no separate command conversation to restore. If there is no saved path, or if the saved path has been cleared because it is invalid, the picker should show its normal empty or no-folder-selected state rather than a placeholder, stale label, or silently substituted repository. In that empty state the runtime should behave exactly like the missing-working-repository contract described above.

This story also includes a repository-wide environment-variable normalization pass because current env names are colliding with variables in user repositories. The desired end state is that repository-owned environment variables should use an uppercase `CODEINFO_` namespace, with browser-exposed Vite variables using uppercase `VITE_CODEINFO_` names. This includes updating committed `.env` files, `.env.local` examples and guidance, e2e configuration, docker-compose files, wrappers, and documentation so the product stops depending on generic names that can clash with unrelated repositories. The env rename should ship as one clean cutover once documentation, compose files, wrappers, tests, and committed defaults are updated. The goal is consistent naming and safer overrides, not cosmetic renaming for its own sake.

For this story, the env cutover target names should be treated as explicit scope rather than something left for implementation-time interpretation. The currently checked-in product-owned server names should move to the following `CODEINFO_` forms at minimum: `LMSTUDIO_BASE_URL -> CODEINFO_LMSTUDIO_BASE_URL`, `OPENAI_EMBEDDING_KEY -> CODEINFO_OPENAI_EMBEDDING_KEY`, `CHAT_DEFAULT_PROVIDER -> CODEINFO_CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL -> CODEINFO_CHAT_DEFAULT_MODEL`, `INGEST_INCLUDE -> CODEINFO_INGEST_INCLUDE`, `INGEST_EXCLUDE -> CODEINFO_INGEST_EXCLUDE`, `INGEST_TOKEN_MARGIN -> CODEINFO_INGEST_TOKEN_MARGIN`, `INGEST_FALLBACK_TOKENS -> CODEINFO_INGEST_FALLBACK_TOKENS`, `INGEST_FLUSH_EVERY -> CODEINFO_INGEST_FLUSH_EVERY`, `INGEST_COLLECTION -> CODEINFO_INGEST_COLLECTION`, `INGEST_ROOTS_COLLECTION -> CODEINFO_INGEST_ROOTS_COLLECTION`, `LOG_FILE_PATH -> CODEINFO_LOG_FILE_PATH`, `LOG_LEVEL -> CODEINFO_LOG_LEVEL`, `LOG_BUFFER_MAX -> CODEINFO_LOG_BUFFER_MAX`, `LOG_MAX_CLIENT_BYTES -> CODEINFO_LOG_MAX_CLIENT_BYTES`, and `LOG_INGEST_WS_THROTTLE_MS -> CODEINFO_LOG_INGEST_WS_THROTTLE_MS`. Browser-facing names should move to `VITE_CODEINFO_` forms at minimum where there is a checked-in runtime or build-time consumer: `VITE_API_URL -> VITE_CODEINFO_API_URL`, `VITE_LMSTUDIO_URL -> VITE_CODEINFO_LMSTUDIO_URL`, `VITE_LOG_FORWARD_ENABLED -> VITE_CODEINFO_LOG_FORWARD_ENABLED`, and `VITE_LOG_MAX_BYTES -> VITE_CODEINFO_LOG_MAX_BYTES`. Repository inspection for story 48 also confirmed that `VITE_LOG_LEVEL` and `VITE_LOG_STREAM_ENABLED` currently appear only in documentation, not in checked-in runtime code, so this story should clean up or rename those documentation references rather than inventing new client readers just to satisfy the env cutover. If checked-in test helpers still depend on repo-owned env names such as `INGEST_TEST_GIT_PATHS`, they should follow the same prefix rule in the same cutover rather than being left behind as a hidden legacy exception.

Repository inspection for this story also found five concrete scope facts that should stay explicit when the plan is taskified. First, the current owner-first lookup logic is duplicated in `server/src/flows/service.ts` for flow-to-command resolution and in `server/src/flows/markdownFileResolver.ts` for markdown resolution, so this story is not only a ranking tweak; it should consolidate those ordered-repository rules behind one shared contract so the two paths cannot drift. Second, `working_folder` already exists for agent, flow, and command entrypoints, but chat REST currently does not accept or persist a working-folder field, so the requirement that chat conversations also persist and restore the selected current folder is real net-new scope rather than a small wiring change. Third, the current repository does not expose a dedicated conversation-meta edit route for saving `flags.workingFolder` on an existing idle conversation, so story 48 must add that contract instead of assuming the current list/create/run routes can already do it. Fourth, `VITE_LOG_LEVEL` and `VITE_LOG_STREAM_ENABLED` currently appear only in documentation rather than checked-in runtime code, so the env cutover should treat them as documentation cleanup unless a real consumer is intentionally added. Fifth, OpenAI token heuristics currently drive both preflight guardrails and the OpenAI provider model's `countTokens()` path, while chunking still falls back to whitespace estimates when token counting fails, so the OpenAI bug fix must keep those counting paths aligned instead of patching only one of them.

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
- The selected current folder is persisted for agent conversations, chat conversations, and flow conversations, and direct command execution reuses the saved folder on its owning agent conversation; the saved folder is restored when the user switches between existing conversations in the GUI.
- Direct agent command runs persist their editable saved working folder on the existing owning agent conversation record; this story does not introduce a separate command-conversation type or command-only storage record.
- Top-level flow runs persist their editable saved working folder on the existing flow conversation record, and any child agent conversation created or resumed by that flow persists the inherited folder on that child agent conversation record.
- Chat conversations fully participate in the working-folder contract even though chat does not currently accept `working_folder`: chat request validation, persistence, restore, and GUI switching all use the same canonical absolute repository root path model used by agents, flows, and commands.
- When the user switches into an existing chat conversation, agent conversation, or flow conversation, the current-folder picker shows the saved absolute repository path before a new run starts; for direct command execution, the picker restores from the owning agent conversation; if no valid saved path exists, the picker shows its normal empty or no-folder-selected state.
- The canonical stored identity of the current working repository is the absolute repository root path selected in the GUI.
- The editable saved current-folder value for chats, agents, and flows lives on the owning conversation record, and direct command execution reuses the owning agent conversation record, while each run stores the exact working-folder snapshot it used at run start.
- When no current working repository is available, lookup skips the first slot and continues with owner -> `codeInfo2` -> others, and observability makes that missing working-repo condition explicit.
- The GUI allows the user to change the selected current folder for an existing chat conversation, agent conversation, or flow conversation, and the updated folder path is then saved as the new current working repository for that existing record; direct command execution uses the saved folder from the owning agent conversation.
- The GUI does not allow the current working repository to be changed while the relevant chat, agent conversation, flow run, or command run is actively in progress; edits are only allowed once execution is completed.
- The persisted current-folder value is the same canonical signal used by the new working-repo-first reference resolver, so UI restoration and runtime lookup cannot disagree about which repository is active.
- When a flow creates or uses an agent conversation, that child conversation is initialized with the exact folder path used by the flow step so that later restoring that agent conversation shows the actual path that was in effect.
- If a saved current working repository path no longer exists or is no longer ingested, the product clears the saved value automatically and emits a warning log.
- When a saved current working repository path is cleared because it is invalid, the clear happens before the next restore or run uses that value, the GUI returns to its normal empty or no-folder-selected state, and the warning log includes the stale path plus the owning record type and id.
- Existing relative-path safety rules remain in place for command names and markdown paths; this story changes repository candidate priority, not path traversal policy.
- Fallback continues only for not-found outcomes. Higher-priority read, parse, validation, or decode failures remain fail-fast instead of falling through to lower-priority repositories.
- Observability logs and documentation are updated so the selected candidate order and selected repository are visible and understandable during debugging.
- Structured server-side lookup logs are the canonical debugging surface for reference resolution and include, at minimum, the reference type, referencing file, current working repository when present, owner repository, ordered candidate list, selected repository, whether fallback occurred, and whether the working-repo slot was unavailable.
- Execution metadata for runs or steps includes a compact lookup summary that exposes the final selected repository path, whether fallback occurred, and whether a working repository was available for that lookup. General high-level API responses remain focused and are not broadly expanded with verbose lookup internals.
- The behavior is documented with at least one nested-reference example that proves the lookup order restarts for each reference hop.
- Repository-owned environment variables are renamed to uppercase `CODEINFO_` names, and Vite browser-facing variables are renamed to uppercase `VITE_CODEINFO_` names.
- The env renaming work updates committed defaults, local override examples, compose files, e2e configuration, wrappers, and documentation so the renamed variables are used consistently across local, compose, and test workflows.
- The env renaming work is a single clean cutover with no temporary dual-read compatibility for old variable names once the coordinated updates are in place.
- After the env rename cutover, no checked-in repository-owned file should still reference the old generic environment-variable names; repo-wide search should only find the new `CODEINFO_` and `VITE_CODEINFO_` names for product-owned variables.
- The env rename inventory explicitly includes currently unprefixed repository-owned families that are already checked in today, including chat-default variables, ingest settings, LM Studio base URL settings, OpenAI embedding credentials, log-config variables, and browser-exposed client variables, so tasking does not silently leave legacy product-owned names behind.
- The env cutover target names are defined up front in this plan and should be implemented exactly unless a checked-in file proves an additional repo-owned variable also needs the same prefix treatment.
- OpenAI embedding token counting no longer uses the current byte-and-word heuristic for local guardrails and chunk sizing; it uses tokenizer-backed counting that matches OpenAI tokenization behavior closely enough to prevent avoidable upstream rejections.
- The OpenAI embedding implementation uses a real tokenizer library recommendation that is documented in this story: prefer Node `tiktoken`, with `js-tiktoken` noted only as a fallback if WASM/runtime constraints block the preferred option.
- The OpenAI per-input hard limit is corrected from the current local 8191-token constant to the provider-truth 8192-token limit for `text-embedding-3-small` and `text-embedding-3-large`, while the existing ingest safety margin continues to provide operational headroom.
- The OpenAI token-counting implementation documents that the current token-margin behavior remains the soft safety mechanism after the env rename cutover, so developers do not accidentally layer a second hidden hard limit on top of the tokenizer-backed provider truth.
- Oversized OpenAI embedding inputs are classified deterministically as input-too-large failures even when the upstream provider message uses wording such as maximum input length in tokens.
- The OpenAI bug-fix portion of this story is intentionally limited to tokenizer-backed counting, oversized-input classification, and regression coverage; it does not expand into a broader ingest-batching redesign unless a separate story is created later.
- Tokenizer-backed OpenAI counting replaces the current heuristic everywhere that heuristic currently influences OpenAI ingest decisions in this repository, including local oversized-input checks, chunk-sizing decisions, and regression coverage for overflow handling.
- Tokenizer-backed counting replaces the current OpenAI heuristic in both `validateOpenAiEmbeddingGuardrails(...)` and the OpenAI provider model's `countTokens(...)` path so preflight blocking and chunk sizing cannot disagree about whether a chunk or request is too large.
- Once tokenizer-backed OpenAI counting is introduced, OpenAI-specific ingest paths do not silently fall back to the old heuristic or to whitespace estimation when tokenizer setup or counting fails; those OpenAI paths should fail closed with a clear error unless the story's documented fallback implementation has already supplied an equivalent tokenizer-backed counter.
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

## Expected Outcomes

- A user who selects a working repository in the UI sees referenced command and markdown files resolve from that repository first, even when the flow or command definition itself lives in `codeInfo2` or another ingested repository.
- Switching between existing chat, agent, and flow conversations restores the same saved working-folder path the user last chose for that conversation, unless the path has since become invalid.
- Direct agent command execution behaves like the rest of the product instead of acting like a separate persistence surface: it restores and saves the folder on the owning agent conversation, and its reference lookups follow the same working-repo-first order.
- When a saved working folder is missing or invalid, the UI returns to its normal empty state, the server clears the stale value before reuse, and logs make the reason visible.
- Developers debugging lookup behavior can see the candidate order, selected repository, and fallback behavior in structured logs and compact runtime metadata without needing to infer the winner from file-system side effects.
- After the env rename cutover, checked-in product code, wrappers, compose files, tests, and docs all speak the same `CODEINFO_` / `VITE_CODEINFO_` language with no lingering generic aliases.
- OpenAI ingest rejects oversized inputs based on tokenizer-backed counting before sending avoidable bad requests upstream, and the chunker no longer silently hides tokenizer failures behind heuristic undercounting.

## Edge Cases And Failure Modes

- Duplicate repository identities are expected and must not create duplicate candidate attempts. If the working repository, owner repository, or `codeInfo2` resolve to the same absolute path, the runtime keeps only the first occurrence and preserves the remaining order.
- Missing-working-folder state is a valid runtime state, not an error. The resolver skips the working slot, continues with owner -> `codeInfo2` -> others, and records that the working slot was unavailable.
- Invalid saved-folder state is not allowed to survive into restore or execution. Before the next restore or run uses the value, the server clears it, emits a warning, and the client returns to the normal empty picker state.
- Fail-fast behavior still applies to higher-priority repositories. If a higher-priority candidate is found but is unreadable, undecodable, or schema-invalid, the runtime stops there instead of silently falling through to lower-priority repositories. Concretely, a command file that exists but fails schema validation in `server/src/flows/service.ts`, or a markdown file that exists but fails UTF-8 decode in `server/src/flows/markdownFileResolver.ts`, must stop resolution at that candidate.
- Nested reference resolution must restart from the same four-place order for each hop. A repository that won an earlier lookup does not become the new root unless it is also the owner of the next referencing file.
- Direct command execution is a special lookup surface but not a special persistence model. The selected command file contributes the owner slot for resolution, while the owning agent conversation remains the place where the editable saved folder is restored and updated.
- Conversation `flags` are currently stored as a Mongoose `Mixed` object. Story 48 must therefore update `flags.workingFolder` in a way that is guaranteed to persist, either by replacing the `flags` object through the existing repo helpers or by explicitly marking the path modified if any document-level mutation path is introduced.
- Memory persistence is already a supported degraded/runtime-test mode via `server/src/chat/memoryPersistence.ts`. Story 48 must keep Mongo-backed and memory-backed behavior aligned for saved working-folder restore, invalid-path clearing, flow-state additions, and any new turn/runtime metadata so tests and degraded runtime do not tell a different story from Mongo mode.
- OpenAI tokenizer failures must be visible and must not degrade back to the old heuristic or whitespace estimate once this story lands. In OpenAI ingest paths, tokenizer setup/counting failures should surface as clear ingest errors unless an equivalent tokenizer-backed fallback has been intentionally implemented.
- OpenAI guardrails still need to preserve the existing non-token failure behavior after the tokenizer change. Blank inputs, max-input-count limits, and max-total-token limits must continue to fail deterministically instead of being weakened while the counting path is replaced.
- Env rename drift is a real failure mode for this story. A partial cutover that leaves checked-in tests, Dockerfile args, compose env wiring, or docs on the old names should be treated as incomplete rather than acceptable.
- Client runtime config is part of that env cutover risk. `client/src/api/baseUrl.ts` and `client/entrypoint.sh` currently support runtime injection plus legacy `VITE_API_URL` fallback paths, so the story must update build-time and runtime config injection together; otherwise the UI can keep booting with a stale API URL even after source code env readers were renamed.

### Questions

## Implementation Ideas

### 1. Shared Working-Repo-First Resolver

- Start from the two current owner-first builders:
  - `server/src/flows/service.ts` `buildFlowCommandCandidates(...)` for flow -> command resolution.
  - `server/src/flows/markdownFileResolver.ts` `buildMarkdownResolutionCandidates(...)` for markdown resolution.
- Replace those duplicated order builders with one shared helper, likely under `server/src/flows/`, that accepts:
  - saved current working repository path;
  - owner repository path of the referencing file;
  - local `codeInfo2` root;
  - remaining ingested repositories.
- The shared helper should return:
  - the de-duplicated ordered repository candidate list;
  - a flag showing whether the working-repository slot was present or skipped;
  - structured log metadata that both command and markdown resolution can emit consistently.
- Wire that helper into every lookup path that story 48 changes:
  - flow -> command resolution;
  - flow -> markdown resolution;
  - command -> markdown resolution;
  - direct command execution outside flows.
- Nested lookups must call the shared helper again using the immediate referencing file's owner, not the previous winner.
- Keep all existing safety rules in place while changing only repository priority:
  - command-name validation in `server/src/flows/service.ts`;
  - markdown relative-path and UTF-8 validation in `server/src/flows/markdownFileResolver.ts`;
  - fail-fast behavior for invalid, unreadable, or undecodable higher-priority candidates.

### 2. Persist And Restore Working Folder Across All Surfaces

- Use the owning conversation record as the canonical saved location, most likely `flags.workingFolder`, via `server/src/mongo/conversation.ts` and `server/src/mongo/repo.ts`.
- Keep the current surface ownership model explicit while implementing this:
  - plain chat uses the chat conversation record with no `agentName` and no `flowName`;
  - direct agent instructions and direct agent command runs both persist on the owning agent conversation record;
  - top-level flows persist on the flow conversation record;
  - flow-created child agent conversations persist on the child agent conversation record created from the flow step.
- Add or extend repository helpers so saving the working folder does not overwrite existing `flags.threadId`, `flags.flow`, or other conversation flags.
- Reuse `server/src/agents/service.ts` `resolveWorkingFolderWorkingDirectory(...)` as the server-side validation boundary for absolute-path validation and host-to-container mapping.
- Extend all server entry points that participate in the story so they can read, validate, persist, and reuse the same canonical working-folder signal:
  - `server/src/routes/agentsRun.ts`;
  - `server/src/routes/agentsCommands.ts`;
  - `server/src/routes/flowsRun.ts`;
  - `server/src/routes/chat.ts`, which currently has no `working_folder` support and therefore needs real new work for story 48.
- Stamp each run or step record with the exact working-folder snapshot used at run start so historical executions remain inspectable after later edits.
- Ensure flow-created child agent conversations inherit the exact folder path used by the flow step that created or resumed them.
- On the client, hydrate and persist the picker state from conversation flags instead of page-local memory:
  - `client/src/hooks/useConversations.ts` already exposes conversation `flags`;
  - `client/src/pages/AgentsPage.tsx` and `client/src/pages/FlowsPage.tsx` already manage a working-folder picker and run payloads;
  - `client/src/pages/ChatPage.tsx` will need equivalent support added because chat does not currently participate.
- Lock picker edits while the related run is active by reusing existing run-state signals already present in the pages and stream hooks.
- If the server clears an invalid saved path, the client should return the picker to its normal empty state and never show a silent fallback repository label.

### 3. Env Namespace Cutover

- Perform one explicit inventory of all checked-in repository-owned env families before renaming anything. The current codebase mixes `CODEINFO_*` with older product-owned names.
- Use the explicit target mapping already documented in the Description as the minimum rename set, so implementation is not guessing which checked-in names are in scope.
- The likely server-side rename anchors include:
  - `server/.env` and any checked-in env guidance files;
  - `server/src/config/chatDefaults.ts` for chat-default variables;
  - `server/src/logger.ts` for logging config;
  - `server/src/ingest/config.ts` for ingest settings;
  - routes and services that still read `LMSTUDIO_BASE_URL` or `OPENAI_EMBEDDING_KEY`.
- The likely client-side rename anchors include:
  - `client/src/api/baseUrl.ts`;
  - `client/src/hooks/useLmStudioStatus.ts`;
  - `client/src/logging/transport.ts`;
  - any client tests that still set `VITE_API_URL`, `VITE_LMSTUDIO_URL`, or other unprefixed Vite variables.
- The runtime and packaging rename anchors include:
  - `docker-compose.yml`;
  - `docker-compose.e2e.yml`;
  - `client/Dockerfile`;
  - wrapper scripts such as `scripts/docker-compose-with-env.sh`;
  - e2e specs and test fixtures that set product-owned env vars directly.
- The cutover should be single-pass:
  - add the new `CODEINFO_` / `VITE_CODEINFO_` names;
  - update all consuming code and docs to read only those names;
  - remove old-name reads in the same story.
- Finish the env work with a repo-wide search to prove no checked-in product-owned files still reference the old generic names.
- Treat checked-in tests, e2e helpers, Dockerfile build args, and compose environment wiring as first-class consumers in that search, not as follow-up cleanup.

### 4. OpenAI Tokenizer-Backed Counting

- Introduce one OpenAI tokenizer helper module under `server/src/ingest/providers/` so all OpenAI token counting comes from one place.
- The helper should:
  - prefer the Node `tiktoken` package for `text-embedding-3-small` and `text-embedding-3-large`;
  - use `cl100k_base` or model-based encoding selection as appropriate;
  - document and centralize any required encoder reuse and `free()` cleanup;
  - keep `js-tiktoken` as the documented fallback only if the preferred WASM path proves impractical.
- Replace the current heuristic in all OpenAI-specific call sites that currently influence sizing or request rejection:
  - `server/src/ingest/providers/openaiGuardrails.ts`;
  - `server/src/ingest/providers/openaiEmbeddingProvider.ts` `countTokens(...)`;
  - any chunk-sizing path that relies on the OpenAI model's `countTokens(...)`, including `server/src/ingest/chunker.ts`.
- Do not preserve the current OpenAI whitespace-estimate fallback in `server/src/ingest/chunker.ts` once the tokenizer-backed helper is available. For OpenAI providers, a tokenizer initialization or counting failure should raise a clear ingest error instead of silently reintroducing the undercount bug that this story exists to remove.
- Update `server/src/ingest/providers/openaiConstants.ts` so the local hard limit matches provider truth at 8192 tokens instead of the current 8191 constant.
- Extend `server/src/ingest/providers/openaiErrors.ts` and related classifiers so upstream wording such as `maximum input length` still maps deterministically to `OPENAI_INPUT_TOO_LARGE`.
- Keep the current token-margin behavior from `server/src/ingest/config.ts` as the soft operational headroom after it is renamed into the `CODEINFO_` namespace; do not introduce a second hidden hard limit on top of the tokenizer-backed provider truth.

### 5. Logging, Metadata, And Validation Coverage

- Reuse the existing resolution logs in `server/src/flows/service.ts` and `server/src/flows/markdownFileResolver.ts`, but feed them from the shared resolver output so both surfaces report the same candidate order, winner, fallback status, and working-slot availability.
- Add a compact lookup summary to run or step metadata that exposes:
  - final selected repository path;
  - fallback-used boolean;
  - working-repository-available boolean.
- Extend the most relevant test suites instead of inventing a new harness first:
  - flow and markdown resolution integration tests for working-repo-first nested lookups;
  - working-folder validation and persistence tests for agents, flows, commands, and chat;
  - OpenAI guardrail, provider, and chunker tests for tokenizer-backed counts and 8192-token enforcement;
  - env rename tests for server/runtime/client code paths that currently read legacy names.
- The likely regression suites to extend include:
  - `server/src/test/integration/flows.run.working-folder.test.ts`;
  - `server/src/test/integration/flows.run.command.test.ts`;
  - `server/src/test/unit/openai-provider-guardrails.test.ts`;
  - `client/src/test/agentsPage.workingFolderPicker.test.tsx`;
  - `client/src/test/flowsPage.run.test.tsx`;
  - chat conversation and sidebar tests once chat gains working-folder persistence.
- Close the story by updating `design.md`, `projectStructure.md`, and README sections that still describe owner-first resolution, legacy env names, or the old OpenAI heuristic behavior.

## Test Harnesses

No new test harness type needs to be created for story 48. The repository already has the runner types needed for every planned change in this story, so implementation should extend the existing harnesses instead of inventing a new runner.

1. Server unit and integration harness
- Reuse `npm run test:summary:server:unit`, which is backed by `scripts/test-summary-server-unit.mjs`.
- Place new or expanded server unit tests under `server/src/test/unit/`.
- Place new or expanded server integration tests under `server/src/test/integration/`.
- This harness is the right place for:
  - shared repository-order helper tests;
  - working-folder persistence and invalid-path clearing tests;
  - env rename regression tests for server runtime readers;
  - OpenAI tokenizer, guardrail, provider, and chunk-sizing tests.

2. Server cucumber harness
- Reuse `npm run test:summary:server:cucumber`, which is backed by `scripts/test-summary-server-cucumber.mjs`.
- Add any story-specific feature files under `server/src/test/features/`.
- Add or extend step definitions and shared setup under `server/src/test/steps/` and `server/src/test/support/`.
- No new cucumber harness is needed; use this only if story 48 needs higher-level Gherkin coverage beyond node:test integration coverage.

3. Client test harness
- Reuse `npm run test:summary:client`, which is backed by `scripts/test-summary-client.mjs`.
- Add or extend client tests under `client/src/test/`.
- Place any shared test helpers in `client/src/test/support/`.
- This harness is the right place for:
  - chat, agent, and flow picker restore behavior;
  - locked-picker state while runs are active;
  - cleared invalid-path UI behavior;
  - client env rename regressions for `VITE_CODEINFO_*` readers.

4. Browser e2e harness
- Reuse `npm run test:summary:e2e`, which is backed by `scripts/test-summary-e2e.mjs` and the existing Playwright runner in `playwright.config.ts`.
- Add targeted browser specs under `e2e/`.
- Place any shared e2e helpers or fixtures under `e2e/support/` and `e2e/fixtures/`.
- No custom browser harness is required; the existing Playwright setup already supports the kind of targeted restore-flow and runtime-env validation this story may need.

5. Compose and manual validation harness
- Reuse `npm run compose:build:summary`, `npm run compose:build`, `npm run compose:up`, `npm run compose:down`, and `npm run compose:logs` for containerized validation.
- This existing compose harness is sufficient for manual acceptance checks around working-folder restore, repository resolution visibility, and env cutover behavior.
- If story 48 needs any additional shared test scaffolding, create it inside the existing support directories above rather than introducing a new top-level harness type.

## Contracts And Storage Shapes

Story 48 does require contract and storage-shape changes, but they can be defined up front without introducing a new collection or a separate persistence subsystem. The existing conversation, flow-state, and turn storage already provide the right anchor points.

### 1. Conversation Storage Contract

- Reuse the existing `Conversation.flags` object in `server/src/mongo/conversation.ts` as the canonical persisted location for the selected current working repository.
- Keep the storage owner aligned with the current conversation model instead of inventing a new record type:
  - chats store `flags.workingFolder` on the chat conversation;
  - direct agent instructions and direct agent command runs store `flags.workingFolder` on the agent conversation they already use;
  - top-level flow runs store `flags.workingFolder` on the flow conversation;
  - flow-created child agent conversations store `flags.workingFolder` on the child agent conversation.
- Add one well-known field:
  - `flags.workingFolder?: string`
- `flags.workingFolder` stores the canonical absolute repository root path selected in the GUI.
- If the saved path becomes invalid or is cleared by the user, `flags.workingFolder` should be removed or set to an absent state rather than replaced with a synthetic fallback path.
- This story should not create a separate collection for working-folder persistence because the state belongs to the owning chat, agent, flow, or command conversation and should travel with that conversation's existing `flags`.

### 2. Flow Resume-State Contract

- Extend `FlowResumeState` in `server/src/flows/flowState.ts` so the flow persistence layer can remember the exact folder snapshots used during flow execution.
- The minimal new fields should be:
  - `workingFolder?: string`
  - `agentWorkingFolders?: Record<string, string>`
- `workingFolder` stores the flow conversation's resolved working-folder snapshot for the current or most recent run state.
- `agentWorkingFolders` stores child agent working-folder snapshots keyed consistently with the existing flow-owned child-conversation state, so child agent conversations can restore the exact path the flow used when it created or resumed them.

### 3. Request Contract Changes

- `POST /chat` must add the same optional field already used by agents, commands, and flows:
  - `working_folder?: string`
- `working_folder` in chat requests must use the same absolute-path validation contract and the same error codes already used elsewhere:
  - `WORKING_FOLDER_INVALID`
  - `WORKING_FOLDER_NOT_FOUND`
- Existing request shapes for:
  - `POST /agents/:agentName/run`
  - `POST /agents/:agentName/commands/run`
  - `POST /flows/:flowName/run`
  already include `working_folder?: string` and should keep that field rather than introducing a second alias.
- The client-side request helpers should mirror the same field name across all four surfaces so the server and UI are not translating between multiple working-folder names.

### 4. Response And Conversation-Summary Contract

- High-level run-start responses should remain compact. Story 48 should not add verbose lookup details to the top-level `started` responses from chat, agent, command, or flow routes.
- Conversation list and detail responses can continue to expose the saved working folder through the existing generic `flags` object rather than introducing a new top-level `workingFolder` field on every summary shape.
- The client should therefore restore the selected folder from `conversation.flags.workingFolder` instead of expecting a separate conversation-summary property.

### 5. Turn And Runtime Metadata Contract

- Extend `Turn` storage in `server/src/mongo/turn.ts` with one new optional nested metadata object rather than overloading the existing `command`, `usage`, or `timing` fields.
- The new shape should be:
  - `runtime?: {`
  - `  workingFolder?: string;`
  - `  lookupSummary?: {`
  - `    workingRepositoryAvailable: boolean;`
  - `    selectedRepositoryPath: string;`
  - `    fallbackUsed: boolean;`
  - `  };`
  - `}`
- `runtime.workingFolder` stores the exact resolved folder snapshot used for that persisted turn or step.
- `runtime.lookupSummary` stores the minimal persisted lookup contract the story already requires for runs and steps. The full ordered candidate list remains a structured-log concern rather than a persisted turn concern.
- If a turn or step does not perform reference resolution, `runtime.lookupSummary` may be omitted while `runtime.workingFolder` still records the run snapshot.
- Memory persistence should mirror the same `runtime` shape so in-memory and Mongo-backed execution do not diverge.

### 6. Structured Lookup Log Contract

- The shared resolver log context should use the same core fields as `runtime.lookupSummary` so logs, persisted turn metadata, and flow-step debugging all describe the same contract.
- Each structured lookup log should include:
  - `referenceType`
  - `referencingFile` when available
  - `workingRepositoryPath` when available
  - `workingRepositoryAvailable`
  - `ownerRepositoryPath`
  - `candidateRepositories`
  - `selectedRepositoryPath`
  - `fallbackUsed`
- Markdown resolution logs may additionally include the final resolved file path because that is part of the existing markdown contract.

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

6. Working-folder persistence has to follow the existing conversation ownership model
- `server/src/routes/chat.ts` creates and updates plain chat conversations with no `agentName` or `flowName`.
- `server/src/agents/service.ts` uses agent conversations for both normal agent instructions and direct command execution.
- `server/src/flows/service.ts` creates top-level flow conversations and separate child agent conversations for flow-owned agent steps.
- This means story 48 should define working-folder persistence in terms of those existing conversation records, not in terms of a new generic "command context" record that does not exist in the current schema.

## Questions

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
- Question being addressed: For flows and direct commands, where should the editable saved working-folder value live: on the owning conversation record, on each individual run record, or on both?
- Why this question matters: the data model choice affects how edits are restored, how reruns behave, and whether past runs remain historically accurate after the user changes the folder later.
- What the answer is: keep the editable canonical value on the owning conversation record, and also store the exact working-folder snapshot on each individual run record at run start. For direct commands, that owning conversation is the existing agent conversation. When a flow creates or uses a child agent conversation, initialize that child conversation with the same folder path the flow step actually used.
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

Follow `planning/plan_format.md` and the repository wrapper-first workflow when implementing the tasks below. Work the tasks in order, keep task status accurate, and do not collapse multiple task scopes into one implementation commit.

## Implementation Plan Instructions

This is the execution checklist for the task list below. It should only be used once the story sections above are understood and the developer is ready to start implementation.

1. Read the full story and the task you are starting before touching code so the acceptance criteria, contracts, and edge cases are fresh.
2. Reuse the existing feature branch `feature/48-working-repo-first-reference-resolution-for-flows-and-commands`.
3. Work through the tasks in order. Before touching code for a task, update that task's status to `__in_progress__`, commit that plan-file change, and push it.
4. For each subtask, read the documentation locations listed for that task before editing code.
5. Complete one subtask at a time and tick its checkbox as soon as it is done.
6. After implementation subtasks are complete, run the testing steps for that task in order and tick each checkbox as it passes.
7. After testing passes, complete every documentation subtask for that task and tick each checkbox.
8. When a task is complete, add detailed notes to that task's `Implementation notes` section covering what changed, why it changed, and any issue that had to be solved.
9. Record the task's git commit hashes on the `Git Commits` line, then set the task status to `__done__` and push again.
10. Use the repository build/test wrappers. Only inspect saved logs when a wrapper reports failure, warnings that need review, or `agent_action: inspect_log`.

# Tasks



### 1. Create The Shared Repository Candidate Order Helper

- Task Status: `__done__`
- Git Commits: `bc54fa49, 958b00b4, f6cfa1df`

#### Overview

Create one shared server-side helper that produces the working-repo-first repository candidate order for every reference lookup. This task is only about building and unit-testing the shared ordering contract; it does not yet rewire the existing flow or markdown resolvers to use it.

#### Documentation Locations

- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/path.html`, for `path.resolve(...)`, `path.normalize(...)`, and absolute-path comparison rules used by the shared candidate-order helper
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/fs.html`, for the file and path semantics that the candidate-order tests rely on when building safe repository fixtures
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/process.html#processplatform`, for platform-sensitive path behavior that matters when deduping repository paths case-insensitively

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before editing code, re-read this story's `Description`, `Acceptance Criteria`, `Implementation Ideas`, `Contracts And Storage Shapes`, and `Edge Cases And Failure Modes`, then inspect `server/src/flows/service.ts` `buildFlowCommandCandidates(...)` and `server/src/flows/markdownFileResolver.ts` `buildMarkdownResolutionCandidates(...)`. Write down, in Task 1 `Implementation notes`, the exact slot order this helper must enforce for every lookup: working repository, owner repository, local `codeInfo2`, then other ingested repositories; also note the first-seen dedupe rule and the rule that nested lookups always restart the full order.
2. [x] Create `server/src/flows/repositoryCandidateOrder.ts`. In that new file, export one shared helper that only builds ordered repository candidates; do not move file-reading logic into it. The helper must accept explicit inputs for the working repository path, owner repository path, local `codeInfo2` root, other ingested repository roots from `server/src/lmstudio/toolService.ts` `listIngestedRepositories(...)`, and a small caller or reference-type value that later tasks can use for logging.
3. [x] Implement the helper using the same path-normalization approach already used in `server/src/flows/service.ts` and `server/src/flows/markdownFileResolver.ts`, using `node:path` to resolve absolute paths before comparison. Dedupe case-insensitively in first-seen order using a resolved-path `seen` set or map, preserve the existing order of the `other` repositories exactly as supplied, reuse the current label-normalization patterns from the resolver files instead of inventing a second label format, and define one stable marker name `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER` for later runtime callers to use when logging the final ordered candidate list, caller name, and `workingRepositoryAvailable` value.
4. [x] Keep this task limited to the shared helper and its tests. Do not rewire `server/src/flows/service.ts` or `server/src/flows/markdownFileResolver.ts` to call the helper yet, except for any import-only preparation that does not change runtime behavior; the actual resolver rewiring belongs to Tasks 2 and 3.
5. [x] Add or extend one server unit test in `server/src/test/unit/repositoryCandidateOrder.test.ts` that proves the happy path for normal four-slot ordering: working repository first, owner repository second, local `codeInfo2` third, then other ingested repositories. The purpose of this test is to lock down the core shared ordering contract.
6. [x] Add or extend one server unit test in `server/src/test/unit/repositoryCandidateOrder.test.ts` that proves the missing-working-repository case omits the first slot and starts from the owner repository. The purpose of this test is to cover the documented degraded-mode order in the shared helper itself.
7. [x] Add or extend one server unit test in `server/src/test/unit/repositoryCandidateOrder.test.ts` that proves a working repository path equal to the owner repository is deduped into one candidate. The purpose of this test is to stop duplicate lookup attempts when two slots resolve to the same path.
8. [x] Add or extend one server unit test in `server/src/test/unit/repositoryCandidateOrder.test.ts` that proves an owner repository path equal to local `codeInfo2` is deduped into one candidate. The purpose of this test is to stop duplicate lookup attempts when the owner and local repo are the same path.
9. [x] Add or extend one server unit test in `server/src/test/unit/repositoryCandidateOrder.test.ts` that proves two separate nested-lookup calls each get a fresh candidate order rather than leaking the previous winner. The purpose of this test is to protect the nested restart rule in the shared helper.
10. [x] After all file-adding or file-removal subtasks in Task 1 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including `server/src/flows/repositoryCandidateOrder.ts`, `server/src/test/unit/repositoryCandidateOrder.test.ts`, and any additional support files created or deleted while completing the helper work.
11. [x] Update this story file's Task 1 `Implementation notes` section with the final helper signature, the dedupe approach you chose, and any issue you hit while matching the existing resolver label behavior.
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server-only flow helper code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story contracts plus the current owner-first builders in `server/src/flows/service.ts` and `server/src/flows/markdownFileResolver.ts` before coding.
- The helper for Task 1 must always emit candidates in this slot order: working repository, owner repository, local `codeInfo2`, then other ingested repositories.
- Duplicate repositories must be removed in first-seen order after absolute-path normalization, and every nested lookup must call the helper fresh rather than inheriting any previous lookup winner.
- Added `server/src/flows/repositoryCandidateOrder.ts` as a standalone ordering-only contract so later command and markdown tasks can share candidate generation without pulling file IO or resolver-specific behavior into the helper.
- The helper keeps `otherRepositoryRoots` in the order supplied by the caller, lowercases resolved absolute paths for first-seen dedupe, and exports the required `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER` marker plus a label normalizer that matches the existing basename fallback pattern.
- Added `server/src/test/unit/repositoryCandidateOrder.test.ts` to cover the normal four-slot order, missing working repository, working-owner dedupe, owner-codeInfo2 dedupe, and the per-call nested restart rule.
- Final helper signature: `buildRepositoryCandidateOrder({ caller, workingRepositoryPath, ownerRepositoryPath, ownerRepositoryLabel, codeInfo2Root, otherRepositoryRoots })`, returning `{ caller, workingRepositoryAvailable, candidates }` where each candidate includes `sourceId`, `sourceLabel`, and `slot`.
- Dedupe uses a `Set` keyed by `path.resolve(sourceId).toLowerCase()` so equivalent absolute paths collapse in first-seen order while leaving the supplied `otherRepositoryRoots` tail untouched.
- Matching existing label behavior required keeping the same trimmed-label-or-path-basename fallback pattern without importing the current resolver module, so the helper exports its own compatible label normalizer and avoids a future circular dependency when Task 3 rewires markdown resolution.
- `npm run lint --workspaces` completed with existing import-order warnings elsewhere in the repo but no errors; `npm run format:check --workspaces` initially failed on pre-existing server formatting drift in `server/src/config/runtimeConfig.ts` and `server/src/test/unit/chatModels.codex.test.ts`, so `npm run format --workspaces` was run before the format check passed cleanly.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1220`, `passed: 1220`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.
---


### 2. Apply The Shared Order To Flow And Direct-Command Command Resolution

- Task Status: `__done__`
- Git Commits: `f89f6975, 60df0411, d0db6791`

#### Overview

Rewire the server path that resolves command JSON files so it uses the shared candidate-order helper from Task 1. This task is only about command-file resolution and its logs/metadata, including direct command execution ownership semantics; markdown resolution stays in the next task.

#### Documentation Locations

- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/path.html`, for command-file path resolution and normalized candidate construction
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/fs.html`, for file-read errors and not-found handling that determine when command lookup may fall through to the next repository
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/errors.html`, for distinguishing normal not-found failures from other read or parse failures that must remain fail-fast
- Mermaid documentation via Context7 `/mermaid-js/mermaid` and `https://mermaid.js.org/intro/`, for updating the command-resolution architecture diagram so its syntax and flowchart structure stay valid

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before touching command resolution, re-read this story's `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases And Failure Modes`, then inspect `server/src/flows/service.ts`, `server/src/agents/service.ts`, `server/src/agents/commandsRunner.ts`, and `server/src/agents/commandItemExecutor.ts`. Record in Task 2 `Implementation notes` the four concrete command cases this task must cover: flow-owned commands, local flows from `codeInfo2`, cross-repo flows, and direct command execution outside flows.
2. [x] In `server/src/flows/service.ts`, replace the current owner-first command candidate builder with the helper in `server/src/flows/repositoryCandidateOrder.ts`. That helper must already return candidates in this exact order: selected working repository first, flow-owner repository second, local `codeInfo2` third, then other ingested repositories, with first-seen dedupe on normalized absolute paths. Keep the existing command-name safety checks, `loadCommandForAgent(...)`, and the current fail-fast behavior for any candidate result other than `NOT_FOUND`; this subtask is only about the repository-order source, not about changing how command files are loaded or validated.
3. [x] Still in `server/src/flows/service.ts`, update the existing `DEV_0000040_T11_FLOW_RESOLUTION_ORDER` log output so it reports the shared candidate order, selected repository, `fallbackUsed`, and `workingRepositoryAvailable`. In the same path, also emit `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER` using the helper payload from Task 1 so the manual regression step can confirm the helper order was exercised. Reuse the current log marker and existing `normalizeSourceLabel(...)` conventions; do not create a second command-resolution log format.
4. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves the happy path for a local flow from `codeInfo2`: when both the local flow owner and the selected working repository contain the referenced command, the working repository wins. The purpose of this test is to prove the new first slot overrides the old owner-first behavior.
5. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves the happy path for a cross-repo flow: when a flow from one ingested repo runs with a different selected working repository, the working repository is searched first and the flow-owner repository is searched second. The purpose of this test is to prove the new order works across repo boundaries.
6. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves the missing-working-repository case skips the first slot, records `workingRepositoryAvailable=false`, and continues with owner, then `codeInfo2`, then other repos. The purpose of this test is to lock down the documented degraded-mode lookup path.
7. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves duplicate repository identities are deduped when the selected working repository equals the owner repository. The purpose of this test is to ensure command lookup does not create duplicate attempts or duplicate logged candidates when the first two slots collapse to one path.
8. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves duplicate repository identities are deduped when the selected working repository equals local `codeInfo2`. The purpose of this test is to ensure command lookup does not create duplicate attempts or duplicate logged candidates when the working-repository slot and the local-repository slot collapse to one path.
9. [x] Update the direct-command path in `server/src/agents/service.ts`, `server/src/agents/commandsRunner.ts`, or `server/src/agents/commandItemExecutor.ts` so command JSON references use `server/src/flows/repositoryCandidateOrder.ts` and therefore follow the same concrete order used by flow commands: selected working repository first, selected command file repository second as the owner slot, local `codeInfo2` third, then other ingested repositories with first-seen dedupe. Keep direct commands anchored to the existing agent conversation and command-runner flow; do not add a command-only conversation type, command-only persistence path, or parallel command fetch pipeline.
10. [x] Add or extend one server unit test in `server/src/test/unit/agents-commands-router-run.test.ts` that proves the happy path for direct command execution: outside flows, the selected working repository is searched first and the command file's repository is searched second. The purpose of this test is to prove direct commands reuse the same lookup contract as flows.
11. [x] Add or extend one server unit regression test in `server/src/test/unit/agents-commands-router-run.test.ts` that proves a higher-priority command file which exists but fails schema validation does not silently fall through to a lower-priority repository. The purpose of this test is to preserve the documented fail-fast safety rule while changing repository order.
12. [x] When the Task 4 storage changes are in place in `server/src/mongo/turn.ts` and the turn-writing helpers, write the command lookup result into `Turn.runtime.lookupSummary` using this exact persisted contract: `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`. Use that same three-field summary for both flow-owned command resolution and direct-command execution, and keep the full candidate list in structured logs only.
13. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.command.test.ts` that proves flow-owned command resolution persists `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable` into runtime metadata. The purpose of this test is to protect the persisted debugging contract for flow command resolution.
14. [x] Add or extend one server unit test in `server/src/test/unit/turn-command-metadata.test.ts` that proves direct command execution persists `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable` into runtime metadata. The purpose of this test is to ensure flow and direct-command execution do not diverge in persisted lookup metadata.
15. [x] Update [`design.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with the final command-resolution architecture introduced by this task. Document the working-repository-first candidate order, the direct-command owner-slot rule, the fail-fast stop point, and the Mermaid diagram that shows the implemented flow-owned and direct-command lookup sequence. The purpose of this document update is to keep the architecture reference aligned with the shipped command-resolution behavior.
16. [x] After all file-adding or file-removal subtasks in Task 2 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including every helper, route, support file, and test file created or deleted by the command-resolution work. The purpose of this document update is to keep the repository structure map accurate for later contributors.
17. [x] Update this story file's Task 2 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final command-resolution functions changed and any issue solved during the direct-command alignment work. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server command-resolution code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server command-resolution behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story command-resolution contracts and the current implementations in `server/src/flows/service.ts`, `server/src/agents/service.ts`, `server/src/agents/commandsRunner.ts`, and `server/src/agents/commandItemExecutor.ts` before changing code.
- The four command cases this task must cover are: flow-owned commands, local flows from `codeInfo2`, cross-repo flows, and direct command execution outside flows.
- Swapped flow command candidate ordering over to `buildRepositoryCandidateOrder(...)`, kept fail-fast behavior for any existing invalid candidate, and logged both the Task 1 helper marker and the expanded `DEV_0000040_T11_FLOW_RESOLUTION_ORDER` payload from the shared order result.
- Added flow command integration coverage for local `codeInfo2` flows, cross-repo flows, missing-working-folder degraded mode, and both documented dedupe collapses so the new repository order is locked down from the flow side.
- Aligned direct command selection to the same working -> owner -> local `codeInfo2` -> others contract, including fail-fast schema validation and reuse of the existing agent conversation / command runner path rather than creating a parallel persistence surface.
- Persisted compact command lookup summaries in `Turn.runtime.lookupSummary` for both flow-owned commands and direct commands by extending the turn shape now so Task 2 can verify the debugging contract end to end before Task 4 broadens runtime metadata usage.
- Added direct-command unit coverage for working-repo-first selection, fail-fast invalid higher-priority commands, and persisted lookup metadata so flow and direct command behavior stay aligned.
- Updated `design.md` with the final Task 2 command-resolution architecture and Mermaid diagrams, and recorded the Task 2 file footprint in `projectStructure.md` so later tasks can see the shared helper, turn metadata, and test files touched by this command-order change.
- `npm run format:check --workspaces` initially failed on the Task 2 server files, so I reran `npm run format --workspaces` and rechecked formatting; `npm run lint --workspaces` still finishes cleanly except for pre-existing repo-wide import-order warnings outside this task's scope.
- Testing step 1 passed on rerun via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first build failed only on strict TypeScript issues in the new direct-command log/test code, which I fixed before rerunning.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1229`, `passed: 1229`, `failed: 0`, and `agent_action: skip_log`; the first full run exposed local-agent command path compatibility plus stale other-repo ordering expectations, so I used targeted wrapper reruns to fix those before rerunning the full suite.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.
---

### 3. Apply The Shared Order To Markdown Resolution And Nested Lookup Logging

- Task Status: `__done__`
- Git Commits: `1c27fd87, 05beaa28`

#### Overview

Update the markdown resolver so every markdown lookup uses the same shared repository order as command resolution. This task is only about markdown resolution behavior, fail-fast rules, and the nested-lookup logging/metadata contract for markdown files.

#### Documentation Locations

- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/path.html`, for safe markdown-path resolution and relative-path handling
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/fs.html`, for markdown file reads and error handling that determine not-found versus fail-fast behavior
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/buffer.html`, for UTF-8 decoding behavior and how invalid text data should be treated during markdown resolution
- Mermaid documentation via Context7 `/mermaid-js/mermaid` and `https://mermaid.js.org/intro/`, for updating the nested markdown-resolution architecture diagram so its syntax and flowchart structure stay valid

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before changing markdown lookup code, re-read this story's `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases And Failure Modes`, then inspect `server/src/flows/markdownFileResolver.ts`, `server/src/flows/service.ts`, and `server/src/agents/commandItemExecutor.ts`. Record in Task 3 `Implementation notes` that every markdown lookup must restart the repository order from scratch based on the immediate referencing file rather than inheriting the previous winning repository.
2. [x] Update `server/src/flows/markdownFileResolver.ts` so the current owner-first candidate builder is replaced with `server/src/flows/repositoryCandidateOrder.ts`. That helper must already return candidates in this exact order: selected working repository first, immediate owner repository second, local `codeInfo2` third, then other ingested repositories, with first-seen dedupe on normalized absolute paths. Keep the existing `resolveMarkdownFileWithMetadata(...)` entry point, path-safety checks for relative markdown references, UTF-8 decode behavior, and resolved-path return shape; this subtask is only about repository order and candidate generation.
3. [x] In `server/src/flows/markdownFileResolver.ts`, preserve the fail-fast rule from this story's `Edge Cases And Failure Modes`: if a higher-priority candidate exists but cannot be read or decoded, return that error immediately instead of silently falling through. Only true not-found outcomes may continue to the next repository candidate.
4. [x] Update the nested command-to-markdown callers in `server/src/flows/service.ts` and `server/src/agents/commandItemExecutor.ts` so each markdown hop recalculates candidate order from the immediate referencing file's repository. Do not reuse the previous hop's winning repository unless it is also the correct current working or owner slot for the new hop.
5. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves the happy path for a top-level markdown reference: the selected working repository is searched before the owner repository. The purpose of this test is to prove markdown lookup uses the same working-repo-first order as command lookup.
6. [x] Add or extend one server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that proves nested command-to-markdown lookups restart the full repository order for each hop instead of sticking to the previous repository winner. The purpose of this test is to lock down the nested restart rule.
7. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves the missing-working-repository case skips the first slot cleanly, records `workingRepositoryAvailable=false`, and still resolves through owner, then `codeInfo2`, then other repos. The purpose of this test is to cover the documented degraded-mode lookup path.
8. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves duplicate repository identities are deduped when the selected working repository equals the owner repository. The purpose of this test is to ensure markdown lookup does not create duplicate attempts or duplicate logged candidates when the first two slots collapse to one path.
9. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves duplicate repository identities are deduped when the selected working repository equals local `codeInfo2`. The purpose of this test is to ensure markdown lookup does not create duplicate attempts or duplicate logged candidates when the working-repository slot and the local-repository slot collapse to one path.
10. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves a higher-priority markdown file with invalid UTF-8 triggers a fail-fast error and does not fall through to a lower-priority repository. The purpose of this test is to preserve the decoding safety rule while changing candidate order.
11. [x] Add or extend one server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that proves a higher-priority markdown file with a filesystem read failure triggers a fail-fast error and does not fall through to a lower-priority repository. The purpose of this test is to preserve the read-error safety rule while changing candidate order.
12. [x] Update the markdown structured logs in `server/src/flows/markdownFileResolver.ts` so they use the same concrete lookup-summary fields already required for command resolution in `server/src/flows/service.ts`: candidate order in logs, selected repository, `fallbackUsed`, and `workingRepositoryAvailable`. Emit a dedicated marker `DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER`, also emit `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER` with the helper payload, and include the final resolved markdown path for debugging in logs only.
13. [x] When the Task 4 storage changes are in place in `server/src/mongo/turn.ts` and the turn-writing helpers, persist only this minimal markdown lookup summary in `Turn.runtime.lookupSummary`: `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`. Keep the resolved markdown path and full candidate order in structured logs rather than persisted turn metadata.
14. [x] Add or extend one server integration test in `server/src/test/integration/flows.turn-metadata.test.ts` that proves a top-level markdown reference persists `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable` into runtime metadata. The purpose of this test is to protect the persisted debugging contract for top-level markdown resolution.
15. [x] Add or extend one server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that proves a nested markdown lookup persists `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable` into runtime metadata. The purpose of this test is to ensure nested and top-level markdown resolution do not diverge in persisted metadata.
16. [x] Update [`design.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with the markdown-resolution architecture introduced by this task. Document the per-hop restart rule, the fail-fast read or decode branch, and the Mermaid diagram that shows how top-level and nested markdown references recompute repository order. The purpose of this document update is to keep the architecture reference aligned with the shipped markdown-resolution behavior.
17. [x] After all file-adding or file-removal subtasks in Task 3 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including every resolver, support file, and test file created or deleted by the markdown-resolution work. The purpose of this document update is to keep the repository structure map accurate for later contributors.
18. [x] Update this story file's Task 3 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final resolver entry points changed and any issue solved during nested-caller alignment. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
19. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server markdown-resolution code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server markdown-resolution behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the Task 3 Node.js path/fs/buffer docs plus the current markdown resolver and nested markdown callers before editing code.
- Every markdown lookup in this task must restart repository ordering from scratch based on the immediate referencing file rather than inheriting the previous winning repository.
- Swapped `markdownFileResolver.ts` onto the shared repository-order helper and kept the existing relative-path guardrails and resolved-path return contract intact.
- Preserved markdown fail-fast behavior by logging and surfacing read or UTF-8 decode errors immediately while letting only `ENOENT` continue to lower-priority repositories.
- Threaded `workingRepositoryPath` plus markdown lookup summaries through `commandItemExecutor.ts`, `commandsRunner.ts`, and `flows/service.ts` so top-level and nested markdown turns persist only the compact runtime lookup summary.
- Extended markdown resolver unit coverage for working-repo-first lookup, missing-working degraded mode, both dedupe collapse cases, caller-order preservation for other repos, and fail-fast decode or read errors.
- Added integration coverage for nested command markdown restart behavior and persisted markdown lookup summaries on both direct-command and flow turns.
- Synced `design.md` with the new markdown contract and added Task 3 diagrams for per-hop restart plus fail-fast markdown resolution.
- Recorded the Task 3 file footprint in `projectStructure.md`; this task did not add or remove tracked files.
- `npm run format:check --workspaces` initially failed on the new Task 3 files, so I ran `npm run format --workspaces` and reran both format and lint; lint now passes with the repository's pre-existing import-order warnings only.
- Testing step 1 passed on rerun via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first build failed only on Task 3 test typing, which I fixed before rerunning.
- Testing step 2 passed on rerun via `npm run test:summary:server:unit` with `tests run: 1236`, `passed: 1236`, `failed: 0`, and `agent_action: skip_log`; the first full run exposed one Task 3 metadata assertion, one outdated other-repo ordering expectation, and two runtime-config tests that needed to clear ambient Context7 API-key state.
- Nested-caller alignment ended up in four entry points: `resolveMarkdownFileWithMetadata(...)`, `executeCommandItem(...)`, the direct-command runner in `commandsRunner.ts`, and the flow LLM plus flow-command paths in `flows/service.ts`.
- The main alignment issue was keeping nested command markdown tied to the resolved command file repository instead of the parent flow repository; passing `commandLoad.sourceId` into `executeCommandItem(...)` fixed the per-hop owner slot without changing command JSON resolution.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.

---

### 4. Add Working-Folder Storage Shapes And Runtime Metadata Persistence

- Task Status: `__done__`
- Git Commits: `6aafe3f4, 5dc692b2`

#### Overview

Add the storage shapes that story 48 needs without changing any client UI yet. This task is only about persistence contracts: `Conversation.flags.workingFolder`, `FlowResumeState` additions, `Turn.runtime`, and keeping memory-mode behavior aligned with Mongo-backed behavior.

#### Documentation Locations

- Mongoose documentation via Context7 `/websites/mongoosejs`, specifically `https://mongoosejs.com/docs/schematypes.html#mixed`, for `Mixed` field persistence rules and when `markModified(...)` is required
- Mongoose documentation via Context7 `/websites/mongoosejs`, specifically `https://mongoosejs.com/docs/subdocs.html`, for nested objects and subdocument-style storage shape design
- Mongoose documentation via Context7 `/websites/mongoosejs`, specifically `https://mongoosejs.com/docs/tutorials/findoneandupdate.html`, for atomic update patterns that should be reused when storing `flags.workingFolder` and turn runtime metadata
- Mermaid documentation via Context7 `/mermaid-js/mermaid` and `https://mermaid.js.org/intro/`, for updating the persistence architecture diagram so the new storage shapes and data-flow notation stay valid

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before editing persistence code, re-read this story's `Contracts And Storage Shapes`, `Edge Cases And Failure Modes`, and `Research Findings`, then inspect `server/src/mongo/conversation.ts`, `server/src/mongo/repo.ts`, `server/src/flows/flowState.ts`, `server/src/mongo/turn.ts`, and `server/src/chat/memoryPersistence.ts`. Record in Task 4 `Implementation notes` the exact shapes that must exist after this task: `flags.workingFolder`, `FlowResumeState.workingFolder`, `FlowResumeState.agentWorkingFolders`, and `Turn.runtime`.
2. [x] Update `server/src/mongo/conversation.ts` and the repo helpers in `server/src/mongo/repo.ts` so `flags.workingFolder` can be written, cleared, and read back through the existing conversation summary path without overwriting unrelated `flags` values such as `threadId` or `flow`. Do not pass a partial `flags` object into `updateConversationMeta(...)` as it replaces the whole `flags` object today; instead, add or reuse a helper that performs a nested `$set` or `$unset` on `flags.workingFolder` while preserving the rest of `flags`.
3. [x] If any change in `server/src/mongo/conversation.ts` or `server/src/mongo/repo.ts` introduces a hydrated-document save for the `flags` object instead of a direct update query, call `markModified('flags')` exactly as required by the Mongoose Mixed-field guidance referenced in this task's documentation list.
4. [x] Update `server/src/flows/flowState.ts` and its related persistence helpers so the existing `flags.flow` resume-state path can store both the flow working-folder snapshot and the per-child-agent snapshots. Do not create a second resume-state collection, second resume-state field family, or a flow-only persistence subsystem.
5. [x] Update `server/src/mongo/turn.ts` and the existing turn-writing helper such as `appendTurn(...)` so turns can persist `runtime.workingFolder` and `runtime.lookupSummary`. The `lookupSummary` contract must match this story exactly: `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`, with no extra verbose candidate list stored on turns.
6. [x] Update `server/src/chat/memoryPersistence.ts`, including `recordMemoryTurn(...)` and `updateMemoryConversationMeta(...)`, so memory-mode execution uses the same `flags.workingFolder` and `Turn.runtime` shape as Mongo-backed execution. Do not add a memory-only schema or a second metadata contract.
7. [x] Update the existing summary and event pipeline in `server/src/mongo/repo.ts`, `server/src/mongo/events.ts`, `server/src/ws/sidebar.ts`, or the nearest existing conversation-summary code so `flags.workingFolder` round-trips through REST responses and websocket `conversation_upsert` payloads without dropping any existing flags. Emit one structured marker `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED` whenever working-folder state is saved or cleared, including the conversation id, persistence mode (`mongo` or `memory`), and action (`save` or `clear`), so the manual regression step can search for that exact marker in stack logs.
8. [x] Add or extend one server unit test in `server/src/test/unit/flows.flags.test.ts` that proves `flags.workingFolder` round-trips correctly through the Mongo-backed conversation storage path. The purpose of this test is to cover the main persisted conversation field in the existing suite that already exercises nested `flags` persistence.
9. [x] Add or extend one server unit test in `server/src/test/unit/flows.flags.test.ts` that proves writing `flags.workingFolder` preserves an existing `flags.threadId` value on the same conversation. The purpose of this test is to protect the explicit non-clobbering rule for unrelated conversation flags.
10. [x] Add or extend one server unit test in `server/src/test/unit/flows.flags.test.ts` that proves `FlowResumeState.workingFolder` round-trips correctly through flow-state persistence. The purpose of this test is to confirm the flow snapshot survives resume-state storage in the existing flags-focused suite.
11. [x] Add or extend one server unit test in `server/src/test/unit/flows.flags.test.ts` that proves `FlowResumeState.agentWorkingFolders` round-trips correctly through flow-state persistence. The purpose of this test is to confirm per-child-agent snapshots are preserved in the existing flags-focused suite.
12. [x] Add or extend one server unit test in `server/src/test/unit/flows.flags.test.ts` that proves clearing `flags.workingFolder` preserves an existing `flags.flow` object on the same conversation. The purpose of this test is to protect the explicit non-clobbering rule for stored flow resume state.
13. [x] Add or extend one server regression test in `server/src/test/unit/flows.flags.test.ts` that would fail if a nested `flags` update were lost because the Mongoose `Mixed` field was mutated unsafely. The purpose of this test is to prevent partial writes when `flags.workingFolder` is added.
14. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves `Turn.runtime` round-trips correctly in the Mongo-backed path. The purpose of this test is to cover persistent runtime metadata storage in the existing chat persistence suite.
15. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves `Turn.runtime` round-trips correctly in the memory-backed path. The purpose of this test is to keep degraded memory mode aligned with Mongo in the existing chat persistence suite.
16. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.basic.test.ts` that proves memory-backed flow conversations retain the saved `flags.workingFolder` and updated flow resume snapshots after the storage changes. The purpose of this test is to cover the memory-mode conversation metadata contract end to end.
17. [x] Add or extend one server integration test in `server/src/test/integration/conversations.list.test.ts` that proves REST conversation summaries still include `flags.workingFolder` after the storage changes. The purpose of this test is to protect the client restore contract in the existing conversations list suite.
18. [x] Add or extend one server unit test in `server/src/test/unit/ws-server.test.ts` that proves `conversation_upsert` payloads still include `flags.workingFolder` after the storage changes. The purpose of this test is to protect realtime restore and clear behavior.
19. [x] Update [`design.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with the persistence architecture introduced by this task. Document the new `Conversation.flags.workingFolder`, `FlowResumeState` additions, `Turn.runtime` contract, and the Mermaid diagram that shows how working-folder state moves between conversation storage, flow state, turn runtime metadata, and memory mode. The purpose of this document update is to keep the architecture reference aligned with the shipped persistence behavior.
20. [x] After all file-adding or file-removal subtasks in Task 4 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including every persistence, support, and test file created or deleted by the storage work. The purpose of this document update is to keep the repository structure map accurate for later contributors.
21. [x] Update this story file's Task 4 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final persistence helpers changed and any issue solved while aligning Mongo and memory-mode storage. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
22. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server persistence and storage code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server persistence behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the Task 4 Mongoose Mixed-field, subdocument, and atomic update guidance plus the current Mongo, flow-state, and memory persistence files before editing code.
- Task 4 must leave four concrete persisted shapes behind: `Conversation.flags.workingFolder`, `FlowResumeState.workingFolder`, `FlowResumeState.agentWorkingFolders`, and `Turn.runtime` with `workingFolder` plus compact `lookupSummary`.
- Added `updateConversationWorkingFolder(...)` in `server/src/mongo/repo.ts` so working-folder saves and clears use nested `$set`/`$unset` updates, emit `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`, and preserve sibling flags instead of replacing the whole Mixed `flags` object.
- Expanded `FlowResumeState` plus the flow persistence path so `flags.flow` now carries the flow-level working folder and per-agent working-folder snapshots alongside the existing conversation and thread maps.
- Extended turn summaries and chat persistence coverage so `Turn.runtime` round-trips in both Mongo-backed and memory-backed execution, while conversation list and websocket tests now explicitly prove `flags.workingFolder` survives summary and realtime paths.
- Memory-mode flow coverage now proves a saved `flags.workingFolder` survives flow resume-state updates, which is the key non-clobbering guarantee Task 5 depends on before route-level restore logic is added.
- No hydrated-document save path was introduced for `flags`, so `markModified('flags')` was not needed; the Task 4 updates stay on atomic query updates for Mongo and object replacement in memory mode only.
- Synced `design.md` with the Task 4 persistence contract and added Mermaid diagrams covering Mongo-backed and memory-backed working-folder state flow through conversation flags, flow resume state, and compact turn runtime metadata.
- Recorded the Task 4 file footprint in `projectStructure.md`; this task modified persistence, flow-state, and test files but did not add, remove, or rename tracked files.
- `npm run format:check --workspaces` initially failed on the new Task 4 tests and one pre-existing Task 3 test file, so I ran `npm run format --workspaces` and reran the check successfully.
- `npm run lint --workspaces` now finishes with only the repository's pre-existing import-order warnings; I also cleared the one Task 4-specific import-order warning in `server/src/chat/memoryPersistence.ts` before rerunning lint.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed on rerun via `npm run test:summary:server:unit` with `tests run: 1245`, `passed: 1245`, `failed: 0`, and `agent_action: skip_log`; the first full run exposed one Task 4 test bug where the new memory-mode flow coverage used a non-existent fake working-folder path, so I switched that assertion to a real temp directory and reran the full suite.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.
---

### 5. Wire The Server Working-Folder Contract Through Chat, Agents, Flows, And Child Conversations

- Task Status: `__done__`
- Git Commits: `61913ffa, 760bf4fe`

#### Overview

Use the storage shapes from Task 4 to make the server actually accept, validate, persist, restore, and clear working-folder state across the existing execution surfaces. This task includes adding the missing conversation-working-folder edit contract because the current repository does not already expose an idle edit surface for `flags.workingFolder`. It must be finished before the frontend task that depends on it.

#### Documentation Locations

- Express documentation via Context7 `/expressjs/express`, specifically `https://expressjs.com/en/guide/routing.html`, for route-handler structure and parameter handling used by the server contract changes
- Express documentation via Context7 `/expressjs/express`, specifically `https://expressjs.com/en/guide/writing-middleware.html`, for middleware and request-flow behavior used when validation and run-lock checks are enforced
- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/path.html` and `https://nodejs.org/api/fs.html`, for absolute-path validation and existence checks used by working-folder validation
- Mongoose documentation via Context7 `/websites/mongoosejs`, specifically `https://mongoosejs.com/docs/tutorials/findoneandupdate.html`, for updating or clearing `flags.workingFolder` without creating a parallel persistence path
- Mermaid documentation via Context7 `/mermaid-js/mermaid` and `https://mermaid.js.org/intro/`, for updating the server working-folder contract diagrams so route, restore, and child-conversation flow diagrams match Mermaid syntax

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before editing server routes, re-read this story's `Acceptance Criteria`, `Contracts And Storage Shapes`, `Edge Cases And Failure Modes`, and `Expected Outcomes`, then inspect `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, `server/src/routes/flowsRun.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`, and `server/src/ws/server.ts`. Record in Task 5 `Implementation notes` the non-negotiable requirements for this task: chat must accept `working_folder`, there is currently no idle-edit route for `flags.workingFolder`, invalid saved paths must be cleared before restore and reuse, child agent conversations inherit the flow-step folder, the existing inflight snapshot stream must keep working, and top-level start responses stay compact.
2. [x] Update `server/src/routes/chatValidators.ts` so `POST /chat` accepts `working_folder` and validates it using the same absolute-path and not-found rules already used by `server/src/routes/agentsRun.ts` and `server/src/routes/flowsRun.ts`. Return the existing `WORKING_FOLDER_INVALID` and `WORKING_FOLDER_NOT_FOUND` codes; do not introduce chat-only validation names.
3. [x] Update `server/src/routes/chat.ts` so a chat run persists the selected folder onto the owning conversation, clears a stale saved path before the next restore or run uses it, and writes runtime metadata using the exact Task 4 storage contract already planned for turns: `Turn.runtime.workingFolder` plus `Turn.runtime.lookupSummary` with only `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`. Keep the top-level chat start response compact; do not add verbose lookup details to the run-start payload.
4. [x] Add or extend a dedicated conversation-meta route in `server/src/routes/conversations.ts` so an existing chat, agent, or flow conversation can save or clear `flags.workingFolder` while idle without starting a run. Reuse the existing conversation route style already used in that file for validation, ownership checks, and response shaping instead of inventing a parallel controller pattern.
5. [x] Wire the new conversation-meta route through the existing persistence and event helpers in `server/src/mongo/repo.ts`, `server/src/mongo/events.ts`, `server/src/ws/sidebar.ts`, and `server/src/ws/server.ts` so idle edits use a nested-flags conversation helper that preserves unrelated `flags`, emit `conversation_upsert`, and continue to coexist with the existing inflight snapshot publishing. Also apply the existing active-run protection from `server/src/agents/runLock.ts` and `server/src/chat/inflightRegistry.ts` so edits are rejected while a related run is in flight.
6. [x] Update the existing agent, flow, and direct-command execution paths in `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, `server/src/routes/flowsRun.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts` so they load saved folders from the owning conversation and persist user changes back to that same conversation. Keep direct commands on the existing owning agent conversation; do not create a command-only conversation or command-only save path.
7. [x] Update the flow child-conversation path in `server/src/flows/service.ts` and any related flow resume helpers so a child agent conversation inherits the exact folder path used by the flow step, and that snapshot is persisted for later restore through the existing conversation and flow-state persistence.
8. [x] Update the restore surfaces that the client already uses, including the `GET /conversations` path, repo summary helpers, websocket/sidebar upserts, and inflight snapshot publishing, so an invalid saved `flags.workingFolder` is cleared before the UI restores it and so cleared or updated values are broadcast immediately without introducing a second conversation-summary shape. Emit one structured marker `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` whenever the server saves, clears, restores, or rejects a working-folder edit, including the conversation id, owning record type, surface, action, decision reason, and, when a stale value is cleared, the stale path that triggered the clear, so the manual regression step can search for that exact marker in stack logs and confirm the warning payload matches the story acceptance criteria.
9. [x] Add or extend one server unit test in `server/src/test/unit/chatValidators.test.ts` that proves `POST /chat` accepts a valid `working_folder` using the same validation contract as the existing agent and flow routes. The purpose of this test is to cover the happy path for the new chat request input.
10. [x] Add or extend one server unit test in `server/src/test/unit/chatValidators.test.ts` that proves an invalid absolute-path `working_folder` in `POST /chat` returns `WORKING_FOLDER_INVALID` instead of a chat-specific variant. The purpose of this test is to preserve shared validation semantics for malformed chat input.
11. [x] Add or extend one server unit test in `server/src/test/unit/chatValidators.test.ts` that proves a missing-on-disk `working_folder` in `POST /chat` returns `WORKING_FOLDER_NOT_FOUND` instead of a chat-specific variant. The purpose of this test is to preserve shared validation semantics for nonexistent chat input.
12. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves a successful chat run persists the selected working folder on the owning conversation. The purpose of this test is to cover the main persistence happy path for chat.
13. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves an invalid saved chat working folder is cleared before the chat restore path uses it. The purpose of this test is to lock down stale-path cleanup on chat restore.
14. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves an invalid saved chat working folder is cleared before the next chat run reuses it. The purpose of this test is to lock down stale-path cleanup on chat execution reuse.
15. [x] Add or extend one server unit test in `server/src/test/unit/chat-interface-run-persistence.test.ts` that proves chat turn runtime metadata includes the working-folder snapshot and lookup summary when the run resolves references. The purpose of this test is to protect the runtime metadata contract for chat.
16. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the new conversation edit route can save `flags.workingFolder` while the conversation is idle. The purpose of this test is to cover the idle-save happy path.
17. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the new conversation edit route can clear `flags.workingFolder` while the conversation is idle. The purpose of this test is to cover the idle clear path explicitly.
18. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the new conversation edit route rejects an invalid absolute-path `workingFolder` with `WORKING_FOLDER_INVALID`. The purpose of this test is to make the route-level malformed-input behavior explicit instead of leaving it implied by implementation notes.
19. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the new conversation edit route rejects a missing-on-disk `workingFolder` with `WORKING_FOLDER_NOT_FOUND`. The purpose of this test is to make the route-level nonexistent-path behavior explicit instead of leaving it implied by implementation notes.
20. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the new conversation edit route rejects edits while a related run is active. The purpose of this test is to protect the run-lock rule for idle edits.
21. [x] Add or extend one server unit test in `server/src/test/unit/ws-server.test.ts` that proves a conversation edit emits a `conversation_upsert` containing an updated `flags.workingFolder`. The purpose of this test is to cover realtime propagation for save behavior.
22. [x] Add or extend one server unit test in `server/src/test/unit/ws-server.test.ts` that proves a conversation edit emits a `conversation_upsert` containing a cleared `flags.workingFolder`. The purpose of this test is to cover realtime propagation for clear behavior.
23. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.working-folder.test.ts` that proves a stale saved path is cleared before a flow restore uses it. The purpose of this test is to verify end-to-end stale-path cleanup on the flow restore surface.
24. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.working-folder.test.ts` that proves a stale saved path is cleared before a flow run reuses it. The purpose of this test is to verify end-to-end stale-path cleanup on the flow execution surface.
25. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.working-folder.test.ts` that proves the stale-path clear log includes the stale path, owning record type, and conversation id when an invalid saved folder is removed. The purpose of this test is to protect the exact warning-log payload required by the story acceptance criteria.
26. [x] Add or extend one server integration test in `server/src/test/integration/flows.run.working-folder.test.ts` that proves a flow-created child agent conversation inherits the exact folder path used by the flow step. The purpose of this test is to verify child conversation initialization behavior end to end.
27. [x] Add or extend one server unit test in `server/src/test/unit/agents-commands-router-run.test.ts` that proves direct command execution continues to use the owning agent conversation for saved-folder restore and update behavior. The purpose of this test is to prevent direct commands from drifting into a separate persistence model.
28. [x] Update `design.md` with the server contract and flow behavior introduced by this task. Include the idle-edit conversation route, restore-or-clear lifecycle, active-run lock behavior, child agent conversation inheritance, and at least one Mermaid diagram that shows the chat, agent, and flow working-folder lifecycle through validation, persistence, restore, and websocket updates.
29. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server route and contract code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server route behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the Task 5 Express, Node path/fs, and Mongoose update docs plus the current chat, conversations, agent, flow, and websocket entrypoints before editing code.
- Task 5 must make chat accept `working_folder`, add the missing idle conversation edit route for `flags.workingFolder`, clear stale saved paths before restore or reuse, persist flow-step folders onto child agent conversations, keep inflight snapshot publishing working, and leave top-level run-start responses compact.
- Added a shared `server/src/workingFolders/state.ts` helper so request validation, saved-folder restore, stale-path clearing, and `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` logging use one server-side contract.
- Updated chat validation plus the `/chat` route so chat now accepts validated `working_folder`, restores or clears the saved folder on the owning conversation before reuse, and persists `Turn.runtime.workingFolder` without expanding the compact start payload.
- Added a dedicated idle conversation working-folder route in `server/src/routes/conversations.ts`, reused the existing nested flags helper from Task 4, and rejected edits whenever either the run lock or inflight snapshot state says the conversation is busy.
- Wired agent runs, direct command runs, and flow runs to restore saved folders from the owning conversation and persist requested changes back to that same conversation, while keeping direct commands on the existing agent conversation record.
- Flow child-agent conversation creation now carries the exact flow-step working folder onto the child conversation, and `GET /conversations` now clears stale saved folders before returning restore data to the client.
- Extended `server/src/test/unit/chatValidators.test.ts` with the chat working-folder happy-path plus invalid-path and missing-path cases so chat now shares the exact validation contract already enforced by agent and flow routes.
- Extended `server/src/test/unit/chat-interface-run-persistence.test.ts` with chat save, stale-clear, and runtime-metadata coverage so Task 5 locks down both route-level persistence and the compact `Turn.runtime` snapshot contract.
- Extended `server/src/test/unit/conversations-router-agent-filter.test.ts`, `server/src/test/unit/ws-server.test.ts`, `server/src/test/integration/flows.run.working-folder.test.ts`, and `server/src/test/unit/agents-commands-router-run.test.ts` so idle edits, realtime propagation, stale-path logging, child flow inheritance, and direct-command ownership all have explicit Task 5 regression coverage.
- Updated `design.md` with the idle-edit route, restore-or-clear lifecycle, active-run locks, child conversation inheritance, and a Task 5 Mermaid flow so the architecture notes now match the shipped server contract.
- `npm run build:summary:server` initially caught one missing `node:path` import plus test-double typing drift from the router contract changes; after tightening the helper/test imports and relaxing `findConversationById` to the lookup fields the route actually reads, the full server build wrapper passed cleanly with zero warnings.
- `npm run test:summary:server:unit` first exposed memory-mode gaps on the conversations list and idle-edit websocket paths; after making the route list and persist working folders through memory mode as well, aligning the valid-path fixtures, and confirming the stale flow restore with a targeted wrapper rerun, the full server unit wrapper passed with `1264/1264` tests green.
- `npm run test:summary:server:cucumber` passed cleanly with `71/71` scenarios after the server-route changes, confirming the wider regression suite stayed stable.
- `npm run lint --workspaces` and `npm run format:check --workspaces` initially failed on one new unused test parameter plus import-order and prettier drift; after `npm run lint:fix --workspaces`, `npm run format --workspaces`, and the explicit `_model` use in the chat persistence test, both repo-wide checks passed.
---

### 6. Fix Dockerized Conversation Visibility For E2E History Seeding

- Task Status: `__done__`
- Git Commits: `d57469c7, 15995c06`

#### Overview

Repair the dockerized conversation-history visibility seam that Task 7 depends on for honest end-to-end validation. This task is only about making server-seeded conversations reliably appear through `GET /conversations` in the compose-backed e2e environment; it is not a broader client feature task.

#### Documentation Locations

- Mongoose documentation via Context7 `/websites/mongoosejs`, specifically `https://mongoosejs.com/docs/api/connection` and `https://mongoosejs.com/docs/6.x/docs/api/connection`, for connection lifecycle, `readyState`, and waiting for connection completion before treating Mongo as ready
- Express documentation via Context7 `/expressjs/express`, specifically `https://expressjs.com/en/guide/routing.html`, for route-construction and request-time handler behavior used by the conversations router fix
- Playwright documentation via Context7 `/microsoft/playwright`, specifically `https://playwright.dev/docs/test-assertions` and `https://playwright.dev/docs/api/class-apirequestcontext`, for keeping the e2e verification focused on true backend readiness rather than brittle fixed waits

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before touching the server seam, re-read the `**BLOCKING ANSWER**` notes below, then inspect `server/src/index.ts`, `server/src/routes/conversations.ts`, `server/src/chat/memoryPersistence.ts`, `server/src/mongo/repo.ts`, and `e2e/chat-provider-history.spec.ts`. Record in Task 6 `Implementation notes` the exact broken startup order: the conversations router is mounted before Mongo connects, the list route snapshots its persistence source too early, and the dockerized e2e seed path depends on `GET /conversations` seeing Mongo-backed rows after seed writes complete.
2. [x] Update `server/src/routes/conversations.ts` so the list-path persistence decision is made at request time rather than router-construction time. Reuse the same live `shouldUseMemoryPersistence()` style already used elsewhere in that router, keep dependency injection support for tests, and limit the fix to the conversations-list seam required by the blocker instead of refactoring unrelated routes.
3. [x] If the current route shape makes request-time selection awkward, add one small internal helper in `server/src/routes/conversations.ts` that resolves the correct list implementation on each call. Do not move the entire router mount sequence in `server/src/index.ts` unless that becomes strictly necessary; prefer the narrower route-level fix first.
4. [x] Add or extend one server unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` that proves the conversations list path resolves its backing store at request time rather than freezing the startup-time persistence choice. The purpose of this test is to lock down the exact seam that caused the dockerized e2e regression.
5. [x] Add or extend one server integration test in `server/src/test/integration/conversations.list.test.ts` that proves a conversation created and updated through the normal REST seed flow is visible through `GET /conversations` after the server is fully running. The purpose of this test is to cover the persisted conversation-history contract without relying on the browser layer.
6. [x] Add or extend `e2e/chat-provider-history.spec.ts` only as needed to keep its readiness check aligned with the corrected server contract. Do not add fixed sleeps; keep API polling or assertions focused on the actual server postcondition that the seeded conversation appears in the list.
7. [x] Update [`design.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) if its conversation persistence or startup-order guidance is stale after this fix. Document that the conversations list path resolves persistence at request time so dockerized startup sequencing cannot freeze it onto the wrong store.
8. [x] Update this story file's Task 6 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final seam fixed, the files changed, and why the narrower request-time resolver was chosen over broader startup reordering.
9. [x] Run `npm run build:summary:server` and `npm run test:summary:server:unit`; if either fails, inspect the wrapper log and fix the issue before rerunning the same wrapper.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this prerequisite task changes the server conversations router and persistence selection seam. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this prerequisite task changes server route behavior covered by unit and integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted server-unit wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:e2e -- --file e2e/chat-provider-history.spec.ts` - Use because this prerequisite task exists specifically to unblock the dockerized historical-conversation visibility path. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper reruns only after the targeted wrapper fails, then rerun this same targeted e2e wrapper until the spec passes.

#### Implementation notes

- Planning repair: this task was inserted after Task 7 hit an e2e blocker that revealed a missing server-side readiness seam. Task 7 now depends on this prerequisite being complete before its remaining e2e and manual validation steps can be closed honestly.
- Re-read the blocking-answer notes plus `server/src/index.ts`, `server/src/routes/conversations.ts`, `server/src/chat/memoryPersistence.ts`, `server/src/mongo/repo.ts`, and `e2e/chat-provider-history.spec.ts`; the seam is exactly what the planner described: the router mounts before Mongo connects, `GET /conversations` freezes its list implementation too early, and the dockerized seed flow needs that list path to resolve against Mongo once the connection is live.
- Updated `server/src/routes/conversations.ts` so the list handler now resolves its backing implementation per request instead of snapshotting memory-versus-Mongo at router construction time, while still honoring explicit test overrides.
- Added one resolver-switch unit test in `server/src/test/unit/conversations-router-agent-filter.test.ts` and one REST-seeding integration test in `server/src/test/integration/conversations.list.test.ts` to lock down the exact startup-freeze seam and the post-seed visibility contract.
- Kept `e2e/chat-provider-history.spec.ts` on an API-backed readiness poll rather than fixed waits so the targeted e2e rerun will assert the repaired backend postcondition instead of sleeping around it.
- Updated `design.md` to document that Story 48 Task 6 moved the conversations list persistence decision to request time specifically so compose-backed startup ordering cannot freeze historical conversation visibility onto the wrong store.
- `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`, `npm run test:summary:server:unit` passed with `tests run: 1266`, `passed: 1266`, `failed: 0`, and the formerly blocked `npm run test:summary:e2e -- --file e2e/chat-provider-history.spec.ts` passed with `tests run: 43`, `passed: 43`, `failed: 0`.
- Final seam choice: keep `server/src/index.ts` startup order unchanged and use the smaller request-time resolver in `server/src/routes/conversations.ts`, because it matches the router’s existing live persistence checks and fixes the exact broken list-path contract with less startup risk than broad mount reordering.
- **BLOCKING ANSWER** Repository precedents and current local proof point to a server-side fix, not another test-side wait. `e2e/chat-provider-history.spec.ts` already follows the repo precedent for historical-chat seeding by calling `POST /conversations` and `POST /conversations/:id/turns`, and `server/src/mongo/repo.ts` shows those writes update `lastMessageAt`, which is the field `GET /conversations` sorts on. The real mismatch is in `server/src/routes/conversations.ts`: `createConversationsRouter(...)` currently captures `listConversations = shouldUseMemoryPersistence() ? listMemoryConversations : defaultListConversations` when the router is constructed, but `server/src/index.ts` mounts `createConversationsRouter()` before `await connectMongo(mongoUri)`. In the dockerized e2e stack that means the list route can get locked onto the empty in-memory map at startup even though the later seed writes go through the Mongo-backed defaults, which exactly matches the observed failure shape of successful seed requests followed by `GET /conversations` returning `items: []`.
- **BLOCKING ANSWER** External library precedents confirm the same conclusion. Official Mongoose docs show `readyState` is only meaningful after awaiting connection completion and demonstrate checking it after `createConnection(...).asPromise()` resolves, not before startup completes (`https://mongoosejs.com/docs/api/connection`, `https://mongoosejs.com/docs/6.x/docs/api/connection`). DeepWiki's Mongoose summary reaches the same practical guidance: one-time startup branching on `readyState` before connection settles is unsafe, while per-request checks are safe. Official Playwright docs and DeepWiki both say `expect.poll` / `toPass` are the right tools for waiting on a backend state that is expected to become true, but they are not a substitute for a broken backend contract; longer `waitForTimeout(...)` or extra page polling are brittle workarounds rather than a fix (`https://playwright.dev/docs/test-assertions`, `https://playwright.dev/docs/api/class-apirequestcontext`, `https://deepwiki.com/search/for-playwright-endtoend-tests_0464c5ec-8fe5-4baa-ac6a-2e53b7800078`).
- **BLOCKING ANSWER** Issue-resolution references also line up with this diagnosis. The existing e2e log proves the poll timed out on an always-empty array, which means the server contract never became true rather than the UI merely lagging. Community Mongoose guidance consistently treats `readyState` as the current singleton connection state, not as something to snapshot once and reuse forever; the linked Stack Overflow discussion also calls out the state values and the fact that it should be read from the live connection object, with ping or per-request state checks used when freshness matters (`https://stackoverflow.com/questions/19599543/check-mongoose-connection-state-without-creating-new-connection`). That makes the correct fix to move the memory-vs-Mongo decision for the conversations list path to request execution time, using the same pattern this router already uses for `persistConversationWorkingFolder(...)` and `findConversationById(...)`, then rerun the blocked targeted e2e wrapper. Rejected alternatives: increasing the Playwright poll timeout, adding more `waitForTimeout(...)`, or seeding through the UI would only hide the startup-time persistence mismatch; moving router registration in `server/src/index.ts` until after `connectMongo(...)` would also address the symptom, but it is a broader startup refactor than needed when a narrow dynamic resolver in `server/src/routes/conversations.ts` matches existing local patterns and fixes the exact broken seam with less risk.
---

### 7. Restore And Lock Working-Folder Pickers In The Client

- Task Status: `__done__`
- Git Commits: `9c3cc066, 028e7a1c, bb49287d`

#### Overview

Update the client so chats, agents, and flows all restore the saved working-folder state from the server contract introduced in Task 5, use the new conversation-working-folder edit API when the user changes the picker while idle, and make the picker read-only while the related run is active. This task is only about the frontend behavior that depends on the server contract already being in place and on Task 6 having repaired the dockerized conversation-history visibility seam first.

#### Documentation Locations

- React documentation via Context7 `/reactjs/react.dev`, specifically `https://react.dev/reference/react-dom/components/input`, for controlled input behavior and value or change handling
- React documentation via Context7 `/reactjs/react.dev`, specifically `https://react.dev/reference/react/useEffect`, for syncing UI state with websocket updates and restored conversation data
- MUI MCP documentation for `@mui/material@6.4.12`, specifically `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, for `TextField` controlled usage, `disabled`, helper text, and accessibility guidance
- MUI MCP API documentation for `@mui/material@6.4.12`, specifically `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, for exact `TextField` props such as `disabled`, `helperText`, `id`, and `value`
- Jest documentation via Context7 `/jestjs/jest` and `https://jestjs.io/docs/getting-started`, for client unit and component test structure, assertions, and rerun guidance used by the planned `client/src/test/` updates

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before changing client code, re-read this story's `Acceptance Criteria`, `Expected Outcomes`, and `Edge Cases And Failure Modes`, then inspect `client/src/hooks/useConversations.ts`, `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx`. Record in Task 7 `Implementation notes` the UX rules that every surface must follow: restore from saved conversation state, show the normal empty state when no valid folder exists, keep direct commands tied to the owning agent conversation, and lock edits while a run is active.
2. [x] Create or extend one shared client helper in `client/src/api/conversations.ts` and wire it into `client/src/hooks/useConversations.ts` so chat, agent, and flow pages all call the same conversation-working-folder edit API added on the server in `server/src/routes/conversations.ts`. That API must save or clear `flags.workingFolder` on an existing idle conversation and return the updated conversation summary that websocket `conversation_upsert` also publishes. Do not let each page hand-roll its own fetch request or response parsing, and follow the existing `client/src/api/agents.ts` and `client/src/api/flows.ts` request-shaping style.
3. [x] Update `client/src/hooks/useConversations.ts` so active conversation state reliably exposes `conversation.flags.workingFolder` for chat, agent, and flow conversations, and so websocket `conversation_upsert` events from `client/src/hooks/useChatWs.ts` can apply both saved values and explicit clears without a manual refresh. In that shared client state path, emit one browser-console marker `DEV_0000048_T6_PICKER_SYNC` whenever a picker restores, saves, clears, or locks, including the surface, conversation id, action, and resulting picker state, so the Task 7 and Task 11 Manual Playwright-MCP checks can verify those transitions exactly.
4. [x] Update `client/src/hooks/useChatStream.ts` and `client/src/pages/ChatPage.tsx` so chat adds its first working-folder picker, restores the saved folder from `conversation.flags.workingFolder`, allows idle edits through the `client/src/api/conversations.ts` helper that saves or clears `flags.workingFolder` on the existing conversation, and still includes `working_folder` in the existing chat run payload when a message is sent.
5. [x] In the new chat working-folder UI in `client/src/pages/ChatPage.tsx`, keep the picker disabled whenever `client/src/hooks/useChatStream.ts` reports an active run or websocket state from `client/src/hooks/useChatWs.ts` reports an inflight chat run. Do not allow optimistic editing while the server still considers the conversation busy, and reuse the existing inflight state rather than introducing a second busy-state source.
6. [x] Update `client/src/pages/AgentsPage.tsx` so the existing agent working-folder picker restores from `conversation.flags.workingFolder`, saves idle edits through the shared helper in `client/src/api/conversations.ts` or its wrapper in `client/src/hooks/useConversations.ts`, stays locked while an agent run is active, and returns to the normal empty state if the server clears an invalid saved path.
7. [x] Update `client/src/pages/FlowsPage.tsx` so the existing flow working-folder picker restores from `conversation.flags.workingFolder`, saves idle edits through the same shared helper in `client/src/api/conversations.ts` or `client/src/hooks/useConversations.ts`, stays locked while a flow run is active, and returns to the normal empty state if the server clears an invalid saved path.
8. [x] Add or extend one client unit test in `client/src/test/conversationsApi.workingFolder.test.ts` that proves the shared conversation-edit helper sends the correct payload when saving `workingFolder` for an existing conversation. The purpose of this test is to lock down the shared client API contract before multiple pages depend on it.
9. [x] Add or extend one client unit test in `client/src/test/conversationsApi.workingFolder.test.ts` that proves the shared conversation-edit helper sends the correct clear payload when the saved `workingFolder` is removed from an existing conversation. The purpose of this test is to lock down the client-side clear contract for the shared API helper.
10. [x] Add or extend one client unit test in `client/src/test/useConversations.source.test.ts` that proves a websocket `conversation_upsert` carrying `flags.workingFolder` updates the stored conversation state without a manual refresh. The purpose of this test is to make the shared websocket-restore happy path explicit at the hook level instead of assuming page tests cover it indirectly.
11. [x] Add or extend one client unit test in `client/src/test/useConversations.source.test.ts` that proves a websocket `conversation_upsert` carrying a cleared `flags.workingFolder` removes the saved value from stored conversation state without a manual refresh. The purpose of this test is to make the shared websocket-clear corner case explicit at the hook level instead of assuming page tests cover it indirectly.
12. [x] Add or extend one client unit test in `client/src/test/chatSendPayload.test.tsx` that proves chat run requests still include `working_folder` when a working folder is selected. The purpose of this test is to protect the chat run payload contract while chat also gains idle edit behavior.
13. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves chat restores the saved working folder from conversation state. The purpose of this test is to cover the main happy path for chat restore.
14. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves an idle edit on the chat picker saves through the shared conversation-edit helper. The purpose of this test is to make the new chat idle-save path explicit instead of inferring it from the agent and flow pages.
15. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves chat shows the normal empty state when no saved working folder exists. The purpose of this test is to cover the empty-state UI contract explicitly.
16. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves the chat picker becomes read-only while a run is active. The purpose of this test is to cover the local busy-state lock behavior.
17. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves websocket inflight state also locks the chat picker. The purpose of this test is to ensure local and realtime busy-state handling agree.
18. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves the chat picker returns to the normal empty state after the server clears an invalid saved path. The purpose of this test is to protect invalid-path recovery on the chat surface.
19. [x] Add or extend one client component test in `client/src/test/chatPage.workingFolder.test.tsx` that proves an idle user clear on the chat picker calls the shared conversation-edit helper and returns the UI to the normal empty state. The purpose of this test is to cover the manual clear path on the chat surface.
20. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves the agent picker restores the saved working folder from conversation state. The purpose of this test is to cover the main agent restore happy path.
21. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves the agent picker shows the normal empty state when no saved working folder exists. The purpose of this test is to cover the empty-state UI contract on the agent surface.
22. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves idle edits are saved through the shared conversation-edit helper. The purpose of this test is to lock down the shared idle-save behavior for agents.
23. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves the agent picker is locked while a run is active. The purpose of this test is to protect the run-lock behavior on the agent surface.
24. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves the agent picker returns to the normal empty state after the server clears an invalid saved path. The purpose of this test is to protect invalid-path recovery on the agent surface.
25. [x] Add or extend one client component test in `client/src/test/agentsPage.workingFolderPicker.test.tsx` that proves an idle user clear on the agent picker calls the shared conversation-edit helper and returns the UI to the normal empty state. The purpose of this test is to cover the manual clear path on the agent surface.
26. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves the flow picker restores the saved working folder from conversation state. The purpose of this test is to cover the main flow restore happy path.
27. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves the flow picker shows the normal empty state when no saved working folder exists. The purpose of this test is to cover the empty-state UI contract on the flow surface.
28. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves idle edits are saved through the shared conversation-edit helper. The purpose of this test is to lock down the shared idle-save behavior for flows.
29. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves the flow picker is locked while a run is active. The purpose of this test is to protect the run-lock behavior on the flow surface.
30. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves the flow picker returns to the normal empty state after the server clears an invalid saved path. The purpose of this test is to protect invalid-path recovery on the flow surface.
31. [x] Add or extend one client component test in `client/src/test/flowsPage.run.test.tsx` that proves an idle user clear on the flow picker calls the shared conversation-edit helper and returns the UI to the normal empty state. The purpose of this test is to cover the manual clear path on the flow surface.
32. [x] After all file-adding or file-removal subtasks in Task 7 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including any new shared client API helper, hook support file, page support file, or client test file created or deleted while implementing the picker restore and lock behavior.
33. [x] Update [`README.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) if the user-facing working-folder behavior described there is stale after the client changes. Document the saved-folder restore behavior, idle-edit behavior, and lock behavior visible to users. The purpose of this document update is to keep the main setup and usage guide aligned with the shipped client behavior.
34. [x] Update [`docs/developer-reference.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) if its working-folder guidance is stale after the client changes. Document the shared conversation-edit API usage, restore semantics, and lock rules for chat, agent, and flow pages. The purpose of this document update is to keep the developer-facing reference aligned with the shipped client behavior.
35. [x] Update this story file's Task 7 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the shared helper location and the final lock rules used by each page. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
36. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:client` - Use because this task changes client-only chat, agent, and flow pages plus supporting hooks. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client behavior covered by the full client suite. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted client wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` - Use because this task changes behavior that is testable from the front end. Allow up to 7 minutes; if `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted e2e wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end through the Dockerized stack. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm chat, agent, and flow working-folder restore, idle edit, clear, lock, and invalid-path-reset behavior, verify there are no logged errors in the debug console, and confirm the browser console contains `DEV_0000048_T6_PICKER_SYNC` for each exercised surface with the expected action values (`restore`, `save`, `clear`, or `lock`) and the expected resulting picker state. Capture screenshots for each exercised surface and state that proves the GUI matches the task expectations, store them in `playwright-output-local/`, and have the agent review those screenshots for correct picker values, disabled states, empty states, and general layout quality.
7. [x] `npm run compose:down`

#### Implementation notes

- Re-read the Task 7 acceptance, outcome, and edge-case sections plus the named chat/agent/flow client files; every surface must restore from `conversation.flags.workingFolder`, fall back to the normal empty state when no valid saved folder remains, keep direct commands tied to the owning agent conversation, and lock picker edits whenever a local or websocket-visible run is still active.
- Added shared client working-folder persistence in `client/src/api/conversations.ts` and `client/src/hooks/useConversations.ts`, including one idle-edit POST path for save or clear and normalized conversation summaries that keep `flags.workingFolder` available across REST loads and websocket upserts.
- Added shared `DEV_0000048_T6_PICKER_SYNC` marker emission plus hook helpers for reading and persisting working folders so the page work can reuse one restore, save, clear, and lock logging contract instead of diverging by surface.
- Updated chat so `useChatStream(...)` still sends `working_folder` at run start while the new chat picker restores saved folders, persists idle edits for existing conversations, and locks on either local send state or websocket-visible inflight state.
- Updated agents and flows so their existing pickers now restore from conversation flags, save and clear through the shared conversation edit helper when the selected conversation already exists, and emit the shared lock or restore markers without creating a separate direct-command conversation path.
- Added targeted client coverage for the new shared conversation API helper, websocket restore and clear handling in `useConversations`, chat run payload preservation, and the restore or save or clear or lock behavior on the chat, agent, and flow picker surfaces.
- `npm run build:summary:client` passed cleanly after fixing Task 7 typecheck issues around picker lock-effect ordering and the new conversation-edit helper wiring.
- Updated `projectStructure.md`, `README.md`, and `docs/developer-reference.md` so the new shared helper location (`client/src/api/conversations.ts`) plus the restore or idle-save or stale-clear or run-lock behavior are documented in the structure map, user guide, and developer reference together.
- Fixed the remaining chat picker test failures by teaching the shared chat websocket fetch harness to route `/conversations/:id/working-folder` requests ahead of the generic conversation-list fallback, then reran the full client wrapper successfully.
- `npm run test:summary:client` initially failed on the two chat idle save or clear tests; after the harness fix and a targeted rerun, the full client wrapper passed with `tests run: 568`, `passed: 568`, `failed: 0`.
- `npm run lint --workspaces` flagged one render-time ref read in `ChatPage`; I mirrored the inflight ref into state for the lock calculation, reran `npm run format --workspaces`, and then `npm run lint --workspaces` plus `npm run format:check --workspaces` both passed.
- Planning repair: Task 6 now owns the dockerized conversation-history visibility seam that blocked this client task. Leave Task 7 `__in_progress__` until Task 6 is complete, then rerun Task 7 testing steps 3-7 in order.
- After Task 6 landed, reran the full `npm run test:summary:e2e` wrapper and it passed cleanly with `tests run: 43`, `passed: 43`, `failed: 0`, so the remaining Task 7 proof can proceed on the repaired dockerized history path.
- `npm run compose:build:summary` passed cleanly with `items passed: 2` and `items failed: 0`, so the Dockerized manual-validation stack is ready to start without needing log inspection.
- `npm run compose:up` started the Dockerized stack cleanly and reached healthy server plus running client containers, so the manual Playwright-MCP checks can use `http://host.docker.internal:5001` as required.
- Manual Playwright-MCP validation at `http://host.docker.internal:5001` exercised restore, idle save, clear, run-lock, and stale-path reset behavior on chat, agents, and flows; captured reviewed screenshots in `playwright-output-local/`; and a clean replay tab confirmed `DEV_0000048_T6_PICKER_SYNC` restore markers for all three surfaces with no error-level browser console entries.
- `npm run compose:down` stopped and removed the Dockerized validation stack cleanly, so Task 7 now has the full wrapper-build, wrapper-test, manual-browser, and teardown proof chain completed in order.
---

### 8. Rename Server And Compose Environment Variables To `CODEINFO_`

- Task Status: `__done__`
- Git Commits: `71579bb3, f6321a91`

#### Overview

Perform the server-side and runtime-side portion of the env rename cutover. This task is only about server readers, server env files, wrapper/compose/runtime wiring, and the server tests that prove the new `CODEINFO_` names are the only supported repo-owned names.

#### Documentation Locations

- Node.js documentation via Context7 `/nodejs/node`, specifically `https://nodejs.org/api/process.html#processenv`, for `process.env` access and environment-variable parsing behavior
- Docker documentation via Context7 `/docker/docs`, specifically `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/`, for Compose environment-variable injection and env-file wiring
- Docker documentation via Context7 `/docker/docs`, specifically `https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/`, for `.env` interpolation rules and precedence that affect compose and wrapper updates

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before renaming env keys, re-read this story's `Description`, `Acceptance Criteria`, `Implementation Ideas`, and `Edge Cases And Failure Modes`, then inspect `server/src/config/startupEnv.ts`, `server/src/config/chatDefaults.ts`, `server/src/logger.ts`, `server/src/ingest/config.ts`, `server/src/routes/chat.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/lmstudio.ts`, `server/src/routes/ingestModels.ts`, `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, and `server/src/ingest/reingestService.ts`. Write a checklist in Task 8 `Implementation notes` of every `CODEINFO_` target name this task must implement before changing code.
2. [x] Update the server env readers in the files above so they consume only the renamed `CODEINFO_` variables. Reuse the existing `loadStartupEnv(...)` and `ensureStartupEnvLoaded(...)` flow in `server/src/config/startupEnv.ts`, keep the existing parsing logic in chat defaults, logging, ingest, LM Studio, and OpenAI code while swapping only the environment variable names they read, and emit one structured startup marker `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` with the resolved server env names and value sources so the manual regression step can search for that exact marker in stack logs.
3. [x] Update checked-in env and runtime wiring files including `server/.env`, `server/.env.local`, `server/.env.e2e` when present, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, and `scripts/docker-compose-with-env.sh` so they seed only the new `CODEINFO_` names and no longer set the legacy generic product-owned names.
4. [x] Update any checked-in user-facing copy or fixtures that still instruct the user to set the old server env names, including `client/src/components/ingest/IngestForm.tsx`, related server docs, and any test fixtures that display or seed those values.
5. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves startup env loading works with the renamed `CODEINFO_` variables. The purpose of this test is to cover the main happy path for the server env cutover.
6. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves startup defaults still resolve correctly when optional renamed `CODEINFO_` variables are absent. The purpose of this test is to keep the existing default-value path intact during the rename.
7. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves explicit renamed `CODEINFO_` values override defaults correctly when they are present. The purpose of this test is to keep the configured-value path intact during the rename.
8. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves required-key errors still fire when a required renamed `CODEINFO_` variable is missing. The purpose of this test is to preserve deterministic startup failures after the cutover.
9. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves a process which only sets the legacy names fails deterministically instead of silently succeeding. The purpose of this test is to ensure the cutover is clean rather than dual-read.
10. [x] Run repo-wide searches for every legacy server/runtime env name listed in this story and replace each remaining checked-in occurrence across compose files, wrapper scripts, tests, docs, and helper scripts so the cutover is complete rather than partial.
11. [x] Add or extend one server unit test in `server/src/test/unit/env-loading.test.ts` that proves checked-in defaults, test fixtures, and compose wiring no longer seed the old generic names alongside the new ones. The purpose of this test is to catch partial cutover drift in checked-in repo assets.
12. [x] Add or extend one server unit test in `server/src/test/unit/config.chatDefaults.test.ts` that proves `CODEINFO_CHAT_DEFAULT_PROVIDER` and `CODEINFO_CHAT_DEFAULT_MODEL` drive chat default selection after the rename. The purpose of this test is to catch any remaining direct-reader drift in the chat-default path.
13. [x] Add or extend one server unit test in `server/src/test/unit/ingest-models.test.ts` that proves `CODEINFO_OPENAI_EMBEDDING_KEY` and `CODEINFO_LMSTUDIO_BASE_URL` drive ingest model availability after the rename. The purpose of this test is to catch any remaining direct-reader drift in the ingest-models route.
14. [x] Update [`docs/developer-reference.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) with the final `CODEINFO_` names, the files that load them, and the legacy server env names removed by this task. The purpose of this document update is to keep the developer-facing env reference aligned with the shipped server configuration.
15. [x] Update this story file's Task 8 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final `CODEINFO_` mapping and any issue solved during the repo-wide cutover. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server env readers and runtime wiring. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server env behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Target rename checklist confirmed before code changes: `CODEINFO_LMSTUDIO_BASE_URL`, `CODEINFO_OPENAI_EMBEDDING_KEY`, `CODEINFO_CHAT_DEFAULT_PROVIDER`, `CODEINFO_CHAT_DEFAULT_MODEL`, `CODEINFO_INGEST_INCLUDE`, `CODEINFO_INGEST_EXCLUDE`, `CODEINFO_INGEST_TOKEN_MARGIN`, `CODEINFO_INGEST_FALLBACK_TOKENS`, `CODEINFO_INGEST_FLUSH_EVERY`, `CODEINFO_INGEST_COLLECTION`, `CODEINFO_INGEST_ROOTS_COLLECTION`, `CODEINFO_LOG_FILE_PATH`, `CODEINFO_LOG_LEVEL`, `CODEINFO_LOG_BUFFER_MAX`, `CODEINFO_LOG_MAX_CLIENT_BYTES`, `CODEINFO_LOG_INGEST_WS_THROTTLE_MS`, `CODEINFO_LOG_FILE_ROTATE`, and `CODEINFO_INGEST_TEST_GIT_PATHS`; the audit also confirmed compose/env files, wrapper scripts, ingest copy, and legacy env-driven tests must be updated in the same clean cutover.
- Subtask 2: renamed the live server readers to `CODEINFO_*` only across startup env loading, chat defaults, logging, ingest, LM Studio, MCP, and route-level runtime checks, and added the required `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` startup marker with per-name source metadata so stack logs can prove the cutover without exposing values.
- Subtask 3: updated `server/.env`, `server/.env.local`, `server/.env.e2e`, docker compose files, wrapper summaries, and `server/package.json` script envs so checked-in runtime wiring now seeds only `CODEINFO_*` names.
- Subtask 4: updated the ingest OpenAI banner/help text and related docs/copy to instruct users to set `CODEINFO_OPENAI_EMBEDDING_KEY` instead of the legacy server name.
- Subtask 5: rewrote `server/src/test/unit/env-loading.test.ts` around renamed `CODEINFO_*` startup loading so the main happy path proves `.env` plus `.env.local` loading still works after the cutover.
- Subtask 6: added absent/default coverage in `env-loading.test.ts` so optional renamed envs staying unset still leave default-driven behavior intact.
- Subtask 7: added explicit preseeded override coverage in `env-loading.test.ts` to prove runtime-supplied renamed values still win over checked-in file defaults.
- Subtask 8: added a deterministic missing-key assertion in `env-loading.test.ts` using the OpenAI provider path so required renamed env failures still surface `CODEINFO_OPENAI_EMBEDDING_KEY` after the cutover.
- Subtask 9: added a legacy-only negative case in `env-loading.test.ts` so a process that sets only `OPENAI_EMBEDDING_KEY` no longer silently enables the OpenAI path.
- Subtask 10: repo-wide searches over the Task 8 server scope now come back clean except for intentional negative assertions in `env-loading.test.ts`; all live readers, compose assets, docs, and helper scripts were updated off the legacy names.
- Subtask 11: added a checked-in asset drift test in `env-loading.test.ts` that scans server env files, compose files, wrappers, and `server/package.json` to ensure they seed only `CODEINFO_*` names.
- Subtask 12: updated `server/src/test/unit/config.chatDefaults.test.ts` to drive chat default selection with `CODEINFO_CHAT_DEFAULT_PROVIDER` and `CODEINFO_CHAT_DEFAULT_MODEL`, keeping the direct-reader regression coverage intact.
- Subtask 13: updated `server/src/test/unit/ingest-models.test.ts` to drive ingest model availability with `CODEINFO_OPENAI_EMBEDDING_KEY` and `CODEINFO_LMSTUDIO_BASE_URL`.
- Subtask 14: added a dedicated `Server CODEINFO env contract` section to `docs/developer-reference.md` that lists the renamed server env names, the files that load them, the startup marker, and the removed legacy names.
- Subtask 15: the final Task 8 mapping is now captured in this section; the main implementation issue solved during the cutover was avoiding a partial rename by updating wrapper/compose/test asset seeding and leaving only deliberate negative-check literals for legacy names in `env-loading.test.ts`.
- Subtask 16: `npm run lint --workspaces` passed; `npm run format:check --workspaces` first flagged server-side Prettier drift from the rename sweep, so I ran `npm run format --workspaces` and then reran `npm run format:check --workspaces` to a clean pass.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed on rerun via `npm run test:summary:server:unit` with `tests run: 1268`, `passed: 1268`, `failed: 0`, and `agent_action: skip_log`; the first full run caught a repo-root path bug in the new checked-in-asset drift test, which I fixed before rerunning the full wrapper.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.

---

### 9. Rename Client Build And Runtime Environment Variables To `VITE_CODEINFO_`

- Task Status: `__done__`
- Git Commits: `af6bea30, ebdfc129`

#### Overview

Perform the client-side portion of the env rename cutover. This task is only about client env readers, build/runtime injection, client/e2e tests, and the checked-in client docs that must move to the `VITE_CODEINFO_` names.

#### Documentation Locations

- Vite documentation via Context7 `/vitejs/vite`, specifically `https://vite.dev/guide/env-and-mode`, for `import.meta.env`, browser-exposed env-prefix rules, and mode-specific env behavior
- Docker documentation via Context7 `/docker/docs`, specifically `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/`, for runtime env injection into the client container and entrypoint
- Docker documentation via Context7 `/docker/docs`, specifically `https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/`, for compose interpolation rules that affect client build and e2e env wiring
- Jest documentation via Context7 `/jestjs/jest` and `https://jestjs.io/docs/getting-started`, for the client unit and component tests in `client/src/test/` that verify the renamed `VITE_CODEINFO_` readers
- Playwright documentation via Context7 `/microsoft/playwright` and `https://playwright.dev/docs/intro`, for the browser e2e env-drift test planned in `e2e/env-runtime-config.spec.ts`

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before renaming client env keys, re-read this story's `Description`, `Acceptance Criteria`, `Implementation Ideas`, and `Edge Cases And Failure Modes`, then inspect `client/src/api/baseUrl.ts`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/pages/LmStudioPage.tsx`, `client/src/logging/transport.ts`, `client/entrypoint.sh`, and `client/Dockerfile`. Write a checklist in Task 9 `Implementation notes` of every `VITE_CODEINFO_` target that must replace a checked-in client or e2e legacy name, and separately note which legacy names are documentation-only so the task does not invent new runtime readers.
2. [x] Update the client env readers in `client/src/api/baseUrl.ts`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/pages/LmStudioPage.tsx`, `client/src/logging/transport.ts`, and any nearby runtime-config helpers so they consume the renamed `VITE_CODEINFO_` variables. Reuse the existing runtime config flow instead of introducing a second client config loader, limit the code changes to real runtime readers such as API URL, LM Studio URL, log forwarding, and log max bytes, and emit one browser-console marker `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with the resolved client runtime-config fields so the Task 9 and Task 11 Manual Playwright-MCP checks can verify that exact marker.
3. [x] Update `client/entrypoint.sh`, `client/Dockerfile`, checked-in client env files, compose injection, and any e2e or build-time env injection under `client/`, `e2e/`, `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` so runtime config generation and built assets use the renamed variables consistently.
4. [x] Add or extend one client unit test in `client/src/test/baseUrl.env.test.ts` that proves `getApiBaseUrl()` honors `VITE_CODEINFO_API_URL` when runtime config is absent. The purpose of this test is to cover the main API URL runtime reader introduced by the client env rename.
5. [x] Add or extend one client unit test in `client/src/test/logging/transport.test.ts` that proves the renamed `VITE_CODEINFO_` logging env values are honored by the browser logging transport. The purpose of this test is to cover the main happy path for renamed client env readers.
6. [x] Add or extend one client component test in `client/src/test/lmstudio.test.tsx` that proves the renamed `VITE_CODEINFO_` LM Studio env values are honored by the LM Studio surface. The purpose of this test is to cover the main happy path for renamed client URL wiring.
7. [x] Add or extend one client unit test in `client/src/test/logging/transport.test.ts` that proves the old checked-in client env names are ignored as runtime inputs after the cutover. The purpose of this test is to ensure the client rename is a clean cutover rather than dual-read behavior.
8. [x] Add or extend one client unit test in `client/src/test/logging/transport.test.ts` that proves documentation-only log env names do not accidentally become live runtime config paths. The purpose of this test is to stop the rename work from silently adding new unsupported inputs.
9. [x] Run repo-wide searches for the legacy checked-in client and e2e env names listed in this story and replace each remaining repo-owned occurrence. Treat `VITE_LOG_LEVEL` and `VITE_LOG_STREAM_ENABLED` as documentation cleanup only unless a checked-in runtime consumer was intentionally added earlier in the story.
10. [x] Add or extend one browser e2e test in `e2e/env-runtime-config.spec.ts` that proves compose-injected runtime config and built assets use the same renamed `VITE_CODEINFO_` values and cannot silently disagree. The purpose of this test is to catch runtime-versus-build drift after the env rename.
11. [x] After all file-adding or file-removal subtasks in Task 9 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including any new browser e2e spec, runtime-config helper, env support file, or test file created or deleted during the client env cutover.
12. [x] Update [`README.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with the final client-side `VITE_CODEINFO_` names that a user or developer must set to run the product. The purpose of this document update is to keep the main setup and usage guide aligned with the shipped client env contract.
13. [x] Update [`docs/developer-reference.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) with the final client-side env contract, including which `VITE_CODEINFO_` names are real runtime readers and which old log env names were documentation-only cleanup. The purpose of this document update is to keep the developer-facing env reference aligned with the shipped client configuration.
14. [x] Update [`design.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with the client runtime-config architecture introduced by this task, including how built assets and injected runtime config share the same renamed `VITE_CODEINFO_` values. The purpose of this document update is to keep the architecture reference aligned with the shipped client env behavior.
15. [x] Update this story file's Task 9 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the final runtime-reader names and any issue solved during the client env cutover. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:client` - Use because this task changes client env readers, runtime injection, and browser-facing config behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client env behavior covered by the full client suite. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted client wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` - Use because this task changes browser/runtime env behavior that is testable end to end. Allow up to 7 minutes; if `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted e2e wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end through the Dockerized stack. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm runtime-config injection, API URL wiring, LM Studio wiring, and env-driven client behavior, verify there are no logged errors in the debug console, and confirm the browser console contains `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with the expected resolved runtime fields after the page loads. Capture screenshots of the relevant UI states that prove the env-driven front-end behavior is correct, store them in `playwright-output-local/`, and have the agent review those screenshots for the expected URLs, labels, visible status text, and overall GUI correctness.
7. [x] `npm run compose:down`

#### Implementation notes

- Checklist: rename checked-in client/e2e readers and wiring to `VITE_CODEINFO_API_URL`, `VITE_CODEINFO_LMSTUDIO_URL`, `VITE_CODEINFO_LOG_FORWARD_ENABLED`, and `VITE_CODEINFO_LOG_MAX_BYTES` across `client/src`, `client/.env*`, compose build args, Dockerfile args/env, entrypoint runtime injection, and e2e overrides/specs.
- Documentation-only cleanup: remove legacy `VITE_LOG_LEVEL` and `VITE_LOG_STREAM_ENABLED` references from checked-in docs/env examples without adding new runtime readers for them.
- Subtask 2: added `client/src/config/runtimeConfig.ts` so API URL, LM Studio URL, log forwarding, and log max-bytes resolve through one shared runtime-first helper and emit `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` once in the browser.
- Subtask 3: rewired `client/entrypoint.sh`, `client/Dockerfile`, `client/.env*`, compose files, and e2e init-script overrides to the renamed `VITE_CODEINFO_*` contract so build-time and runtime injection use the same names.
- Subtask 4: added `client/src/test/baseUrl.env.test.ts` to prove `getApiBaseUrl()` uses `VITE_CODEINFO_API_URL` when `window.__CODEINFO_CONFIG__` is absent.
- Subtask 5: extended `client/src/test/logging/transport.test.ts` to prove the renamed logging env values still drive log transport happy-path behavior.
- Subtask 6: extended `client/src/test/lmstudio.test.tsx` to prove `VITE_CODEINFO_LMSTUDIO_URL` feeds the LM Studio default UI state.
- Subtask 7: extended `client/src/test/logging/transport.test.ts` to prove the old checked-in client env names are ignored after the cutover.
- Subtask 8: kept `VITE_LOG_LEVEL` and `VITE_LOG_STREAM_ENABLED` documentation-only by adding a regression test that they do not change runtime transport behavior.
- Subtask 9: replaced remaining checked-in legacy client/e2e env occurrences and left only explicit documentation-only mentions plus tests that assert those legacy names are ignored.
- Subtask 10: added `e2e/env-runtime-config.spec.ts` to prove `window.__CODEINFO_CONFIG__` and the browser runtime marker agree on the renamed injected values.
- Subtask 11: updated `projectStructure.md` with the new runtime-config helper, client unit test, and e2e env-runtime spec.
- Subtask 12: updated `README.md` with the final client env contract and clarified that the old log-level/stream names are not live runtime readers.
- Subtask 13: updated `docs/developer-reference.md` with the renamed client runtime readers, runtime-config marker, and documentation-only legacy cleanup rule.
- Subtask 14: updated `design.md` to document the shared runtime-config helper, the runtime/build alignment, and the renamed client logging behavior.
- Subtask 15: final runtime-reader set is `VITE_CODEINFO_API_URL`, `VITE_CODEINFO_LMSTUDIO_URL`, `VITE_CODEINFO_LOG_FORWARD_ENABLED`, and `VITE_CODEINFO_LOG_MAX_BYTES`; the main implementation issue solved was eliminating runtime-versus-build drift by moving all browser readers onto one runtime-first resolver instead of scattered direct env reads.
- Subtask 16: `npm run lint --workspaces` passed; `npm run format:check --workspaces` initially flagged `client/src/config/runtimeConfig.ts`, so `npm run format --workspaces` was run and the full format check then passed cleanly.
- Testing 1: `npm run build:summary:client` initially failed on pre-existing client test harness TypeScript narrowing, so the fetch helpers were tightened and the full wrapper rerun passed with `status: passed` and `warning_count: 0`.
- Testing 2: `npm run test:summary:client` passed cleanly with `tests run: 572`, `passed: 572`, and `failed: 0`, covering the new runtime-config, transport, and LM Studio assertions.
- Testing 3: the first `npm run test:summary:e2e` run failed during Docker build with a transient server-image `npm ci` `ECONNRESET`, so the full wrapper was retried once per repo policy; the retry passed with `tests run: 44`, `passed: 44`, and `failed: 0`, including the new `e2e/env-runtime-config.spec.ts`.
- Testing 4: `npm run compose:build:summary` passed cleanly with `items passed: 2` and `items failed: 0`, confirming the renamed client env contract still builds in the main Docker stack.
- Testing 5: `npm run compose:up` started a healthy main stack with `codeinfo2-server-1` and `codeinfo2-client-1` both healthy on ports `5010` and `5001`.
- Testing 6: Manual Playwright-MCP verification at `http://host.docker.internal:5001` confirmed `window.__CODEINFO_CONFIG__` resolved `apiBaseUrl=http://host.docker.internal:5010`, `lmStudioBaseUrl=http://host.docker.internal:1234`, `logForwardEnabled=true`, and `logMaxBytes=32768`; Home showed both client/server versions, LM Studio showed the renamed default URL, console marker `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` appeared with runtime sources, no error-level console messages were present, and screenshots were captured as `/tmp/playwright-output/playwright-output-local/task9-home.png` and `/tmp/playwright-output/playwright-output-local/task9-lmstudio.png`.
- Testing 7: `npm run compose:down` stopped and removed the main client/server/manual-verification stack cleanly after the runtime-config checks completed.

---

### 10. Replace OpenAI Heuristic Counting With Tokenizer-Backed Counting

- Task Status: `__done__`
- Git Commits: `df44e055, c715aed6, 77e4d440`

#### Overview

Replace the current OpenAI token-counting heuristic with one tokenizer-backed implementation that is used consistently by guardrails, the OpenAI provider, and chunk sizing. This task is only about the OpenAI ingest path and its tests; it must not expand into broader ingest batching redesign work.

#### Documentation Locations

- OpenAI API documentation via Context7 `/websites/developers_openai_api`, specifically `https://platform.openai.com/docs/guides/embeddings`, for embeddings model usage and current input-limit guidance
- OpenAI API reference via Context7 `/websites/developers_openai_api`, specifically `https://platform.openai.com/docs/api-reference/embeddings`, for request and response contract details that affect provider integration and error handling
- OpenAI Node SDK documentation via Context7 `/openai/openai-node` for the current Node or TypeScript client patterns used by the embeddings provider
- DeepWiki `dqbd/tiktoken` page `3.1 WASM Bindings` for explicit `free()` and lifecycle behavior in the WASM-backed tokenizer implementation
- DeepWiki `dqbd/tiktoken` page `3.2 Pure JavaScript (js-tiktoken)` for pure-JavaScript tokenizer construction and counting behavior when a JS fallback is needed
- DeepWiki `dqbd/tiktoken` page `3.3 Usage and Examples` for concrete token-counting usage patterns that can be mirrored in the shared tokenizer helper

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before changing the OpenAI ingest path, re-read this story's `Description`, `Acceptance Criteria`, `Implementation Ideas`, `Research Findings`, and `Edge Cases And Failure Modes`, then inspect `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/chunker.ts`, `server/src/ingest/providers/openaiConstants.ts`, and `server/src/ingest/providers/openaiErrors.ts`. Record in Task 10 `Implementation notes` the non-negotiable rules for this task: prefer Node `tiktoken`, keep the real 8192-token limit, preserve the existing non-token guardrails, and never silently fall back to the old heuristic or whitespace estimate for OpenAI.
2. [x] Add the tokenizer dependency or dependencies in the server workspace and create one shared tokenizer helper module for the OpenAI ingest path. Put initialization, token counting, reuse, and cleanup in that helper so `openaiGuardrails`, `openaiEmbeddingProvider`, and `chunker` all call the same implementation. If a fallback implementation is required, it must still be tokenizer-backed and its activation rule must be documented in Task 10 `Implementation notes`.
3. [x] Replace `estimateOpenAiTokens(...)` usage in `server/src/ingest/providers/openaiGuardrails.ts` and `server/src/ingest/providers/openaiEmbeddingProvider.ts` so both preflight guardrails and provider `countTokens()` use the shared tokenizer helper and the corrected 8192-token limit from `server/src/ingest/providers/openaiConstants.ts`.
4. [x] Update `server/src/ingest/chunker.ts` and any related oversized-input classifier code such as `server/src/ingest/providers/openaiErrors.ts` so chunk sizing and oversized-input detection use the same tokenizer-backed counts, tokenizer failures raise clear ingest errors instead of silently falling back to whitespace estimation, and successful counting emits one structured marker `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT` with the provider, model, counted-token total, and counting path so the manual regression step can search for that exact marker in stack logs.
5. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` that proves tokenizer-backed counting blocks an oversized OpenAI input before the request is sent upstream. The purpose of this test is to cover the main guardrail path after replacing the heuristic.
6. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` that proves blank-input handling still behaves correctly after the tokenizer-backed change. The purpose of this test is to ensure non-token guardrails were not weakened by the refactor.
7. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` that proves max-input-count handling still behaves correctly after the tokenizer-backed change. The purpose of this test is to preserve existing non-token limits.
8. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider.test.ts` that proves the OpenAI provider count path uses the shared tokenizer-backed helper rather than a separate heuristic. The purpose of this test is to keep the provider aligned with the new shared counting contract.
9. [x] Add or extend one server unit test in `server/src/test/unit/chunker.test.ts` that proves chunk sizing uses the same tokenizer-backed helper as the provider and guardrails. The purpose of this test is to stop the chunker from drifting back to a different counting path.
10. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` that proves an input at exactly 8192 tokens is accepted. The purpose of this test is to lock down the exact provider-truth boundary on the allowed side.
11. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` that proves an input just over 8192 tokens is rejected with the expected oversized-input classification. The purpose of this test is to lock down the exact provider-truth boundary on the rejected side.
12. [x] Add or extend one server unit test in `server/src/test/unit/openai-provider.test.ts` that proves tokenizer initialization failure produces a clear ingest error and does not fall back to the old heuristic. The purpose of this test is to cover the tokenizer setup failure mode.
13. [x] Add or extend one server unit test in `server/src/test/unit/chunker.test.ts` that proves tokenizer counting failure during execution also produces a clear ingest error and does not fall back to whitespace estimation. The purpose of this test is to cover the runtime failure path separately from initialization failure.
14. [x] After all file-adding or file-removal subtasks in Task 10 are complete, update [`projectStructure.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list every file added or removed by this task, including every tokenizer helper, dependency-related support file, and test file created or deleted by the OpenAI counting work. The purpose of this document update is to keep the repository structure map accurate for later contributors.
15. [x] Update this story file's Task 10 `Implementation notes` section in [`planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md) with the chosen tokenizer package, the helper location, and any cleanup or initialization behavior that mattered. The purpose of this document update is to preserve story-local implementation context for reviewers and future follow-up tasks.
16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Use because this task changes server ingest and tokenizer code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server ingest behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server behavior and full server regression should still pass. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Non-negotiable rules: prefer Node `tiktoken`, keep the OpenAI per-input limit at exactly `8192`, preserve blank-input and max-input-count guardrails, and never silently fall back to the old heuristic or whitespace estimation for OpenAI counting failures.
- Subtask 2: added `tiktoken` to the server workspace and created `server/src/ingest/providers/openaiTokenizer.ts` as the shared cached `cl100k_base` helper with explicit `free()` cleanup and test seams instead of keeping separate counting paths.
- Subtask 3: rewired `openaiGuardrails` and the OpenAI provider model `countTokens()` to the shared helper and corrected the default per-input limit from `8191` to `8192`.
- Subtask 4: updated `chunker` to route allowlisted OpenAI models through the shared helper, added explicit `OPENAI_TOKENIZER_FAILED` classification, and emitted `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT` with provider/model/path metadata on successful counts.
- Subtasks 5-13: replaced the old heuristic-only assertions with tokenizer-backed guardrail, provider, and chunker tests covering oversize blocking, blank-input and max-input-count preservation, exact `8192` pass / `8193` fail boundaries, and both tokenizer initialization and runtime failure modes without whitespace fallback.
- Subtask 14: updated `projectStructure.md` with the new tokenizer helper and the exact dependency/code/test files touched by the OpenAI counting cutover.
- Subtask 15: documented the chosen Node `tiktoken` package, the shared helper location, and the cached-encoder cleanup behavior in this task so reviewers can trace the tokenizer lifecycle quickly.
- Subtask 16: `npm run lint --workspaces` passed after fixing one chunker import-order warning, `npm run format:check --workspaces` initially flagged the new tokenizer files/tests, and `npm run format --workspaces` brought the tree back to a clean full-check pass.
- Testing 1: `npm run build:summary:server` passed cleanly with `status: passed` and `warning_count: 0`, so the tokenizer cutover compiles in the server workspace without additional build fixes.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with `tests run: 1275`, `passed: 1275`, and `failed: 0`, covering the new tokenizer-backed guardrail, provider, and chunker assertions in the full server unit/integration wrapper.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so the tokenizer-backed OpenAI changes did not break the existing higher-level server feature coverage.

---

### 11. Final Validation, Documentation, And Acceptance Review

- Task Status: `__done__`
- Git Commits: `276054d2, 3b5056e5`

#### Overview

This final task proves the full story is complete against the acceptance criteria. It performs the full wrapper-based validation matrix, updates the final documentation, runs a manual browser check with Playwright MCP, saves evidence screenshots, and prepares the pull-request summary for the entire story.

#### Documentation Locations

- Docker documentation via Context7 `/docker/docs`, especially the Compose build and environment pages, for final wrapper-based validation and container lifecycle checks
- Playwright documentation via Context7 `/microsoft/playwright` and `https://playwright.dev/docs/intro`, for manual browser verification flow and screenshot capture expectations
- Jest documentation via Context7 `/jestjs/jest` and `https://jestjs.io/docs/getting-started`, for interpreting client test output and rerun guidance during final validation
- Cucumber guides `https://cucumber.io/docs/guides/`, especially `https://cucumber.io/docs/guides/testable-architecture/`, for keeping higher-level feature coverage maintainable and aligned with stable automation practices
- Mermaid documentation via Context7 `/mermaid-js/mermaid` and `https://mermaid.js.org/intro/`, for any final diagram updates made in `design.md`

Single-subtask rule: assume a junior developer may read only one subtask from this task. Every subtask below must therefore be treated as self-contained: read the documentation links above first, then inspect every file path named inside that subtask before editing code or tests.

#### Subtasks

1. [x] Before final validation, re-read this story's full `Acceptance Criteria`, `Expected Outcomes`, and `Edge Cases And Failure Modes`, then create an explicit checklist in Task 11 `Implementation notes` that maps each acceptance item to one proof source such as a wrapper test, an e2e run, a manual Playwright check, or a documentation update.
2. [x] Update `README.md` with every command, env name, and user-facing working-folder behavior introduced by this story so a new developer can run and understand the feature without reading the full plan.
3. [x] Update `design.md` with the final repository-order contract, working-folder persistence flow, env rename behavior, and tokenizer-backed OpenAI counting. Include any Mermaid updates needed so the design docs match the finished implementation rather than the pre-story behavior.
4. [x] Update `projectStructure.md` with every file added or removed anywhere in story 48, including helper modules, test files, and any new route or client API files created during the story.
5. [x] Update `docs/developer-reference.md` with the final env naming, working-folder restore and lock behavior, and the lookup/debugging guidance that explains what appears in structured logs versus persisted runtime metadata.
6. [x] Create a pull-request summary comment that covers every implemented area in this story: shared resolver helper, command and markdown lookup changes, persistence, server routes, client UI behavior, env cutover, OpenAI tokenizer work, tests, and documentation.
7. [x] Update this story file's Task 11 `Implementation notes` with the completed acceptance checklist, the wrapper commands run, the final results, and the exact paths of any screenshots or manual proof artifacts saved during validation.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the wrapper commands below. Do not run raw build or test commands directly. Only open full logs when a wrapper reports failure, unexpected warnings, or ambiguous counts; diagnose with targeted wrapper commands only after a full wrapper fails, then rerun the full wrapper.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the completed story changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the completed story changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the completed story changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted server-unit wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the completed story changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted cucumber wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the completed story changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary, diagnose with targeted client wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` - Mandatory final regression check because the completed story changes behavior testable through the full app. Allow up to 7 minutes; if `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted e2e wrapper commands only after the full wrapper fails, then rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm the finished chat, agent, and flow working-folder behavior, env rename behavior, and general regression checks, including verifying there are no logged errors in the debug console. While exercising those flows, also confirm the browser console or running stack logs contain the exact markers `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER`, `DEV_0000040_T11_FLOW_RESOLUTION_ORDER`, `DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER`, `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`, `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`, `DEV_0000048_T6_PICKER_SYNC`, `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`, and `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT`, and verify each appears with the expected success fields for the exercised path. Capture screenshots for every acceptance item that can be confirmed through the GUI, store them in `playwright-output-local/` because that folder is mapped in `docker-compose.local.yml`, and have the agent review those screenshots alongside the log markers to confirm the GUI meets the story expectations before also copying or naming the final evidence set for `test-results/screenshots/` using names of the form `0000048-11-<short-name>.png`.
10. [x] `npm run compose:down`

#### Implementation notes

- Acceptance checklist: repository-order helper, duplicate-dedupe, nested restart, flow/direct command resolution, markdown resolution, fail-fast not-found-only fallback, and compact lookup metadata are proved by completed Tasks 1-4 notes plus final server unit/cucumber wrappers and the final manual marker checks for `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER`, `DEV_0000040_T11_FLOW_RESOLUTION_ORDER`, and `DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER`.
- Acceptance checklist: working-folder persistence, restore, idle edit, invalid-path clearing, child-conversation inheritance, and locked picker behavior are proved by completed Tasks 4-7 notes plus the final client/e2e wrappers, manual GUI checks across chat/agents/flows, and final marker checks for `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`, `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`, and `DEV_0000048_T6_PICKER_SYNC`.
- Acceptance checklist: server/browser env rename cutover, checked-in env usage parity, and no-old-name documentation drift are proved by completed Tasks 8-9 notes plus final repo-doc updates, final build/test wrappers, manual runtime-config verification, and final marker checks for `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` and `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`.
- Acceptance checklist: tokenizer-backed OpenAI counting, exact 8192 boundary, no heuristic fallback, and oversized-input classification are proved by completed Task 10 notes plus the final server build/unit/cucumber wrappers and final stack-log/manual marker verification for `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT`.
- Acceptance checklist: expected outcomes about working-repo-first behavior, empty-state recovery, direct-command ownership, debug visibility, env consistency, and tokenizer-backed upstream blocking are proved by the combined final wrappers, manual Playwright checks, screenshot evidence, and final doc updates in `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md`.
- Acceptance checklist: out-of-scope protections remain unchanged because the final proof relies on existing command/markdown subfolder conventions, existing fail-fast behavior, existing transport-specific networking rules, and the limited tokenizer bug-fix scope rather than any new path syntax, new reference type, or broader ingest redesign.
- Subtask 1: re-read the story acceptance, outcome, and failure-mode sections and converted them into this proof checklist before final validation so each final wrapper/manual/doc step can be tied back to one explicit acceptance source.
- Subtask 2: updated `README.md` with one Story 48 contract section covering the final working-folder behavior, env names, lookup order, tokenizer rule, and the final wrapper command set for full-story regression.
- Subtask 3: updated `design.md` with a final Story 48 contract summary and Mermaid flow so the shipped repository-order, persistence, env, and tokenizer behavior is documented in one place instead of being scattered only across task-specific notes.
- Subtask 4: added a story-level final implementation footprint to `projectStructure.md`, including every added file across Story 48 and a concise story-wide traceability list for the core files touched by the feature.
- Subtask 5: extended `docs/developer-reference.md` with the final Story 48 lookup, working-folder, runtime-metadata, and debugging-marker contract so operators know what lives in logs versus persisted metadata.
- Subtask 6: created `planning/0000048-pr-summary.md` as the maintained PR-summary artifact covering resolver behavior, persistence, env cutover, tokenizer work, validation, and final Story 48 markers.
- Subtask 8: `npm run lint --workspaces` and `npm run format:check --workspaces` both passed cleanly after the final doc and plan edits, so the story closeout started from a clean repo-wide lint/format baseline.
- Testing 1: `npm run build:summary:server` passed cleanly with `status: passed` and `warning_count: 0`, confirming the final story state still compiles in the server workspace.
- Testing 2: `npm run build:summary:client` passed cleanly with `status: passed` and `warning_count: 0`, so the final Story 48 client/runtime documentation updates did not introduce build or typecheck regressions.
- Testing 3: `npm run test:summary:server:unit` passed cleanly with `tests run: 1275`, `passed: 1275`, and `failed: 0`, confirming the full server unit/integration suite still covers the completed Story 48 contracts without regressions.
- Testing 4: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, preserving the higher-level server feature coverage in the final acceptance pass.
- Testing 5: `npm run test:summary:client` passed cleanly with `tests run: 572`, `passed: 572`, and `failed: 0`, confirming the final client restore/lock/runtime-config behavior remains covered in the full client suite.
- Testing 6: `npm run test:summary:e2e` passed cleanly with `tests run: 41`, `passed: 41`, and `failed: 0`, so the full browser-level regression wrapper completed without setup, test, or teardown failures in the final pass.
- Testing 7: `npm run compose:build:summary` passed cleanly with `items passed: 2` and `items failed: 0`, confirming the final main-stack images build successfully before manual verification.
- Testing 8: `npm run compose:up` started the final manual-verification stack successfully; Mongo became healthy first, then `codeinfo2-server-1` reached healthy state and `codeinfo2-client-1` started on the expected compose stack.
- Subtask 7: completed the final Task 11 notes with the wrapper matrix, acceptance-proof mapping, manual marker verification, and the final screenshot artifact paths so the story closeout is self-contained in this plan.
- Testing 9: Manual Playwright-MCP verification at `http://host.docker.internal:5001` reconfirmed `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` on home load, restored `/app` in the seeded chat, agent, and flow conversations with fresh `DEV_0000048_T6_PICKER_SYNC` browser-console entries, showed `http://host.docker.internal:1234` on LM Studio, returned no error-level browser console messages, and verified the server `/logs` markers `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER`, `DEV_0000040_T11_FLOW_RESOLUTION_ORDER`, `DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER`, `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`, `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`, `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, and `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT` with success-path fields after exercising the real conversation-edit, flow-command, markdown, env, and OpenAI ingest routes. Final GUI evidence was saved as `test-results/screenshots/0000048-11-home.png`, `test-results/screenshots/0000048-11-chat-restore.png`, `test-results/screenshots/0000048-11-agents-restore.png`, `test-results/screenshots/0000048-11-flows-restore.png`, `test-results/screenshots/0000048-11-lmstudio.png`, and mirrored into `playwright-output-local/playwright-output-local/` with the same names.
- Testing 10: `npm run compose:down` stopped and removed the final manual-verification stack cleanly after the Story 48 marker checks and screenshot capture completed, so the repo finished Task 11 with no running compose resources left behind.
---




## Code Review Findings

Review pass `0000048-review-20260317T011804Z-b791cfd6` reopened Story 48 after branch-vs-main review against `main` identified one `must_fix` and three `should_fix` findings. The durable review artifacts for this reopen are [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md) and [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md).

### Findings Summary

- `must_fix` `plan_contract_issue`: chat validation still accepts non-ingested absolute `working_folder` paths, so chat does not yet enforce the same canonical ingested-repository contract already used by agents, flows, and the new conversation working-folder edit route.
- `should_fix` `generic_engineering_issue`: working-folder restore currently collapses every `fs.stat(...)` failure into `WORKING_FOLDER_NOT_FOUND`, so unreadable or transient filesystem failures are treated as stale-path clears instead of actionable operational errors.
- `should_fix` `generic_engineering_issue`: repository candidate de-duplication lowercases resolved paths, which can collapse two distinct repositories on case-sensitive filesystems even though the story only intended true duplicate identities to be removed.
- `should_fix` `generic_engineering_issue`: the shared client runtime-config helper silently defaults malformed canonical `VITE_CODEINFO_*` inputs to env/default success values without any explicit warning path, which hides misconfiguration after the env cutover.

### Acceptance Criteria Proof Snapshot

The review evidence pass explicitly classified the current proof status for every acceptance criterion before reopening the story. Those statuses remain the baseline for the follow-up tasks below:

1. Shared repository candidate order for command and flow lookup: `direct`
2. One shared repository-candidate builder across flow-command and markdown resolution: `direct`
3. Nested lookup restarts from the full four-place order on every hop: `indirect`
4. Duplicate repositories are removed while preserving first position: `direct`
5. Flow command-file lookup uses the four-place order: `direct`
6. Flow markdown-file lookup uses the four-place order: `direct`
7. Command-item markdown lookup inside flows uses the same order: `direct`
8. Direct command execution keeps working-first then owner-second semantics: `indirect`
9. Local `codeInfo2` flows search the working repository first: `indirect`
10. Ingested-repo-owned flows still search the working repository first: `indirect`
11. Working folder persists/restores across chats, agents, flows, and direct commands: `direct`
12. Direct command persistence stays on the owning agent conversation: `indirect`
13. Flow conversations and child agent conversations persist the inherited folder: `direct`
14. Chat fully participates in the working-folder contract: `direct`
15. GUI restore and empty-state behavior across existing conversations: `direct`
16. Canonical stored identity is the absolute repository root path: `direct`
17. Editable saved value lives on the owning conversation while each run stores its own snapshot: `direct`
18. Missing working repository skips slot one and logs the condition: `direct`
19. GUI allows idle working-folder edits on existing conversations: `direct`
20. GUI blocks working-folder edits while execution is active: `direct`
21. UI restore and runtime lookup use the same canonical signal: `indirect`
22. Flow-created/used agent conversations inherit the exact flow-step folder: `indirect`
23. Invalid saved working folders clear automatically and log a warning: `direct`
24. Invalid-folder clear happens before reuse and logs stale path plus owning record id/type: `direct`
25. Existing relative-path safety rules remain in place: `indirect`
26. Fallback continues only for not-found outcomes: `direct`
27. Observability logs and docs are updated for candidate order and selected repository: `direct`
28. Structured lookup logs include the minimum required fields: `direct`
29. Execution metadata stores a compact lookup summary without broad API-response expansion: `direct`
30. Documentation includes a nested-reference example: `indirect`
31. Repository-owned env vars are renamed to `CODEINFO_` and browser-facing vars to `VITE_CODEINFO_`: `direct`
32. Env rename updates defaults/examples/compose/e2e/wrappers/docs consistently: `direct`
33. Env rename is a single clean cutover with no temporary dual-read compatibility: `direct`
34. No checked-in repo-owned file still references the old generic env names: `indirect`
35. The env rename inventory covers the checked-in product-owned families: `indirect`
36. The defined env target names were implemented exactly unless another checked-in repo-owned variable also required prefixing: `indirect`
37. OpenAI counting no longer uses the heuristic for guardrails and chunk sizing: `direct`
38. OpenAI counting uses a real tokenizer recommendation and prefers Node `tiktoken`: `direct`
39. OpenAI hard limit is corrected to 8192 while margin remains separate: `direct`
40. Token-margin behavior remains the soft safety mechanism and is documented: `indirect`
41. Oversized OpenAI inputs are classified deterministically as input-too-large: `direct`
42. The OpenAI bug-fix scope stayed limited to tokenizer counting/classification/regression coverage: `indirect`
43. Tokenizer-backed counting replaced the heuristic everywhere it influenced OpenAI ingest decisions: `direct`
44. Guardrails and provider `countTokens(...)` now share the same tokenizer-backed implementation: `direct`
45. OpenAI paths do not fall back to the old heuristic or whitespace estimation on tokenizer failure: `direct`
46. Tokenizer lifecycle handling is explicit and documented: `direct`

### Succinctness Review

The implemented behavior mostly matches the required scope, but the review identified three areas where the code is more permissive or more implicit than the plan intended and therefore needs follow-up rather than simplification-only notes:

- chat validation currently uses a looser working-folder contract than the other surfaces;
- stale-path detection currently hides too much filesystem detail by treating all `fs.stat(...)` failures as stale/not-found;
- the shared candidate-order and runtime-config helpers currently default or normalize in ways that can hide contradictions instead of surfacing them clearly.

The resolver, persistence, env-cutover, and tokenizer work otherwise remain within the planned scope. The follow-up tasks below are intended to tighten those weak spots without broadening Story 48 beyond the review findings.

### 12. Align Chat Working-Folder Validation With The Ingested-Repository Contract

- Task Status: `__done__`
- Git Commits: `e437214b, 60215a78, c4148cf2, 425f99fd`

#### Overview

Close the `must_fix` review finding by making chat use the same ingested-repository validation contract already enforced by agents, flows, and the conversation working-folder edit route. This task is only about chat request validation and the immediate chat-run call path; it must not broaden the working-folder feature beyond parity with the existing Story 48 surfaces.

#### Subtasks

1. [x] Re-read the review finding in `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, then inspect `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`. Record in Task 12 `Implementation notes` the current contract mismatch: chat validation accepts any existing absolute directory, while the other surfaces also enforce known-ingested repository membership.
2. [x] Update the chat request path so a provided `working_folder` is validated against the same known repository set used by the other Story 48 working-folder entry points. Keep the canonical absolute-path contract unchanged and do not add a legacy fallback for non-ingested directories.
3. [x] Ensure the final chat-run persistence/logging path still records the requested working folder only after the ingested-repository check succeeds. Do not leave two different validation decisions in `chatValidators` and `chat.ts`.
4. [x] Add or extend one server unit or integration test that proves `POST /chat` rejects an existing absolute directory when it is not one of the ingested repositories.
5. [x] Add or extend one server unit or integration test that proves `POST /chat` still accepts an existing absolute directory when it is ingested and otherwise valid.
6. [x] Update this story file's Task 12 `Implementation notes` with the chosen validation point and the exact parity rule now shared with the other working-folder surfaces.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server-side chat validation and working-folder persistence behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server/common request validation and persistence behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common chat behavior that should still satisfy feature-level server coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the review finding plus `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`; the mismatch was exactly as reported: chat validation only checked “absolute existing directory,” while the other Story 48 working-folder entry points also required membership in the known ingested repository set.
- Chose `validateChatRequest(...)` as the single validation point and threaded `knownRepositoryPaths` into it, so chat now uses the same shared `validateRequestedWorkingFolder(...)` parity rule as the other working-folder surfaces instead of making a second ingested-repository decision later in `chat.ts`.
- Updated `server/src/routes/chat.ts` to fetch the ingested repository paths once up front, pass them into `validateChatRequest(...)`, and reuse that same list for saved-folder restore behavior, which keeps persistence/logging downstream of one accepted validation result.
- Extended `server/src/test/unit/chatValidators.test.ts` with the missing reject case for an existing but non-ingested absolute directory and the matching accept case for an ingested absolute directory, so chat now has direct proof for the exact review regression.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1277`, `passed: 1277`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.

---

### 13. Distinguish Stale Working Folders From Operational Filesystem Failures

- Task Status: `__done__`
- Git Commits: `ef9e8fef, a4adf0b6, cf5c3c99`

#### Overview

Close the review finding in `server/src/workingFolders/state.ts` by preserving the difference between a truly missing/non-ingested working folder and a folder that exists but cannot currently be validated because of an operational filesystem problem. This task is only about working-folder validation and stale-path clearing behavior; it must keep the plan's explicit stale-path clear contract for genuinely invalid values.

#### Subtasks

1. [x] Re-read the review finding in `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, then inspect `server/src/workingFolders/state.ts`, `server/src/routes/conversations.ts`, `server/src/routes/chat.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`. Record in Task 13 `Implementation notes` exactly which error cases should still clear stale saved folders and which error cases must surface as operational failures instead.
2. [x] Refine the working-folder existence/validation helpers so missing/not-ingested paths still map to the current stale-path behavior, but non-not-found filesystem failures are not silently normalized into `WORKING_FOLDER_NOT_FOUND`.
3. [x] Ensure callers that currently clear saved folders on restore only do so for the genuine stale-path contract and preserve actionable diagnostics for operational failures.
4. [x] Add or extend one focused unit test that proves a missing working folder still clears/preserves the current stale-path behavior.
5. [x] Add or extend one focused unit test that proves an unreadable or otherwise operationally failing path does not get silently cleared as stale.
6. [x] Update this story file's Task 13 `Implementation notes` with the final error vocabulary and where those diagnostics now surface.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server/common working-folder validation and stale-path handling. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server/common working-folder behavior covered by node:test suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior that should still satisfy feature-level server coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the review finding plus `server/src/workingFolders/state.ts`, `server/src/routes/conversations.ts`, `server/src/routes/chat.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`; the intended split is now explicit: genuinely stale saved folders still clear on `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND`, while operational filesystem failures must surface without clearing the saved value.
- Refined `server/src/workingFolders/state.ts` so `fs.stat(...)` only maps `ENOENT` and `ENOTDIR` to the existing stale-path behavior; other filesystem failures now become `WORKING_FOLDER_UNAVAILABLE` with the original errno code preserved in `causeCode`.
- Updated `restoreSavedWorkingFolder(...)` so only stale-path errors clear persisted state; operational failures now emit a `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` reject marker with `saved_value_unavailable` and rethrow instead of deleting the saved folder.
- Extended `server/src/test/unit/chat-interface-run-persistence.test.ts` with the direct stale-clear case and a mocked `EACCES` case proving unreadable saved folders now raise `WORKING_FOLDER_UNAVAILABLE` without calling the clear callback.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first rerun surfaced one Task 13-only TypeScript issue in the mocked `fs.stat(...)` test seam, which I fixed by typing the delegated `originalStat(...)` call through `Parameters<typeof fsPromises.stat>[0]`.
- Testing step 2 passed on rerun via `npm run test:summary:server:unit` with `tests run: 1278`, `passed: 1278`, `failed: 0`, and `agent_action: skip_log`; the first full wrapper failure was in the new operational-error test seam, so I replaced the brittle direct `fs.promises.stat` monkey-patch with the explicit `setWorkingFolderStatForTests(...)` hook and reran the full suite.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.

---

### 14. Keep Distinct Case-Sensitive Repository Paths In Candidate Ordering

- Task Status: `__done__`
- Git Commits: `f8f06515, e70da68d, ab2443c7`

#### Overview

Close the review finding in the shared repository-candidate helper by ensuring only genuinely duplicate repository identities are removed. This task is only about the de-duplication key and its coverage; it must not change the four-place precedence order chosen for Story 48.

#### Subtasks

1. [x] Re-read the review finding in `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, then inspect `server/src/flows/repositoryCandidateOrder.ts`, `server/src/flows/service.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/test/unit/repositoryCandidateOrder.test.ts`. Record in Task 14 `Implementation notes` the current over-broad de-duplication rule and the exact contract that should replace it.
2. [x] Update the repository candidate de-duplication key so it removes true duplicates without collapsing two distinct repository roots solely because their resolved paths differ only by letter case on a case-sensitive filesystem.
3. [x] Keep the existing first-position-wins behavior for genuine duplicates, including the working-repo, owner-repo, and `codeInfo2` slots.
4. [x] Add or extend one unit test that proves truly duplicate repository identities are still removed.
5. [x] Add or extend one unit test that proves two distinct case-sensitive repository paths both survive candidate ordering when they are different real paths under the story contract.
6. [x] Update this story file's Task 14 `Implementation notes` with the new de-duplication rule and why it still satisfies the Story 48 duplicate-candidate contract.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes shared server/common resolver behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes shared server/common candidate-order behavior covered by node:test suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes shared resolver behavior that should still satisfy feature-level server coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the review finding plus `server/src/flows/repositoryCandidateOrder.ts`, `server/src/flows/service.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/test/unit/repositoryCandidateOrder.test.ts`; the issue was the helper’s over-broad lowercase dedupe key, while the correct contract is still “first-position wins for truly identical resolved paths.”
- Narrowed `normalizeCandidateKey(...)` in `server/src/flows/repositoryCandidateOrder.ts` to use the resolved absolute path as-is, so distinct case-sensitive repository roots no longer collapse into one candidate on case-sensitive filesystems.
- Kept the existing first-seen dedupe semantics for genuine duplicates, so working-repo, owner-repo, and `codeInfo2` still collapse only when they resolve to the exact same path string.
- Updated `server/src/test/unit/repositoryCandidateOrder.test.ts` so the original duplicate cases now use truly identical paths and added an explicit `/tmp/Repo-One` versus `/tmp/repo-one` regression proving both candidates survive under the Story 48 contract.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1279`, `passed: 1279`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.

---

### 15. Surface Malformed Canonical Client Runtime Config Instead Of Silently Defaulting It Away

- Task Status: `__done__`
- Git Commits: `88398b15, caa7d798, 13bad9a2, 085b5c7d, b5fe17cc`

#### Overview

Close the review finding in the shared client runtime-config helper by making malformed canonical `VITE_CODEINFO_*` values observable instead of silently turning them into a clean-looking success path. This task is only about client runtime-config parsing, diagnostics, and tests; it must keep the renamed env contract and the existing runtime-first precedence model.

#### Subtasks

1. [x] Re-read the review finding in `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, then inspect `client/src/config/runtimeConfig.ts`, `client/src/api/baseUrl.ts`, `client/src/logging/transport.ts`, `client/src/pages/LmStudioPage.tsx`, `client/src/test/baseUrl.env.test.ts`, and `client/src/test/logging/transport.test.ts`. Record in Task 15 `Implementation notes` which malformed canonical inputs are currently normalized away and what observable behavior should replace that silent success.
2. [x] Update the shared runtime-config helper so malformed canonical runtime/env values do not disappear without an explicit diagnostic. Keep the final runtime object shape stable, but make the invalid-canonical path visible through one consistent diagnostic mechanism instead of silently defaulting to a clean success path.
3. [x] Ensure the invalid-canonical handling does not reintroduce legacy env-name compatibility and does not let runtime/default precedence override an explicitly present but malformed canonical value without first recording why.
4. [x] Add or extend one client test that proves malformed canonical log config values are surfaced through the new diagnostic path instead of being silently treated as a normal default.
5. [x] Add or extend one client test that proves malformed canonical URL values are surfaced through the new diagnostic path instead of being silently treated as a normal default.
6. [x] Update this story file's Task 15 `Implementation notes` with the chosen diagnostic mechanism and the exact malformed-input behaviors now covered by tests.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes shared client/runtime-config behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client/common runtime-config behavior covered by the full client suite. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` - Allow up to 7 minutes because this task changes browser/runtime env behavior that should still hold end to end. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end through the Dockerized stack. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including malformed canonical runtime-config scenarios introduced by this task and a debug-console check for any error-level entries.
7. [x] `npm run compose:down`

#### Implementation notes

- Re-read the review finding plus the shared runtime-config, URL, log transport, LM Studio page, and current client tests. Right now malformed canonical booleans/numbers normalize to `undefined`, blank canonical URLs trim to empty strings, and the helper silently falls through to env/default values with no diagnostic; Task 15 will replace that with one shared runtime-config diagnostic trail while keeping the returned config shape stable.
- Added a shared runtime-config diagnostic side channel in `client/src/config/runtimeConfig.ts` so malformed canonical runtime/env values now produce structured diagnostics while the resolved config object shape stays unchanged. The existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker now includes `hasInvalidCanonicalConfig` plus `diagnostics`, which makes malformed overrides visible before env/default fallback wins.
- Kept the clean `VITE_CODEINFO_*` cutover intact by validating only canonical runtime/env inputs and leaving legacy names ignored. Runtime-first precedence still applies for valid values, but malformed runtime/env inputs now record why they were skipped instead of disappearing into a clean-looking fallback.
- Extended `client/src/test/logging/transport.test.ts` to prove malformed canonical log booleans/numbers surface through diagnostics, and extended `client/src/test/baseUrl.env.test.ts` to prove a blank canonical runtime API URL is recorded as malformed before the helper falls back to the valid canonical env URL.
- `npm run build:summary:client` passed cleanly with `warning_count: 0`, so the shared runtime-config helper changes still satisfy the full client typecheck/build path before the broader client and e2e wrappers.
- `npm run test:summary:client` passed cleanly with `tests run: 574`, `passed: 574`, `failed: 0`, which confirms the new diagnostics path does not regress the broader client suite outside the focused malformed-value coverage added for this task.
- `npm run test:summary:e2e` passed cleanly with `tests run: 41`, `passed: 41`, `failed: 0`, so the browser/runtime-config path still holds end to end after the malformed-canonical diagnostic changes.
- `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`, which confirms the Dockerized client/runtime-config stack still builds after the Task 15 helper changes.
- `npm run compose:up` brought the Dockerized stack up cleanly with healthy server and started client containers, which set up the required manual Playwright-MCP proof path at `http://host.docker.internal:5001`.
- Manual Playwright-MCP verification at `http://host.docker.internal:5001` passed for both the normal runtime-config marker and a deliberately malformed canonical runtime injection. The browser console showed `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with `hasInvalidCanonicalConfig: true` plus diagnostics for blank runtime `apiBaseUrl`, invalid runtime `logForwardEnabled`, and invalid runtime `logMaxBytes`, while the effective sources cleanly fell back to env/runtime defaults and the error-level console check stayed empty. Screenshot evidence was captured at `/tmp/playwright-output/task15-home.png`.
- `npm run compose:down` removed the Task 15 validation stack cleanly, so the task closes with the full wrapper/manual sequence completed in order and no lingering containers.

---

### 16. Repair Flow-Loop Stop-Test Cleanup So The Server-Unit Wrapper Can Terminate

- Task Status: `__done__`
- Git Commits: `49c264fd, c8ccc3e2, b4a0e3ad, a3c2d87c, f61063d6`

#### Overview

The original final-validation task assumed `npm run test:summary:server:unit` was already a reliable prerequisite for Story 48 closeout. The blocker research proved that assumption was wrong: the wrapper is behaving as designed, but `server/src/test/integration/flows.run.loop.test.ts` contains stop/cancel tests that can fail before they release runtime state, which keeps the `node --test` process alive and prevents the wrapper from ever reaching a terminal result. This new prerequisite task exists to repair that leaking test seam first so the final full-validation task depends only on a proven, runnable server-unit wrapper.

#### Subtasks

1. [x] Re-read the Task 16 `**BLOCKING ANSWER**` notes below, then inspect `scripts/test-summary-server-unit.mjs`, `scripts/summary-wrapper-protocol.mjs`, `server/src/test/integration/flows.run.loop.test.ts`, and `server/src/test/support/wsClient.ts`. Record in Task 16 `Implementation notes` which stop/cancel test paths can throw before `waitForRuntimeCleanup(...)` and `cleanupMemory(...)` execute.
2. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so the stop-boundary test, plus any other stop/cancel test in the same file that currently relies on reaching a happy-path tail before cleanup, always performs runtime cleanup in `finally` or an equivalent teardown hook. The fix must guarantee `waitForRuntimeCleanup(conversationId)` and `cleanupMemory(conversationId)` run even if `waitForEvent(...)` times out or an assertion fails.
3. [x] If the narrow cleanup fix still leaves the targeted repro hanging, add the smallest possible targeted diagnostic using `process.getActiveResourcesInfo()` or an equivalent local-only test aid so the remaining live handle type is proved before any broader wrapper changes are considered. Remove or constrain that diagnostic so it does not weaken normal test output once the seam is fixed.
4. [x] Re-run the full `npm run test:summary:server:unit` wrapper after the cleanup fix and confirm the wrapper reaches a terminal passed/failed state instead of remaining in heartbeat-only `agent_action: wait`.
5. [x] Update this story file's Task 16 `Implementation notes` with the exact cleanup change, the proof that the wrapper now terminates, and why that makes the final full-validation task honest to run again.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server-side integration-test code and must keep the server workspace buildable. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Mandatory proof for this task because the blocker exists inside the full server-unit wrapper path. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Planning repair: the earlier final-validation task exposed that the full server-unit wrapper was not yet a proven seam. This prerequisite task was inserted so the leaking flow-loop test cleanup is fixed before Story 48 attempts its final all-wrapper rerun again.
- **BLOCKER** Testing step 2 `npm run test:summary:server:unit` cannot honestly be closed until the wrapper reaches a terminal state instead of running indefinitely in `agent_action: wait`.
- **BLOCKING ANSWER** Repository precedents point to a leaking test-cleanup path, not to a broken summary-wrapper protocol. `scripts/test-summary-server-unit.mjs` only calls `emitFinal(...)` after `runLoggedCommand(...)` receives the child-process close event, and `scripts/summary-wrapper-protocol.mjs` is designed to keep printing `agent_action: wait` until that happens. The local failure log `test-results/server-unit-tests-2026-03-17T03-01-03-511Z.log` shows `not ok 238 - flow stop during a looped flow prevents later iterations from continuing` with `Timed out waiting for WebSocket event`, while `server/src/test/integration/flows.run.loop.test.ts` shows that this stop-boundary test waits for the terminal event before it ever reaches `waitForRuntimeCleanup(...)` and `cleanupMemory(...)`. The same file already proves the intended cleanup pattern exists locally: `withFlowServer(...)` always tears down the HTTP server, WS server, temp directory, and env overrides in `finally`, and `waitForRuntimeCleanup(...)` already drains `getInflight(...)` plus `getActiveRunOwnership(...)`. The missing local guarantee is that the stop-path test must still run those cleanup helpers even when the `waitForEvent(...)` assertion path fails early.
- **BLOCKING ANSWER** External library precedents support the same fix direction. Official Node `node:test` docs say `after()` and `afterEach()` cleanup hooks are guaranteed to run even if a test fails, and the same docs explicitly treat asynchronous activity that continues after a test ends as a real failure mode. Official Node process docs expose `process.getActiveResourcesInfo()` as the supported way to identify which live resources are keeping the event loop open. DeepWiki’s `nodejs/node` summary describes the built-in runner as tracking async resources and open handles rather than force-closing them. Practical issue-resolution references line up with that: engineers resolve hanging socket/timer tests by moving teardown into `finally` or teardown hooks, waiting for WebSocket close completion, and using active-resource inspection when a leak remains; by contrast, `--test-force-exit` and longer waits are workarounds that can hide leaks instead of fixing them (`https://nodejs.org/api/test.html`, `https://nodejs.org/api/process.html`, `https://deepwiki.com/search/in-nodes-builtin-test-runner-w_17e2a26a-1b67-47b3-93d0-b4790c18bc51`, `https://stackoverflow.com/questions/55963562/how-to-stop-jest-from-hanging-when-testing-websockets`, `https://stackoverflow.com/questions/71309844/how-to-close-listening-udp-sockets-when-mocha-times-out`, `https://stackoverflow.com/questions/78836115/how-to-force-exit-after-all-tests-are-done-with-node-test-runner`).
- **BLOCKING ANSWER** The chosen fix is therefore to repair `server/src/test/integration/flows.run.loop.test.ts`, not to relax Story 48 closeout or change the wrapper contract. The stop-boundary test, and any other cancel/stop test in the same file that currently relies on reaching the happy-path tail before cleanup, should be rewritten so cleanup is guaranteed in `finally` or an equivalent teardown hook: always await `waitForRuntimeCleanup(conversationId)` and then run `cleanupMemory(conversationId)` even if `waitForEvent(...)` times out or an assertion fails. If a targeted rerun still hangs after that change, the next narrow diagnostic step should be to instrument the targeted repro with `process.getActiveResourcesInfo()` so the remaining live handle type is proved before touching wrapper behavior. This fits the current local repo state because the wrapper protocol is already behaving exactly as designed, the file already has the right cleanup helpers, and the blocker is isolated to a test that can fail before those helpers run. Rejected alternatives: increasing the wrapper budget or simply waiting longer only delays the hang; adding `--test-force-exit` would let Story 48 appear green while still hiding a resource leak; broad wrapper-level hard-kill logic would make the summary wrappers less trustworthy for every story; and weakening final-regression requirements would bypass the story’s explicit closeout contract instead of fixing the concrete leaking-test seam.
- Re-read the blocking-answer notes plus `scripts/test-summary-server-unit.mjs`, `scripts/summary-wrapper-protocol.mjs`, `server/src/test/integration/flows.run.loop.test.ts`, and `server/src/test/support/wsClient.ts`. The risky paths are the stop/cancel tests that await a terminal WebSocket event and only then call cleanup: `aborted flow step is not retried`, `startup-race conversation-only stop still terminalizes a flow as stopped`, `duplicate flow stop requests emit one terminal stopped event`, `flow stop cleanup fallback still releases runtime state`, and especially `flow stop during a looped flow prevents later iterations from continuing`; if `waitForEvent(...)` or a later assertion throws, they can skip `waitForRuntimeCleanup(...)` and `cleanupMemory(...)`.
- Added `cleanupConversationRuntime(...)` in `server/src/test/integration/flows.run.loop.test.ts` and moved the identified stop/cancel tests onto `try/finally` cleanup paths. The stop-boundary test, startup-race stop test, duplicate-stop test, cleanup-fallback stop test, and aborted cancel test now all guarantee `waitForRuntimeCleanup(conversationId)` is attempted and `cleanupMemory(conversationId)` still runs even when the terminal-event wait or a later assertion fails.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`, so the narrow integration-test cleanup fix keeps the server workspace buildable before the task reruns the full server-unit wrapper.
- The fallback active-resource diagnostic was not needed: after the cleanup fix, the full wrapper itself became the proof that the leaking seam was repaired, so Task 16 leaves `process.getActiveResourcesInfo()` instrumentation out of the normal test code.
- `npm run test:summary:server:unit` now reaches a real terminal state again with `tests run: 1279`, `passed: 1279`, `failed: 0`, so the wrapper is once again an honest prerequisite for the final Story 48 closeout task instead of a heartbeat-only hang.
- With the full wrapper terminating cleanly after the cleanup change, the inserted prerequisite is satisfied and the renumbered final validation task can now depend on a proven server-unit wrapper path again.

---

### 17. Re-Run Full Story 48 Validation After Code Review Fixes

- Task Status: `__done__`
- Git Commits: `a00af9d7, 7c68f7f4`

#### Overview

After Tasks 12-16 land, rerun the full Story 48 validation matrix so the reopened story closes again against the original acceptance criteria plus the review-fix findings. This task is intentionally a full revalidation task and must not be skipped or reduced to targeted-only reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, the `Code Review Findings` section above, and the durable review artifacts `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md` plus `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`. Record in Task 17 `Implementation notes` how Tasks 12-16 map back onto the original acceptance criteria.
2. [x] Update `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md` if any review-fix implementation changes, including the new Task 16 cleanup fix, made the existing Story 48 closeout notes stale.
3. [x] Update this story file's Task 17 `Implementation notes` with the final rerun results, review-fix proof points, and any final screenshot or log-marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable review artifacts from this review pass in the commit that closes the reopened story. Do not rely on the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file as the durable record.
5. [x] Remove or leave untracked the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file before the closing commit so future review steps do not accidentally consume stale review state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` - Allow up to 7 minutes because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands only after the full wrapper fails. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder, env-cutover, and log-marker checks plus explicit re-checks for the review-fix scenarios added by Tasks 12-16, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Planning repair: the earlier Task 16 validation attempt proved that final Story 48 closeout depended on a server-unit test seam that had not yet been stabilized. This task is intentionally reset to `__to_do__` so the full validation matrix runs only after the new prerequisite Task 16 is completed and the wrapper path is trustworthy again.
- Acceptance re-read completed against the active plan plus the durable review findings/evidence. Tasks 12-16 map back onto the original acceptance criteria as follows: Task 12 restores the shared ingested-repository working-folder contract on chat; Task 13 keeps stale-path clearing limited to genuinely invalid values while surfacing operational filesystem failures; Task 14 narrows repository de-duplication to true duplicate absolute paths without collapsing distinct case-sensitive roots; Task 15 makes malformed canonical `VITE_CODEINFO_*` runtime config observable in the existing client marker path; Task 16 restores the full server-unit wrapper as a trustworthy final validation gate by guaranteeing flow-loop stop/cancel cleanup.
- Review-state hygiene is already satisfied for the transient handoff path: `codeInfoStatus/reviews/0000048-current-review.json` is absent before closeout work, so no stale review handoff file needs to be removed from the final commit.
- Closeout-doc review completed for `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md`. Tasks 12-16 did not stale the existing Story 48 closeout descriptions, so no documentation edits were needed before the final rerun matrix.
- Durable review artifacts remain the tracked evidence sources for the reopened story closeout: `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md` and `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md` are still present and are intentionally preserved instead of relying on any transient handoff file.
- Final rerun step 1 passed cleanly: `npm run build:summary:server` reported `status: passed` and `warning_count: 0`, so no log inspection was needed.
- Final rerun step 2 passed cleanly: `npm run build:summary:client` reported `status: passed` and `warning_count: 0`, so no log inspection was needed.
- Final rerun step 3 passed cleanly: `npm run test:summary:server:unit` reached a real terminal summary with `tests run: 1279`, `passed: 1279`, and `failed: 0`, confirming the repaired Task 16 wrapper seam holds under the full closeout matrix.
- Final rerun step 4 passed cleanly: `npm run test:summary:server:cucumber` reported `tests run: 71`, `passed: 71`, and `failed: 0`, so no targeted diagnosis or log inspection was needed.
- Final rerun step 5 passed after one honest full-wrapper diagnosis cycle. The first `npm run test:summary:client` failure exposed eight timing-sensitive chat/agent UI tests that only flaked under full-suite load; tightening those specific tests with explicit `waitFor(...)` enablement checks and 10-second local test budgets made the rerun pass cleanly at `tests run: 574`, `passed: 574`, `failed: 0`.
- Final rerun step 6 passed cleanly: `npm run test:summary:e2e` reported `tests run: 44`, `passed: 44`, and `failed: 0`, and the wrapper completed its build/test/teardown phases without needing log inspection.
- Final rerun step 7 passed cleanly: `npm run compose:build:summary` reported `items passed: 2` and `items failed: 0`, so the front-end-accessible regression stack is ready for the final manual pass.
- Final rerun step 8 passed cleanly: `npm run compose:up` brought the Story 48 regression stack up with healthy server and client containers, ready for the final Playwright-MCP verification at `http://host.docker.internal:5001`.
- Final rerun step 9 passed on the live stack. Manual Playwright-MCP at `http://host.docker.internal:5001` confirmed `window.__CODEINFO_CONFIG__` resolved to the canonical runtime values, a clean replay tab showed no error-level console messages, the chat restore seed still repopulated the working-folder picker with `/app` and emitted `DEV_0000048_T6_PICKER_SYNC`, direct command execution emitted `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER`, idle conversation save emitted `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`, route/save and restore paths emitted `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`, startup logs exposed `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, browser startup exposed `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`, and a dry-run OpenAI ingest against `/app` emitted repeated `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT` entries. Screenshots were captured at `test-results/screenshots/0000048-17-home.png` and `test-results/screenshots/0000048-17-chat-restore.png`. Review-fix scenarios from Tasks 12-16 that are not browser-observable on the final canonical-valid stack (non-ingested chat rejection, stale-vs-operational filesystem failure split, case-sensitive repository de-duplication, and the repaired server-unit wrapper seam) were re-proved by the full wrapper matrix above rather than by forcing invalid live-stack state during the clean-console manual pass.
- Final rerun step 10 passed cleanly: `npm run compose:down` removed the regression stack containers and network without errors, leaving the branch ready for the closing Task 17 commit.

---




## Code Review Findings (Second Pass)

Review pass `0000048-review-20260317T050644Z-810fd4f1` re-opened Story 48 after the completed implementation was reviewed again against `main`. The durable review artifacts for this second pass are [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md) and [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md).

### Findings Summary

- `must_fix` `plan_contract_issue`: ingested-repository working-folder validation is silently disabled when repository enumeration fails, so chat, conversations, agents, and flows can fall back to accepting any existing absolute directory instead of the story’s canonical ingested-repository contract.
- `must_fix` `plan_contract_issue`: the Task 15 runtime-config fix still silently defaults away a malformed top-level canonical `window.__CODEINFO_CONFIG__` container, so invalid runtime injection can still look like a clean env/default fallback.
- `should_fix` `generic_engineering_issue`: operational working-folder diagnostics are preserved in `WORKING_FOLDER_UNAVAILABLE` errors but then dropped from the shared log marker and some route-level error responses, leaving callers with `[object Object]` or similarly non-actionable failure output.

### Acceptance Criteria Proof Snapshot

The second review pass re-checked the acceptance criteria against the completed branch and the new findings above. The current proof state is:

1. Shared repository candidate order for command and flow lookup: `direct`
2. One shared repository-candidate builder across flow-command and markdown resolution: `direct`
3. Nested lookup restarts from the full four-place order on every hop: `indirect`
4. Duplicate repositories are removed while preserving first position: `direct`
5. Flow command-file lookup uses the four-place order: `direct`
6. Flow markdown-file lookup uses the four-place order: `direct`
7. Command-item markdown lookup inside flows uses the same order: `direct`
8. Direct command execution keeps working-first then owner-second semantics: `indirect`
9. Local `codeInfo2` flows search the working repository first: `indirect`
10. Ingested-repo-owned flows still search the working repository first: `indirect`
11. Working folder persists/restores across chats, agents, flows, and direct commands: `indirect`
12. Direct command persistence stays on the owning agent conversation: `indirect`
13. Flow conversations and child agent conversations persist the inherited folder: `direct`
14. Chat fully participates in the working-folder contract: `missing`
15. GUI restore and empty-state behavior across existing conversations: `direct`
16. Canonical stored identity is the absolute repository root path: `direct`
17. Editable saved value lives on the owning conversation while each run stores its own snapshot: `direct`
18. Missing working repository skips slot one and logs the condition: `direct`
19. GUI allows idle working-folder edits on existing conversations: `direct`
20. GUI blocks working-folder edits while execution is active: `direct`
21. UI restore and runtime lookup use the same canonical signal: `indirect`
22. Flow-created/used agent conversations inherit the exact flow-step folder: `indirect`
23. Invalid saved working folders clear automatically and log a warning: `missing`
24. Invalid-folder clear happens before reuse and logs stale path plus owning record id/type: `missing`
25. Existing relative-path safety rules remain in place: `indirect`
26. Fallback continues only for not-found outcomes: `direct`
27. Observability logs and docs are updated for candidate order and selected repository: `direct`
28. Structured lookup logs include the minimum required fields: `direct`
29. Execution metadata stores a compact lookup summary without broad API-response expansion: `direct`
30. Documentation includes a nested-reference example: `indirect`
31. Repository-owned env vars are renamed to `CODEINFO_` and browser-facing vars to `VITE_CODEINFO_`: `direct`
32. Env rename updates defaults/examples/compose/e2e/wrappers/docs consistently: `direct`
33. Env rename is a single clean cutover with no temporary dual-read compatibility: `direct`
34. No checked-in repo-owned file still references the old generic env names: `indirect`
35. The env rename inventory covers the checked-in product-owned families: `indirect`
36. The defined env target names were implemented exactly unless another checked-in repo-owned variable also required prefixing: `indirect`
37. OpenAI counting no longer uses the heuristic for guardrails and chunk sizing: `direct`
38. OpenAI counting uses a real tokenizer recommendation and prefers Node `tiktoken`: `direct`
39. OpenAI hard limit is corrected to 8192 while margin remains separate: `direct`
40. Token-margin behavior remains the soft safety mechanism and is documented: `indirect`
41. Oversized OpenAI inputs are classified deterministically as input-too-large: `direct`
42. The OpenAI bug-fix scope stayed limited to tokenizer counting/classification/regression coverage: `indirect`
43. Tokenizer-backed counting replaced the heuristic everywhere it influenced OpenAI ingest decisions: `direct`
44. Guardrails and provider `countTokens(...)` now share the same tokenizer-backed implementation: `direct`
45. OpenAI paths do not fall back to the old heuristic or whitespace estimation on tokenizer failure: `direct`
46. Tokenizer lifecycle handling is explicit and documented: `direct`

### Succinctness Review

The implementation is still broadly within Story 48’s planned scope, but the second review pass found three remaining correctness gaps rather than stylistic simplification work:

- working-folder validation still falls back too permissively when repository enumeration fails;
- malformed top-level canonical runtime config is still silently treated as absent;
- operational working-folder diagnostics are preserved internally but not surfaced clearly enough through the shared log and route layers.

The resolver, persistence, env-cutover, tokenizer, and wrapper-cleanup work otherwise remain appropriately scoped. The follow-up tasks below are intended to close those correctness gaps without broadening the story beyond what this second review pass actually found.

### 18. Repair The Flow-Loop Stop Harness So Full Server-Unit Validation Can Terminate Honestly

- Task Status: `__done__`
- Git Commits: `68ab53fb`

#### Overview

Repair the newly-proved prerequisite seam behind the Task 19 validation blocker. The full `npm run test:summary:server:unit` wrapper cannot currently serve as an honest validation gate for the reopened Story 48 review-fix work because the flow-loop stop integration harness still contains an uninterruptible delayed-response path that can keep runtime cleanup from draining promptly after cancellation.

#### Subtasks

1. [x] Re-read the Task 18 `**BLOCKING ANSWER**` notes below, then inspect `server/src/test/integration/flows.run.loop.test.ts`, `server/src/agents/retry.ts`, and `server/src/test/support/mockLmStudioSdk.ts`. Record in Task 18 `Implementation notes` exactly which `__delay:` and cleanup paths still ignore cancellation long enough to hold the full server-unit wrapper open.
2. [x] Replace the remaining plain delayed-response wait in `server/src/test/integration/flows.run.loop.test.ts` with the repo’s existing abort-aware wait pattern (`delayWithAbort(...)` or an equivalent signal-driven timer cancellation). Keep the stop-loop repro semantics the same, but make the scripted test double react to cancellation promptly instead of sleeping until the timer elapses.
3. [x] Preserve the existing `cleanupConversationRuntime(...)` `finally` path, and extend or adjust the loop-stop integration assertions only as needed to prove the stop-boundary repro still reaches terminal `stopped` behavior while now draining runtime state cleanly.
4. [x] Update Task 18 `Implementation notes` with the final abort-aware helper choice, the exact loop-stop path repaired, and why this prerequisite restores the server-unit wrapper as a trustworthy validation seam for Task 19 and the final closeout task.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this prerequisite changes server-side integration-test harness code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this prerequisite exists specifically to restore a trustworthy full server-unit wrapper result. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Planning repair: the Task 19 fail-closed feature work is real, but the latest blocker research proved its open validation step actually depends on a separate test-harness seam. The full server-unit wrapper is still not a trustworthy gate until the flow-loop stop integration harness stops holding cleanup open after cancellation, so this prerequisite task now owns that seam explicitly instead of leaving it as an implicit blocker on the feature task.
- Re-read the inserted blocker task plus `server/src/test/integration/flows.run.loop.test.ts`, `server/src/agents/retry.ts`, and `server/src/test/support/mockLmStudioSdk.ts`; the remaining hang is the `ScriptedChat.execute()` `__delay:` path still using a plain timer, so cancellation can reach `cleanupConversationRuntime(...)` while the scripted response keeps sleeping until the delay elapses.
- Replaced the last plain `__delay:` timer in `server/src/test/integration/flows.run.loop.test.ts` with `delayWithAbort(...)` from `server/src/agents/retry.ts`, catching `AbortError` to preserve the existing aborted event semantics instead of sleeping until timeout after the flow stop path already cancelled the run.
- Kept `cleanupConversationRuntime(...)` in its existing `finally` path and left the loop-stop assertions themselves unchanged; the harness fix is intentionally narrow so the stop-boundary repro still proves `stopped` behavior while now being able to drain runtime state promptly when cancellation lands mid-delay.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- The first full `npm run test:summary:server:unit` rerun after the harness fix reached a real terminal summary instead of hanging, which proved the wrapper seam was repaired; it exposed one normal assertion failure in `server/src/test/integration/flows.run.working-folder.test.ts`, so I updated that child-flow integration test to seed its ingested repository explicitly under the new fail-closed working-folder contract and then reran the full wrapper.
- Testing step 2 then passed via full `npm run test:summary:server:unit` with `tests run: 1281`, `passed: 1281`, `failed: 0`, and `agent_action: skip_log`, which restores the wrapper as a trustworthy validation gate for Task 19 and the final story closeout.
- **BLOCKING ANSWER** Repository precedents point to another abort/cleanup seam in the flow-loop integration test harness, not to a broken summary-wrapper protocol and not to the fail-closed feature diff itself. `scripts/test-summary-server-unit.mjs` only emits a terminal summary after the wrapped `node --test` child exits, and `scripts/summary-wrapper-protocol.mjs` is designed to keep printing `agent_action: wait` until that close event happens. The latest local failure log `test-results/server-unit-tests-2026-03-17T06-13-59-103Z.log` now narrows the blocker to `not ok 238 - flow stop during a looped flow prevents later iterations from continuing`, failing with `Timed out waiting for flow runtime cleanup` inside `cleanupConversationRuntime(...)`. In `server/src/test/integration/flows.run.loop.test.ts`, that exact repro still depends on a test-double delay path that is not abort-aware: `ScriptedChat.execute()` uses `await delay(...)` for `__delay:...` responses and only checks `signal.aborted` after the timer finishes. Local repo precedent says long waits should respect cancellation instead of forcing cleanup to wait on dead time: `server/src/agents/retry.ts` already provides `delayWithAbort(...)`, `server/src/test/support/mockLmStudioSdk.ts` uses abort listeners to stop scripted test activity early, and `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` proves the repo’s preferred test pattern is `resolve on abort` rather than `sleep until timeout and check later`.
- **BLOCKING ANSWER** External library and framework precedents support the same fix direction. Official Node `node:test` docs treat asynchronous activity that outlives the test as a real failure mode and guarantee `after()` / `afterEach()` cleanup hooks even when earlier assertions fail, while official Node CLI docs describe `--test-force-exit` as a mechanism to force process exit after known tests finish rather than as the preferred leak fix (`https://nodejs.org/api/test.html`, `https://nodejs.org/api/cli.html`). Official Node timers docs also show that promise-based waits should be cancellable with an `AbortSignal`, and official process docs recommend `process.getActiveResourcesInfo()` when you need to prove which live resources are still keeping the event loop open (`https://nodejs.org/download/release/v22.4.1/docs/api/timers.html`, `https://nodejs.org/api/process.html`). DeepWiki’s `nodejs/node` summary matches that guidance: clean exits come from awaited teardown and cleaned-up async resources, while force-exit is a workaround. Issue-resolution references from other engineers also converge on the same practice: hanging websocket/socket/timer tests are fixed by making waits abortable and by closing resources in teardown, not by stretching the suite timeout or masking the leak with forced exit (`https://stackoverflow.com/questions/55963562/how-to-stop-jest-from-hanging-when-testing-websockets`, `https://stackoverflow.com/questions/71309844/how-to-close-listening-udp-sockets-when-mocha-times-out`, `https://stackoverflow.com/questions/78836115/how-to-force-exit-after-all-tests-are-done-with-node-test-runner`).
- **BLOCKING ANSWER** The chosen fix is therefore to repair `server/src/test/integration/flows.run.loop.test.ts` so the loop-stop repro becomes abort-aware before the final cleanup wait, then rerun the full wrapper. Concretely: replace the current plain `await delay(...)` in the `ScriptedChat` `__delay:` path with the repo’s existing abort-aware wait pattern (`delayWithAbort(...)` or an equivalent signal-driven timer cancellation), keep `cleanupConversationRuntime(conversationId)` in `finally`, and only fall back to a narrow `process.getActiveResourcesInfo()` diagnostic if the targeted repro still leaves runtime state behind after that change. This fits the current local repo state because the active failing log now shows the test already reaches the cleanup helper and then waits forever for runtime state to drain, while the remaining uninterruptible delay lives in the test harness rather than in the Story 48 production validation code. Rejected alternatives: increasing the wrapper budget or `just waiting longer` would only hide the stuck cleanup seam; adding `--test-force-exit` would let Story 48 appear green while still leaving a real resource leak in the suite; broad wrapper-level hard-kill logic would make every summary wrapper less trustworthy; and weakening the review-fix or final-validation task contracts would bypass the exact blocker the story is supposed to prove closed.

---

### 19. Fail Closed When Repository Enumeration Cannot Prove Working-Folder Membership

- Task Status: `__done__`
- Git Commits: `5d3d0b0f, 68ab53fb, 4d21ccab`

#### Overview

Close the first second-pass `must_fix` finding by making every Story 48 working-folder entry point fail closed when the product cannot enumerate ingested repositories. The fix must preserve the canonical “must be an ingested repository root” rule instead of silently degrading to “any existing absolute directory.”

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, then inspect `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`, and `server/src/workingFolders/state.ts`. Record in Task 19 `Implementation notes` exactly which paths currently swallow repository-enumeration failure and how that weakens the story contract.
2. [x] Introduce one explicit server-side contract for “repository membership could not be validated because repository enumeration failed.” Do not reuse the existing stale-path vocabulary for this case, and do not silently coerce it into success by passing `undefined` or `[]` into the shared validator.
3. [x] Update the chat, conversation restore/edit, agent run, direct-command run, and flow run paths so they all use that same fail-closed contract when repository enumeration is unavailable. Preserve the happy-path behavior where canonical ingested repositories still validate and restore normally.
4. [x] Ensure saved-folder restore paths do not clear valid persisted data as “stale” merely because repository enumeration is temporarily unavailable. This path should surface an operational failure, not a stale-path clear.
5. [x] Add or extend server tests that prove a repository-enumeration failure does not let a non-ingested absolute directory pass request validation or saved-folder restore validation.
6. [x] Update Task 19 `Implementation notes` with the final error vocabulary, the shared validation seam chosen, and where the fail-closed behavior now surfaces.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes server/common working-folder validation behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server/common request/restore validation logic. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common working-folder behavior that still needs feature-level regression coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Review finding only: repository-list failure is currently swallowed to `undefined` or `[]` in chat, conversations, agents, and flows, which causes `validateKnownRepository(...)` in `server/src/workingFolders/state.ts` to skip the ingested-repository membership check entirely.
- Re-read the second-pass review finding plus `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`, and `server/src/workingFolders/state.ts`; every Story 48 working-folder entry point currently swallows repository-enumeration failure to `undefined` or `[]`, which disables the ingested-repository membership check and weakens the contract back to “any existing absolute directory.”
- Added one explicit fail-closed contract in `server/src/workingFolders/state.ts`: `KnownRepositoryPathsState` now distinguishes `status: 'available'` from `status: 'unavailable'`, and `validateRequestedWorkingFolder(...)` throws `WORKING_FOLDER_REPOSITORY_UNAVAILABLE` instead of silently skipping repository membership validation when enumeration cannot prove the ingested-repository set.
- Updated `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, `server/src/flows/service.ts`, and `server/src/routes/flowsRun.ts` so chat, conversation restore/edit, agent run, direct-command run, and flow run all use that same fail-closed contract and surface it as an operational 503 path rather than degrading to “directory exists on disk.”
- Kept restore-path semantics honest by routing repository-enumeration failure through `WORKING_FOLDER_REPOSITORY_UNAVAILABLE`; saved working folders are no longer cleared as stale when the product simply cannot enumerate ingested repositories at that moment.
- Extended `server/src/test/unit/chatValidators.test.ts` with the direct request-validation proof for repository-enumeration failure and `server/src/test/unit/chat-interface-run-persistence.test.ts` with the restore-path proof that the saved value is not cleared when repository enumeration is unavailable.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Planning repair: the active blocker turned out not to be “more Task 19 feature code” but a missing prerequisite validation seam. Story 48 now inserts Task 18 ahead of this task so the flow-loop stop harness regains an honest full server-unit wrapper result before this feature task is asked to close Testing step 2 or proceed to cucumber.
- Task 18’s prerequisite wrapper rerun also completed this task’s server-unit validation honestly. The first rerun after the harness fix exposed one normal assertion failure in `server/src/test/integration/flows.run.working-folder.test.ts`, so `68ab53fb` updated that child-flow integration test to seed its ingested repository explicitly under the new fail-closed contract and then reran full `npm run test:summary:server:unit`, which passed at `tests run: 1281`, `passed: 1281`, and `failed: 0`.
- Task 19 no longer has a live blocker. What remains here is ordinary completion work: update the final Task 19 implementation-note vocabulary summary and run the still-pending cucumber wrapper.
- Final Task 19 contract summary: `KnownRepositoryPathsState` in `server/src/workingFolders/state.ts` is now the shared validation seam, `WORKING_FOLDER_REPOSITORY_UNAVAILABLE` is the operational fail-closed vocabulary when ingested-repository enumeration cannot prove membership, and that 503 path now surfaces consistently through chat, conversation restore/edit, agent run, direct-command run, and flow run instead of silently widening acceptance to any existing absolute directory.
- Testing step 3 passed via full `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the fail-closed working-folder contract now has both unit and feature-level wrapper proof.

---

### 20. Surface Malformed Top-Level Canonical Runtime Config Containers

- Task Status: `__done__`
- Git Commits: `6f4d7ba6`

#### Overview

Close the second second-pass `must_fix` finding by extending the Task 15 runtime-config fix to cover malformed top-level canonical runtime config containers. Missing runtime config must remain a valid “not provided” case, but malformed canonical runtime config must not be silently normalized into `{}` or treated like a clean env/default fallback.

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, then inspect `client/src/config/runtimeConfig.ts`, `client/src/api/baseUrl.ts`, `client/src/logging/transport.ts`, and the existing runtime-config tests. Record in Task 20 `Implementation notes` which malformed top-level `window.__CODEINFO_CONFIG__` shapes are still silently treated as “missing.”
2. [x] Refine the runtime-config reader so there is a clear distinction between “runtime config absent” and “runtime config present but malformed.” Treat non-object and array-shaped canonical containers as malformed canonical inputs that produce diagnostics and marker evidence instead of silently defaulting away.
3. [x] Preserve the existing fallback behavior for valid env/default sources after a malformed canonical container is detected, but ensure the winning source attribution and `hasInvalidCanonicalConfig` output stay truthful.
4. [x] Add or extend client tests that prove non-object and array-shaped canonical runtime config containers now surface diagnostics instead of being treated as absent.
5. [x] If the malformed-container behavior is observable in the browser bootstrap path, keep the existing Story 48 browser/runtime marker contract aligned so manual and e2e verification can still prove the bad-canonical/good-fallback path.
6. [x] Update Task 20 `Implementation notes` with the chosen malformed-container rule and the exact diagnostics now emitted.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:client` - Use because this task changes client runtime-config/bootstrap behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client/common config behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Use because this task affects browser runtime config and the Story 48 env bootstrap contract. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end and should still prove the browser-accessible runtime-config stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including malformed-canonical-config fallback checks, Story 48 runtime-config marker verification, and a debug-console check confirming there are no logged errors.
7. [x] `npm run compose:down`

#### Implementation notes

- Review finding only: field-level malformed canonical values already surface diagnostics, but a malformed top-level `window.__CODEINFO_CONFIG__` container is still normalized into “missing” before any diagnostic path runs.
- Re-read the second-pass review finding plus `client/src/config/runtimeConfig.ts`, `client/src/api/baseUrl.ts`, `client/src/logging/transport.ts`, `client/src/test/baseUrl.env.test.ts`, `client/src/test/logging/transport.test.ts`, and `e2e/env-runtime-config.spec.ts`; today `readRuntimeConfig()` collapses any falsy, non-object, or array-shaped top-level `window.__CODEINFO_CONFIG__` value to `{}`, so malformed canonical containers are silently treated as “missing” before the existing field-level diagnostic path can run.
- Refined `client/src/config/runtimeConfig.ts` so `readRuntimeConfig()` now returns both the raw config object and top-level diagnostics: `undefined` stays the only “absent” case, while `null`, primitive, and array-shaped `window.__CODEINFO_CONFIG__` values now produce an `invalid_container` diagnostic instead of being normalized away.
- Preserved the existing runtime-first fallback behavior by keeping the resolved config shape unchanged for callers in `client/src/api/baseUrl.ts` and `client/src/logging/transport.ts`; malformed top-level containers now set `hasInvalidCanonicalConfig` truthfully through the existing marker path while valid env/default sources still win when runtime cannot.
- Extended `client/src/test/baseUrl.env.test.ts` and `client/src/test/logging/transport.test.ts` with explicit non-object and array-shaped top-level `window.__CODEINFO_CONFIG__` coverage so malformed canonical containers now surface diagnostics instead of being treated as absent.
- Kept the existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker contract aligned by routing the new top-level container diagnostics through the same `diagnostics` and `hasInvalidCanonicalConfig` payload fields, which preserves browser-visible proof without changing the consumer-facing runtime-config object.
- Testing step 1 passed via `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via `npm run test:summary:client` with `tests run: 577`, `passed: 577`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 3 passed via full `npm run test:summary:e2e` with `tests run: 44`, `passed: 44`, `failed: 0`, and `agent_action: skip_log`, so the runtime-config changes still hold through the browser stack and teardown path.
- Testing step 4 passed via `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`.
- Testing step 5 passed via `npm run compose:up`; the compose stack started cleanly with healthy server and client containers for the manual runtime-config verification.
- Manual Playwright-MCP verification proved both the normal and malformed-container paths on the live stack at `http://host.docker.internal:5001`: the normal bootstrap marker still reported runtime-sourced values, and after temporarily replacing the served `/app/client/dist/config.js` with `window.__CODEINFO_CONFIG__ = [];`, a fresh browser bootstrap reported `hasInvalidCanonicalConfig: true` with `diagnostics: [{ container: '__CODEINFO_CONFIG__', source: 'runtime', rawValue: '[]', reason: 'invalid_container' }]` while env fallback values won truthfully. No error-level browser console messages were present, and screenshots were captured at `test-results/screenshots/0000048-20-home.png` and `test-results/screenshots/0000048-20-malformed-runtime.png`.
- Final Task 20 rule: `window.__CODEINFO_CONFIG__` is now considered absent only when it is `undefined`; `null`, primitive, and array-shaped canonical containers are treated as malformed runtime inputs that emit a top-level `invalid_container` diagnostic while still allowing valid env/default fallback values to resolve the config object truthfully.
- Testing step 7 passed via `npm run compose:down`; the task’s temporary live-stack config mutation was restored before teardown, and the compose stack stopped cleanly.

---

### 21. Preserve Operational Working-Folder Diagnostics Through Shared Logs And Route Errors

- Task Status: `__done__`
- Git Commits: `b5a9e340`

#### Overview

Close the second-pass `should_fix` finding by making operational working-folder failures actionable through the existing log and route surfaces. The fix should preserve the story’s stale-vs-operational split without broadening public payloads or weakening the shared log vocabulary.

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, then inspect `server/src/workingFolders/state.ts`, `server/src/routes/conversations.ts`, and any other changed caller that catches or logs `WORKING_FOLDER_UNAVAILABLE`. Record in Task 21 `Implementation notes` where `reason` and `causeCode` are currently produced and then dropped.
2. [x] Update the shared working-folder logging path so operational failures preserve actionable diagnostics, such as the existing reason and/or errno code, without conflating them with stale-path clears.
3. [x] Replace route-level `` `${err}` `` object stringification in the affected Story 48 paths with an explicit error-to-response/log mapping that keeps client messages safe while preserving actionable server-side diagnostics.
4. [x] Add or extend server tests that prove the operational-failure path now surfaces a meaningful message or log detail instead of `[object Object]`, while stale-path clears continue to use the existing warning contract.
5. [x] Update Task 21 `Implementation notes` with the final diagnostic vocabulary and where it is now observable.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes server/common logging and route error behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server/common error handling and logging behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task still touches server/common behavior that must retain feature-level coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Review finding only: `WORKING_FOLDER_UNAVAILABLE` preserves `causeCode`, but the shared log marker currently drops it and some route catches still stringify the object to `[object Object]`.
- Re-read the second-pass review finding plus `server/src/workingFolders/state.ts`, `server/src/routes/conversations.ts`, `server/src/routes/chat.ts`, `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, and `server/src/routes/flowsRun.ts`; today `toUnavailableWorkingFolderError(...)` already produces `reason` and `causeCode`, but `appendWorkingFolderDecisionLog(...)` drops those details from the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker, conversations list/edit paths do not preserve them consistently through route-level error handling, and the agent/flow REST route error unions still omit `WORKING_FOLDER_UNAVAILABLE`, so true operational failures can lose diagnostics or fall through to a generic 500 path.
- Subtask 2: extended `appendWorkingFolderDecisionLog(...)` and the saved-folder restore operational path in `server/src/workingFolders/state.ts` so `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` now preserves `errorCode`, `errorReason`, and `causeCode` for `WORKING_FOLDER_UNAVAILABLE` without changing stale-clear markers.
- Subtask 3: replaced the remaining affected Story 48 route stringification paths with explicit operational-error mapping in conversations, agents run, agent commands, and flows run, reusing one safe message helper while keeping non-working-folder failures off the old `` `${err}` `` fallback.
- Subtask 4: added focused server coverage for conversations, agents run, agent commands run, and flows run so operational failures now prove a real 503 message/log path while the existing stale-path warning contract stays untouched.
- Subtask 5: the final diagnostic vocabulary stays `WORKING_FOLDER_UNAVAILABLE` plus optional `causeCode`; it is now observable in safe 503 route payloads, in the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker as `errorCode`/`errorReason`/`causeCode`, and in the focused server tests that assert both surfaces directly.
- Testing step 1: `npm run build:summary:server` first exposed a helper typing mismatch in the new safe-message path, so I narrowed `getWorkingFolderErrorMessage(...)` to the only field it actually consumes and reran the full wrapper to a clean `status: passed`, `warning_count: 0`.
- Testing step 2: `npm run test:summary:server:unit` passed cleanly with `tests run: 1285`, `passed: 1285`, `failed: 0`; the full wrapper now covers the new conversation log-marker assertions plus the added agent and flow 503 message mapping checks.
- Testing step 3: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, `failed: 0`, confirming the server feature suite still holds after the operational-diagnostics cleanup.

---

### 22. Re-Run Full Story 48 Validation After Second Review Fixes

- Task Status: `__done__`
- Git Commits: `5c52a17b`

#### Overview

After Tasks 18-21 land, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria, the first review-fix tasks, and the second review-fix tasks. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, the first and second `Code Review Findings` sections above, and the durable review artifacts `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md`, and `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`. Record in Task 22 `Implementation notes` how Tasks 18-21 restore the missing acceptance proof.
2. [x] Update `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md` if the second review-fix implementation changed any Story 48 closeout notes or runtime/diagnostic contracts.
3. [x] Update Task 22 `Implementation notes` with the final rerun results, the second-review-fix proof points, and any final screenshot or marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable second-pass review artifacts in the commit that closes the reopened story. Do not rely on the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file as the durable record.
5. [x] Remove or leave untracked the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file before the closing commit so later review passes cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, env-cutover contract, second-review diagnostic fixes, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the second review pass found two remaining contract gaps plus one diagnostic-surfacing cleanup, and the later blocker research added one explicit validation-seam prerequisite. The story must therefore re-run the full closeout matrix after Tasks 18-21 land instead of treating the prior Task 17 closeout as final.
- Subtask 1: re-read the full acceptance contract plus both review rounds and mapped the second-pass fixes back to missing proof: Task 18 restored the server-unit wrapper as an honest final gate, Task 19 restored fail-closed ingested-repository validation on repo-enumeration failure, Task 20 made malformed top-level `window.__CODEINFO_CONFIG__` containers observable in the existing runtime marker path, and Task 21 preserved actionable `WORKING_FOLDER_UNAVAILABLE` diagnostics in both safe 503 responses and the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker.
- Subtask 2: re-checked `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md` against the second-pass fixes and did not find stale Story 48 closeout notes that required new edits; the existing docs already describe the env/runtime contract and do not need extra wording for the review-fix-only server diagnostic cleanup.
- Subtask 3: the final rerun proof now includes clean wrapper results for build/server/client/e2e, manual screenshots at `/tmp/playwright-output/test-results/screenshots/0000048-22-home.png`, `/tmp/playwright-output/test-results/screenshots/0000048-22-chat-restore.png`, and `/tmp/playwright-output/test-results/screenshots/0000048-22-lmstudio.png`, a live `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` browser marker with runtime URLs, `DEV_0000048_T6_PICKER_SYNC` restore markers for chat and agents showing `/app`, `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` restore markers for saved valid folders, `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` in `/logs`, and live `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT` entries from an OpenAI dry-run ingest against `/app/server/dist/ingest/providers`; the dry run later hit a real Chroma dimension-lock error after tokenizer counting, but that did not invalidate the marker proof and no error-level browser console messages were present.
- Subtask 4: the durable second-pass review artifacts remain in `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md` and `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, and this closing Task 22 commit path preserves them as the canonical reopened-story review record.
- Subtask 5: `codeInfoStatus/reviews/0000048-current-review.json` remained absent during final closeout, so no stale transient review handoff file is being carried into the closing commit.
- Testing step 1: `npm run build:summary:server` passed cleanly with `status: passed`, `warning_count: 0`, keeping the reopened server/common closeout gate green before the broader rerun matrix.
- Testing step 2: `npm run build:summary:client` passed cleanly with `status: passed`, `warning_count: 0`, confirming the second-pass client runtime-config fixes still typecheck and build in the final rerun.
- Testing step 3: `npm run test:summary:server:unit` passed cleanly with `tests run: 1285`, `passed: 1285`, `failed: 0`, confirming the repaired wrapper seam and the reopened server/common regression matrix still terminate honestly and green.
- Testing step 4: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, `failed: 0`, keeping the feature-level server contract green for the final story rerun.
- Testing step 5: `npm run test:summary:client` passed cleanly with `tests run: 577`, `passed: 577`, `failed: 0`, keeping the reopened runtime-config and picker behavior green at full client-suite scope.
- Testing step 6: `npm run test:summary:e2e` passed cleanly with `tests run: 44`, `passed: 44`, `failed: 0`, confirming the reopened full-app flow still holds through compose build, browser tests, and teardown.
- Testing step 7: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`, so the final manual-verification stack is ready for bring-up.
- Testing step 8: `npm run compose:up` completed with healthy server and client containers, so the final manual Playwright verification can run against the canonical Dockerized stack at `http://host.docker.internal:5001`.
- Testing step 9: Manual Playwright-MCP verification at `http://host.docker.internal:5001` confirmed Home and LM Studio render correctly, the chat and agent working-folder pickers restore `/app`, `window.__CODEINFO_CONFIG__` resolves the expected runtime URLs and log settings, `/logs` exposes `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`, `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, and `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT`, and the browser console had no error-level entries.
- Testing step 10: `npm run compose:down` stopped and removed the final manual-verification stack cleanly after the browser and `/logs` checks completed.

---



## Code Review Findings (Third Pass)

Review pass `0000048-review-20260317T093538Z-d8154d87` re-opened Story 48 after the completed branch was reviewed again against `main`. The durable review artifacts for this third pass are [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md) and [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md).

### Findings Summary

- `should_fix` `generic_engineering_issue`: the client runtime-config marker now sets `hasInvalidCanonicalConfig` from all diagnostics, so malformed env fallback values are mislabeled as malformed canonical runtime config.
- `should_fix` `generic_engineering_issue`: working-folder operational and repository-enumeration 503 routes still echo raw internal error text back to clients even though the shared server-side marker already preserves actionable diagnostics safely.
- `should_fix` `generic_engineering_issue`: the branch still carries tracked transient workflow state in `codeInfoStatus/reviews/0000047-current-review.json`, which is stale handoff data rather than a durable review artifact.

### Acceptance Criteria Proof Snapshot

The third review pass re-checked the acceptance criteria against the completed branch and the findings above. The current proof state is:

1. Shared repository candidate order for command and flow lookup: `direct`
2. One shared repository-candidate builder across flow-command and markdown resolution: `direct`
3. Nested lookup restarts from the full four-place order on every hop: `indirect`
4. Duplicate repositories are removed while preserving first position: `direct`
5. Flow command-file lookup uses the four-place order: `direct`
6. Flow markdown-file lookup uses the four-place order: `direct`
7. Command-item markdown lookup inside flows uses the same order: `direct`
8. Direct command execution keeps working-first then owner-second semantics: `indirect`
9. Local `codeInfo2` flows search the working repository first: `indirect`
10. Ingested-repo-owned flows still search the working repository first: `indirect`
11. Working folder persists/restores across chats, agents, flows, and direct commands: `direct`
12. Direct command persistence stays on the owning agent conversation: `indirect`
13. Flow conversations and child agent conversations persist the inherited folder: `direct`
14. Chat fully participates in the working-folder contract: `direct`
15. GUI restore and empty-state behavior across existing conversations: `direct`
16. Canonical stored identity is the absolute repository root path: `direct`
17. Editable saved value lives on the owning conversation while each run stores its own snapshot: `direct`
18. Missing working repository skips slot one and logs the condition: `direct`
19. GUI allows idle working-folder edits on existing conversations: `direct`
20. GUI blocks working-folder edits while execution is active: `direct`
21. UI restore and runtime lookup use the same canonical signal: `indirect`
22. Flow-created/used agent conversations inherit the exact flow-step folder: `indirect`
23. Invalid saved working folders clear automatically and log a warning: `direct`
24. Invalid-folder clear happens before reuse and logs stale path plus owning record id/type: `direct`
25. Existing relative-path safety rules remain in place: `indirect`
26. Fallback continues only for not-found outcomes: `direct`
27. Observability logs and docs are updated for candidate order and selected repository: `direct`
28. Structured lookup logs include the minimum required fields: `direct`
29. Execution metadata stores a compact lookup summary without broad API-response expansion: `direct`
30. Documentation includes a nested-reference example: `indirect`
31. Repository-owned env vars are renamed to `CODEINFO_` and browser-facing vars to `VITE_CODEINFO_`: `direct`
32. Env rename updates defaults/examples/compose/e2e/wrappers/docs consistently: `direct`
33. Env rename is a single clean cutover with no temporary dual-read compatibility: `direct`
34. No checked-in repo-owned file still references the old generic env names: `indirect`
35. The env rename inventory covers the checked-in product-owned families: `indirect`
36. The defined env target names were implemented exactly unless another checked-in repo-owned variable also required prefixing: `indirect`
37. OpenAI counting no longer uses the heuristic for guardrails and chunk sizing: `direct`
38. OpenAI counting uses a real tokenizer recommendation and prefers Node `tiktoken`: `direct`
39. OpenAI hard limit is corrected to 8192 while margin remains separate: `direct`
40. Token-margin behavior remains the soft safety mechanism and is documented: `indirect`
41. Oversized OpenAI inputs are classified deterministically as input-too-large: `direct`
42. The OpenAI bug-fix scope stayed limited to tokenizer counting/classification/regression coverage: `indirect`
43. Tokenizer-backed counting replaced the heuristic everywhere it influenced OpenAI ingest decisions: `direct`
44. Guardrails and provider `countTokens(...)` now share the same tokenizer-backed implementation: `direct`
45. OpenAI paths do not fall back to the old heuristic or whitespace estimation on tokenizer failure: `direct`
46. Tokenizer lifecycle handling is explicit and documented: `direct`

### Succinctness Review

The implementation is still broadly within Story 48’s intended scope, and this third review pass did not find a missing feature contract large enough to reopen earlier behavior tasks. The remaining issues are narrower consistency and artifact-hygiene problems:

- the browser runtime-config marker uses a broader invalidity flag than the canonical-runtime wording implies;
- the working-folder 503 path still couples safe client messaging to raw internal exception text;
- the branch still carries one stale transient review handoff artifact from Story 47.

The resolver, persistence, env-cutover, tokenizer, and prior review-fix work otherwise remain appropriately scoped. The follow-up tasks below are intended to close those correctness and workflow-hygiene gaps without broadening Story 48 beyond what this third review pass actually found.

### 23. Narrow Runtime Marker Canonical-Invalid Reporting To Runtime Diagnostics Only

- Task Status: `__done__`
- Git Commits: `7db145f0, fd238625, cdb4d1bb, 9cb15f5d`

#### Overview

Close the first third-pass `should_fix` finding by making the `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker report canonical-runtime invalidity truthfully. The resolved config object and diagnostics array can stay as they are, but the marker must stop labeling malformed env fallback values as malformed canonical runtime config.

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md`, then inspect `client/src/config/runtimeConfig.ts`, `client/src/test/baseUrl.env.test.ts`, `client/src/test/logging/transport.test.ts`, and `e2e/env-runtime-config.spec.ts`. Record in Task 23 `Implementation notes` exactly which diagnostics are currently counted toward `hasInvalidCanonicalConfig` and why that overstates canonical-runtime failure.
2. [x] Refine the runtime-config marker logic so `hasInvalidCanonicalConfig` is derived only from canonical runtime diagnostics (`source: 'runtime'` and/or the top-level `__CODEINFO_CONFIG__` container diagnostic) instead of all diagnostics indiscriminately.
3. [x] Preserve the existing diagnostics array and resolved config precedence so env fallback values still surface their own invalid diagnostics without being mislabeled as canonical-runtime failures.
4. [x] Add or extend client tests that prove malformed env fallback values no longer set `hasInvalidCanonicalConfig`, while malformed runtime config values still do.
5. [x] If needed, extend browser/e2e proof so the marker contract stays observable in the full runtime bootstrap path.
6. [x] Update Task 23 `Implementation notes` with the final marker rule and the exact proof coverage added.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:client` - Use because this task changes client runtime-config/bootstrap behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client/common runtime-config behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Use because this task changes a browser-visible runtime marker contract. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end and should still prove the runtime bootstrap stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including runtime-marker checks for malformed env fallback versus malformed canonical runtime config and a debug-console check confirming there are no logged errors.
7. [x] `npm run compose:down`

#### Implementation notes

- Third-pass review finding only: `hasInvalidCanonicalConfig` is currently computed from the full diagnostics array, so malformed env fallback values are mislabeled as malformed canonical runtime config even when `window.__CODEINFO_CONFIG__` is absent or valid.
- Re-read the third-pass review finding plus `client/src/config/runtimeConfig.ts`, `client/src/test/baseUrl.env.test.ts`, `client/src/test/logging/transport.test.ts`, and `e2e/env-runtime-config.spec.ts`; the current overstatement is exactly that `hasInvalidCanonicalConfig` is derived from every diagnostic, so malformed env fallback values set the marker even when canonical runtime input is absent or valid.
- Narrowed the marker rule in `client/src/config/runtimeConfig.ts` so `hasInvalidCanonicalConfig` now comes from `hasInvalidCanonicalRuntimeConfig(...)`, which only treats `source: 'runtime'` diagnostics as canonical-runtime failures while leaving the full diagnostics array unchanged.
- Preserved the existing resolved-config precedence and diagnostics array: malformed env fallback values still emit `source: 'env'` diagnostics, but they no longer get mislabeled as canonical runtime failure when valid default or env fallback wins.
- Extended `client/src/test/baseUrl.env.test.ts` and `client/src/test/logging/transport.test.ts` with direct proof that malformed env fallback diagnostics now leave `hasInvalidCanonicalConfig` false while malformed runtime field/container diagnostics still set it true.
- Extended `e2e/env-runtime-config.spec.ts` so the full browser bootstrap path also asserts the normal runtime marker reports `hasInvalidCanonicalConfig: false` when runtime injection is valid.
- Testing step 1 passed via `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via full `npm run test:summary:client` with `tests run: 578`, `passed: 578`, `failed: 0`, and `agent_action: skip_log`; the first full run caught one real expectation bug in the new env-fallback test because jsdom falls back to `window.location.origin`, so I corrected that assertion and reran the full wrapper cleanly.
- Testing step 3 passed via full `npm run test:summary:e2e` with `tests run: 44`, `passed: 44`, `failed: 0`, and `agent_action: skip_log`, so the refined canonical-invalid marker rule still holds through the browser stack and teardown path.
- Testing step 4 passed via `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, so the manual verification stack is ready for bring-up.
- Testing step 5 passed via `npm run compose:up`; the compose stack started cleanly with healthy server and client containers, ready for the live runtime-marker verification at `http://host.docker.internal:5001`.
- Testing step 6 passed via Manual Playwright-MCP at `http://host.docker.internal:5001`: the baseline marker reported `hasInvalidCanonicalConfig: false` with no diagnostics, a temporary live bundle edit changing the baked env fallback API URL to `notaurl` produced an env-only diagnostic while `hasInvalidCanonicalConfig` stayed `false`, a temporary live `config.js` mutation to `window.__CODEINFO_CONFIG__ = [];` produced a runtime `invalid_container` diagnostic with `hasInvalidCanonicalConfig: true`, `browser_console_messages(level=\"error\")` returned no entries, screenshots were captured at `test-results/screenshots/0000048-23-home.png` and `test-results/screenshots/0000048-23-malformed-runtime.png`, and both served files were restored to their original hashes before teardown.
- Testing step 7 passed via `npm run compose:down`; the compose stack shut down cleanly after the manual marker checks, leaving no live-task mutations behind.

---

### 24. Keep Working-Folder 503 Messages Safe While Preserving Server-Side Operational Detail

- Task Status: `__done__`
- Git Commits: `f2046d0b, c0d36500, 67913c93, b0bb7091`

#### Overview

Close the second third-pass `should_fix` finding by separating safe client-facing 503 messaging from the raw operational detail already preserved in the shared working-folder log path. This task should not weaken the actionable server-side diagnostics added in Task 21; it should only stop reflecting arbitrary internal error text straight back to clients.

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md`, then inspect `server/src/workingFolders/state.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, and `server/src/routes/flowsRun.ts`. Record in Task 24 `Implementation notes` exactly which operational failure reasons are currently exposed to clients and which safe replacement message(s) should be used instead.
2. [x] Refine the working-folder error-to-response mapping so route payloads use safe, stable 503 messages for `WORKING_FOLDER_UNAVAILABLE` and `WORKING_FOLDER_REPOSITORY_UNAVAILABLE`, while the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker keeps the raw `errorReason` and `causeCode` detail.
3. [x] Preserve the existing stale-vs-operational split and the existing 400 validation behavior for `WORKING_FOLDER_INVALID` and `WORKING_FOLDER_NOT_FOUND`.
4. [x] Add or extend server tests that prove operational filesystem failures and repository-enumeration failures no longer leak raw internal text through route payloads, while the shared warning/info marker still preserves actionable detail server-side.
5. [x] Update Task 24 `Implementation notes` with the final client-safe vocabulary and the server-side diagnostic surfaces that still preserve the raw detail.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes server/common route error behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server/common working-folder route behavior and log/response mapping. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task still touches server/common behavior that should keep feature-level coverage green. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Third-pass review finding only: the working-folder routes now preserve operational diagnostics better than they did before Task 21, but they still use the raw `reason` string from internal repository-enumeration or filesystem failures as the public 503 payload message.
- Re-read the third-pass review finding plus `server/src/workingFolders/state.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/routes/agentsRun.ts`, `server/src/routes/agentsCommands.ts`, and `server/src/routes/flowsRun.ts`; the current leak is that those routes still turn the internal `reason` into the public 503 `message`, even though the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker already preserves `errorReason` and `causeCode` safely server-side.
- Added `getWorkingFolderClientMessage(...)` in `server/src/workingFolders/state.ts` and switched the affected chat, conversations, agents-run, agent-commands, and flows-run routes to stable client-safe 503 vocabulary instead of reflecting the raw internal reason string.
- Kept the stale-vs-operational split unchanged: `WORKING_FOLDER_INVALID` and `WORKING_FOLDER_NOT_FOUND` still follow the existing 400 validation path, while only `WORKING_FOLDER_UNAVAILABLE` and `WORKING_FOLDER_REPOSITORY_UNAVAILABLE` now map to the safe 503 messages.
- Updated focused route tests in `server/src/test/unit/agents-router-run.test.ts`, `server/src/test/unit/agents-commands-router-run.test.ts`, `server/src/test/unit/conversations-router-agent-filter.test.ts`, and `server/src/test/integration/flows.run.working-folder.test.ts` so operational failures no longer leak raw internal text through route payloads, while the existing conversations marker assertion still proves raw `errorReason` and `causeCode` remain visible server-side.
- Final Task 24 client-safe vocabulary: `WORKING_FOLDER_UNAVAILABLE` now returns `working_folder is temporarily unavailable`, `WORKING_FOLDER_REPOSITORY_UNAVAILABLE` now returns `working_folder repository validation is temporarily unavailable`, and the raw operational detail remains observable only through the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker context.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first build correctly caught that `getWorkingFolderClientMessage(...)` was typed too narrowly for route-local unions, so I widened it to accept the route error-code surface and reran the full wrapper cleanly.
- Testing step 2 passed via full `npm run test:summary:server:unit` with `tests run: 1286`, `passed: 1286`, `failed: 0`, and `agent_action: skip_log`, so the safe 503 message mapping and the preserved marker detail both hold across the full server unit/integration suite.
- Testing step 3 passed via full `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, confirming the feature-level server suite still holds after the safe-message cleanup.

---

### 25. Remove The Stale Story 47 Transient Review Handoff Artifact

- Task Status: `__done__`
- Git Commits: `077aeeb1, cb8a1e39, 66a8ea5f, fb733e8e`

#### Overview

Close the third third-pass `should_fix` finding by removing the tracked transient Story 47 review handoff from this branch. The durable Story 47 review artifacts can stay if they are still intentionally useful, but the old `*-current-review.json` state file should not remain committed because later review tooling is supposed to treat that path as transient workflow state.

#### Subtasks

1. [x] Re-read `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md`, then inspect `codeInfoStatus/reviews/0000047-current-review.json` plus the neighboring durable Story 47 review artifacts. Record in Task 25 `Implementation notes` why the current-review file is transient and which Story 47 artifacts remain intentionally durable.
2. [x] Remove the tracked `codeInfoStatus/reviews/0000047-current-review.json` handoff from the branch, or otherwise convert it into non-tracked workflow state, without disturbing the durable Story 47 evidence/findings artifacts.
3. [x] Update Task 25 `Implementation notes` with the final artifact-hygiene rule and the exact Story 47 files that remain tracked after the cleanup.

#### Testing

Use only the wrapper commands below when testing is required. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

No wrapper build or test steps are required for this task because it only removes stale transient workflow state and does not change executable code, runtime configuration, or documentation behavior.

#### Implementation notes

- Third-pass review finding only: `codeInfoStatus/reviews/0000047-current-review.json` is transient handoff state from a different story and should not stay committed as durable repository history.
- Re-read the third-pass review finding plus `codeInfoStatus/reviews/0000047-current-review.json` and the neighboring Story 47 review files; the current-review file is only transient handoff state pointing at the last Story 47 review pass, while the timestamped `*-evidence.md` and `*-findings.md` files are the intentionally durable record.
- Removed the tracked `codeInfoStatus/reviews/0000047-current-review.json` file from the branch without touching the durable Story 47 evidence/findings artifacts or the separate `0000047-external-review-input.md` context file.
- Final artifact-hygiene rule for this task: Story-specific `*-current-review.json` files are transient workflow state and should not remain tracked after closeout, while the timestamped Story 47 evidence/findings markdown files remain intentionally committed as the durable review history.

---

### 26. Re-Run Full Story 48 Validation After Third Review Fixes

- Task Status: `__done__`
- Git Commits: `1e842835, 2dc6a91e, f13d5458`

#### Overview

After Tasks 23-25 land, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria, the earlier review-fix tasks, and the third-pass review fixes. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, all three `Code Review Findings` sections above, and the durable review artifacts `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md`, and `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md`. Record in Task 26 `Implementation notes` how Tasks 23-25 restore the remaining acceptance and workflow-hygiene proof.
2. [x] Update `README.md`, `design.md`, `projectStructure.md`, and `docs/developer-reference.md` if the third review-fix implementation changes any Story 48 closeout notes, marker contracts, or workflow-artifact guidance.
3. [x] Update Task 26 `Implementation notes` with the final rerun results, the third-review-fix proof points, and any final screenshot or marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable third-pass review artifacts in the commit that closes the reopened story. Do not rely on the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file as the durable record.
5. [x] Remove or leave untracked the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file before the closing commit so later review passes cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, env-cutover contract, third-review marker/message fixes, workflow-artifact hygiene checks, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the third review pass found two remaining low-risk consistency issues in changed runtime/logging code plus one workflow-artifact hygiene issue. Story 48 therefore needs one more narrowly scoped implementation pass and a fresh full rerun task before it can close honestly again.
- Re-read the Story 48 acceptance criteria, all three review-finding sections in this plan, and the durable review bundles for review passes `b791cfd6`, `810fd4f1`, and `d8154d87` before starting the rerun.
- Task 23 restores the third-pass runtime-marker proof by narrowing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` so `hasInvalidCanonicalConfig` now reflects runtime-sourced canonical diagnostics only, while env-fallback diagnostics remain visible without being mislabeled as malformed canonical runtime input.
- Task 24 restores the third-pass working-folder response proof by keeping public 503 payloads stable and safe while preserving actionable `errorCode`, `errorReason`, and `causeCode` detail in the shared `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` marker and server-side logs.
- Task 25 restores workflow-artifact hygiene by removing the tracked stale Story 47 transient handoff file `codeInfoStatus/reviews/0000047-current-review.json` while preserving the durable Story 47 timestamped evidence/findings artifacts and external review input.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed via `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 3 passed via `npm run test:summary:server:unit` with `tests run: 1286`, `passed: 1286`, `failed: 0`, and `agent_action: skip_log`; this wrapper ran past its nominal budget but continued emitting healthy `agent_action: wait` heartbeats until it reached an honest clean terminal summary.
- Testing step 4 passed via `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 5 passed via `npm run test:summary:client` with `tests run: 578`, `passed: 578`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 6 passed via `npm run test:summary:e2e` with `tests run: 44`, `passed: 44`, `failed: 0`, and `agent_action: skip_log`.
- Testing step 7 passed via `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`.
- Testing step 8 passed via `npm run compose:up`; the final validation stack started with healthy server and client containers for the live browser checks.
- Third-pass implementation fixes did not stale `README.md`, `design.md`, `projectStructure.md`, or `docs/developer-reference.md`, so no additional documentation edits were required during this closeout pass.
- Manual Playwright-MCP verification at `http://host.docker.internal:5001` re-confirmed the runtime-config and working-folder contracts without browser errors: startup console output included `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with runtime-sourced canonical values, the logs page exposed `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` with `decisionReason: saved_value_valid` and `workingFolder: /app`, and chat selection emitted `DEV_0000048_T6_PICKER_SYNC` for the current conversation state. `browser_console_messages(level=\"error\")` returned no entries.
- Final screenshot evidence for this third-pass closeout was captured at `/tmp/playwright-output/test-results/screenshots/0000048-26-home.png`, `/tmp/playwright-output/test-results/screenshots/0000048-26-logs.png`, and `/tmp/playwright-output/test-results/screenshots/0000048-26-chat.png`.
- Testing step 9 passed via manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the third-pass marker/message checks and the clean error-level console review.
- Testing step 10 passed via `npm run compose:down`; the final validation stack shut down cleanly after the browser pass.
- Preserved the durable third-pass review artifacts (`0000048-review-20260317T093538Z-d8154d87-evidence.md` and `0000048-review-20260317T093538Z-d8154d87-findings.md`) as the committed record for this review pass instead of relying on transient handoff state.
- Removed the transient handoff file `codeInfoStatus/reviews/0000048-current-review.json` before the closing commit so later review passes cannot consume stale Story 48 review state.

---




## Code Review Findings (Fourth Pass)

Review pass `0000048-review-20260317T110320Z-07647eeb` re-opened Story 48 after the fully completed branch was reviewed again against `main`. The durable review artifacts for this fourth pass are [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md) and [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md).

### Findings Summary

- `must_fix` `plan_contract_issue`: Story 48’s env-cutover acceptance contract still is not fully satisfied because changed checked-in docs/tests continue to reference legacy env names such as `VITE_API_URL`, `VITE_LOG_FORWARD_ENABLED`, `VITE_LOG_MAX_BYTES`, `LMSTUDIO_BASE_URL`, and `OPENAI_EMBEDDING_KEY`.

### Acceptance Criteria Proof Snapshot

The fourth review pass re-checked the acceptance criteria against the completed branch and the new finding above. The current proof state is:

- `direct`: AC1, AC2, AC4, AC5, AC6, AC7, AC11, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC23, AC24, AC26, AC27, AC28, AC29, AC31, AC32, AC37, AC38, AC39, AC40, AC42, AC44, AC45, AC46.
- `indirect`: AC3, AC8, AC9, AC10, AC12, AC21, AC22, AC25, AC30, AC33, AC35, AC36, AC41, AC43.
- `missing`: AC34, because repo search still finds literal legacy env names in changed checked-in docs/tests, which breaks the plan’s explicit “clean cutover / only new names remain” contract.

### Succinctness Review

The implementation remains appropriately succinct for the required behavior in the runtime code. This fourth pass did not uncover a new production-path bug or another large architectural gap; it found one remaining closeout-contract problem in the repo-wide env rename story. The needed follow-up is narrow: remove the remaining legacy env-name references from changed checked-in docs/tests, then rerun the final validation matrix once more so the story closes honestly against its own cutover wording.

### 27. Remove Remaining Legacy Env-Name References From Changed Checked-In Docs And Tests

- Task Status: `__done__`
- Git Commits: `92db1706, fcc9d0dc, 48f69eef`

#### Overview

Close the fourth-pass `must_fix` finding by removing the remaining literal legacy env-name references from the changed checked-in Story 48 docs/tests. This task is specifically about satisfying the plan’s clean-cutover contract without reintroducing old runtime readers or weakening the new `CODEINFO_` / `VITE_CODEINFO_` naming rule.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md), then inspect [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts), [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts), [server/src/test/unit/env-loading.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/env-loading.test.ts), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md). Record in Task 27 `Implementation notes` exactly which remaining literal legacy names are still present and what each file should say instead.
2. [x] Update the changed checked-in docs/tests so they stop using or listing the legacy env names literally while still preserving the intended negative-coverage and migration-guidance meaning. Do not reintroduce runtime dual-read compatibility or weaken the clean-cutover contract.
3. [x] Re-run the repo search for the Story 48 legacy env inventory and record in Task 27 `Implementation notes` which remaining matches are intentionally limited to historical planning documents or other out-of-scope history, and which changed checked-in Story 48 files are now clean.
4. [x] Update Task 27 `Implementation notes` with the final artifact/doc/test cleanup rule and the exact proof that the changed checked-in Story 48 files no longer reference the old names literally.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run test:summary:client` - Use because this task changes checked-in client tests and env-cutover proof. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
2. [x] `npm run test:summary:server:unit` - Use because this task changes checked-in server tests and env-loading proof. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Fourth-pass review finding only: changed checked-in Story 48 docs/tests still contain literal legacy env names, so the plan’s clean-cutover acceptance wording is not honestly closed yet even though runtime code has already moved to `CODEINFO_` / `VITE_CODEINFO_`.
- Subtask 1 inventory: [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts) still literally deletes the old client API env name; [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts) still literally deletes/sets the old client logging names in negative-coverage tests; [server/src/test/unit/env-loading.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/env-loading.test.ts) still literally seeds and enumerates old server env names in its legacy-only assertions; [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) still literally lists removed server names and documentation-only legacy client names. Task 27 should keep the negative/test meaning by constructing those names indirectly in tests and replace the doc wording with generic “pre-cutover generic names” guidance instead of spelling the old names out.
- Subtask 2 cleanup: rewrote the affected client/server tests to construct the pre-cutover names from fragments instead of spelling them literally, then replaced the checked-in doc wording in [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) with generic unsupported-name guidance. Repo search also surfaced the same literal client log-name wording in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) and [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), so those two changed Story 48 docs were cleaned in the same pass to keep the closeout proof honest.
- Subtask 3 repo-search proof: `rg -n '\\b(?:VITE_API_URL|VITE_LOG_FORWARD_ENABLED|VITE_LOG_MAX_BYTES|VITE_LOG_LEVEL|VITE_LOG_STREAM_ENABLED|LMSTUDIO_BASE_URL|OPENAI_EMBEDDING_KEY|CHAT_DEFAULT_PROVIDER|CHAT_DEFAULT_MODEL|INGEST_INCLUDE|INGEST_EXCLUDE|INGEST_FLUSH_EVERY|INGEST_COLLECTION|INGEST_ROOTS_COLLECTION|INGEST_TEST_GIT_PATHS|LOG_FILE_PATH|LOG_LEVEL|LOG_BUFFER_MAX|LOG_MAX_CLIENT_BYTES|LOG_INGEST_WS_THROTTLE_MS|LOG_FILE_ROTATE)\\b' .` now leaves only historical planning/review artifacts plus the active Story 48 plan/review text that documents the migration itself; the changed checked-in Task 27 files are clean.
- Subtask 4 cleanup rule: changed checked-in Story 48 docs/tests should describe unsupported pre-cutover names generically or build them from fragments for negative coverage, but they should not spell the old env names literally. Direct proof before wrapper reruns: the same bounded `rg` command returns no matches in [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts), [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts), [server/src/test/unit/env-loading.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/env-loading.test.ts), [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md), [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), and [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Testing 1: `npm run test:summary:client` passed cleanly with `tests run: 578`, `passed: 578`, `failed: 0`, so the client-side doc/test cleanup did not disturb the existing Story 48 runtime-config and transport proof.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with `tests run: 1286`, `passed: 1286`, `failed: 0`, so the server-side env-loading cleanup still preserves the existing Story 48 startup-env and wrapper proof.

### 28. Re-Run Full Story 48 Validation After Fourth Review Fixes

- Task Status: `__done__`
- Git Commits: `3955ae77, 0eecaf7c, 59588d9c`

#### Overview

After Task 27 lands, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria, all prior review-fix tasks, and the fourth-pass env-cutover cleanup. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, all four `Code Review Findings` sections above, and the durable review artifacts `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md`, `codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md`, `codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md`, and `codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md`. Record in Task 28 `Implementation notes` how Task 27 restores the final env-cutover proof.
2. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) if the fourth review-fix implementation changes any final Story 48 closeout notes or migration guidance.
3. [x] Update Task 28 `Implementation notes` with the final rerun results, the fourth-review-fix proof points, and any final screenshot or marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable fourth-pass review artifacts in the commit that closes the reopened story. Do not rely on the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file as the durable record.
5. [x] Remove or leave untracked the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file before the closing commit so later review passes cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, env-cutover contract, fourth-review cleanup checks, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the fourth review pass found one remaining plan-contract gap in the env cutover story. Story 48 therefore needs one more narrow cleanup task and a fresh full rerun before it can close honestly again.
- Subtask 1 proof mapping: re-read the acceptance criteria, all four review-finding sections, and the four durable evidence/findings bundles for review passes `b791cfd6`, `810fd4f1`, `d8154d87`, and `07647eeb`. Task 27 restores the final env-cutover proof by removing literal old env-name references from the reopened checked-in Story 48 docs/tests and by documenting that the remaining bounded repo-search hits are historical plan/review artifacts rather than active product-owned docs/tests.
- Subtask 2 doc check: no additional documentation update is required for Task 28. Task 27 already cleaned the reopened env-cutover wording in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md), and that cleanup does not stale the broader Story 48 closeout guidance in those files or in [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Testing 1: `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`.
- Testing 2: `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- Testing 3: `npm run test:summary:server:unit` passed with `tests run: 1286`, `passed: 1286`, `failed: 0`; the wrapper stayed in healthy `agent_action: wait` heartbeats until it emitted a clean terminal summary.
- Testing 4: `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, `failed: 0`.
- Testing 5: `npm run test:summary:client` passed with `tests run: 578`, `passed: 578`, `failed: 0`.
- Testing 6: `npm run test:summary:e2e` passed with `tests run: 41`, `passed: 41`, `failed: 0`.
- Testing 7: `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Testing 8: `npm run compose:up` started a healthy Story 48 verification stack with the client and server containers up after their dependency health checks completed.
- Subtask 3 rerun proof: the final live-stack pass kept the fourth-review cleanup honest while re-proving the broader Story 48 contract. Browser startup still emitted `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with canonical runtime values, `/logs` exposed both `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` and `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, and the seeded Task 7 chat conversation restored `/app` with a fresh `DEV_0000048_T6_PICKER_SYNC` restore marker. Screenshot evidence was captured at `test-results/screenshots/0000048-28-logs.png` and `test-results/screenshots/0000048-28-chat.png`, and `browser_console_messages(level=\"error\")` returned no entries. Task 27's fourth-pass cleanup itself remains re-proved by the bounded repo-search and wrapper results above rather than by inventing any legacy-env runtime seam on the clean final stack.
- Subtask 4 durable-artifact preservation: the closing commit keeps the timestamped fourth-pass review evidence/findings files in place and relies on those durable markdown artifacts rather than on any transient `current-review` handoff file.
- Subtask 5 review-handoff hygiene: removed the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff from the working tree so the closing commit can finish without stale transient review state.
- Testing 9: Manual Playwright-MCP verification at `http://host.docker.internal:5001` passed. The live browser console still showed `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`, the logs page contained `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` and `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`, the seeded Task 7 chat restore conversation repopulated the working-folder picker with `/app` and emitted a fresh `DEV_0000048_T6_PICKER_SYNC` restore marker, screenshots were saved as `test-results/screenshots/0000048-28-logs.png` and `test-results/screenshots/0000048-28-chat.png`, and the error-level browser console check stayed empty.
- Testing 10: `npm run compose:down` removed the client, server, Mongo, Chroma, Zipkin, and collector containers and tore down the `codeinfo2_internal` network cleanly, so the final rerun stack left no running verification services behind.

---




## Code Review Findings (Fifth Pass)

Review pass `0000048-review-20260317T121229Z-36689200` re-checked the completed branch against `main` using the durable artifacts [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md) and [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md). That review found one remaining localized correctness gap in the Story 48 runtime-config normalization path, so the story must reopen once more before it can close honestly.

### Findings Summary

- `should_fix` `generic_engineering_issue`: [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts) still treats object-like but non-record `window.__CODEINFO_CONFIG__` values as valid containers, so malformed values such as `new Date()`, `new URL(...)`, `new Map()`, or other exotic objects can still default away without emitting the top-level `invalid_container` diagnostic introduced by Task 20.

### Acceptance Criteria Proof Snapshot

The fifth review pass re-checked the active Story 48 acceptance criteria against the completed branch and the new finding above. The current proof state is:

- `direct`: AC1, AC2, AC4, AC5, AC6, AC7, AC11, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC23, AC24, AC26, AC27, AC28, AC29, AC31, AC32, AC33, AC34, AC35, AC37, AC38, AC39, AC40, AC43, AC44, AC45, AC46.
- `indirect`: AC3, AC8, AC9, AC10, AC12, AC21, AC22, AC25, AC30, AC36, AC41, AC42.
- `missing`: none for the original Story 48 acceptance criteria. The remaining reopen reason is a localized malformed-input normalization defect in the fifth-pass runtime-config review, not a newly missing original acceptance criterion.

### Succinctness Review

The implementation still remains appropriately succinct for the story’s required behavior overall. The lookup-order, working-folder, env-cutover, tokenizer, and review-artifact contracts do not need another broad restructure. The remaining issue is a narrow normalization rule inside one already-changed runtime-config helper, so the follow-up below should stay tightly local to that helper, its direct tests, and the final rerun matrix.

### 29. Reject Object-Like Non-Record Canonical Runtime Config Containers

- Task Status: `__done__`
- Git Commits: `c8182e8e, 9013fcd4, d7baa68a`

#### Overview

Close the fifth-pass `should_fix` finding by treating object-like but non-record `window.__CODEINFO_CONFIG__` values as malformed top-level canonical runtime config containers instead of silently treating them like empty or absent config. This is a localized runtime-config validation cleanup; it should preserve the existing env/default fallback behavior and the existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker contract for valid inputs.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md), then inspect [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts), [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts), [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts), and [e2e/env-runtime-config.spec.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/e2e/env-runtime-config.spec.ts). Record in Task 29 `Implementation notes` exactly which top-level container shapes are currently rejected, which object-like malformed shapes still slip through, and why they are still being normalized into success.
2. [x] Tighten the top-level runtime-config container rule in [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts) so only plain config-record containers are accepted. `undefined` must remain the only “absent” case. `null`, arrays, primitives, class instances, built-in object instances, and other non-record objects must all emit the same top-level `invalid_container` diagnostic instead of silently falling through to field-level missing behavior.
3. [x] Preserve the existing resolved-config precedence and marker vocabulary for valid inputs. Valid runtime values must still beat env/default values, env/default fallback must still work when the runtime container is malformed, and `hasInvalidCanonicalConfig` plus the existing `diagnostics` payload must stay truthful without introducing a second marker schema.
4. [x] Add or extend direct client tests proving that object-like malformed top-level containers are now rejected explicitly. At minimum, cover one built-in exotic object on the API-base-url path and one on the logging-config path so the helper no longer relies only on primitive/array coverage.
5. [x] If the malformed-object container behavior is observable in the browser bootstrap path, keep the full-stack proof aligned by extending or reusing the existing runtime-config browser/e2e verification so the same marker contract still proves the bad-runtime/good-fallback path without adding a second bootstrap seam.
6. [x] Update Task 29 `Implementation notes` with the final plain-object acceptance rule, the exact malformed object shapes now rejected, and where the proof lives.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:client` - Use because this task changes client runtime-config/bootstrap behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client/common runtime-config behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Use because this task changes a browser-visible runtime marker contract. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary` - Use because this task is testable from the front end and should still prove the runtime bootstrap stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including runtime-marker checks for malformed object-like canonical containers versus valid env/default fallback and a debug-console check confirming there are no logged errors.
7. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the fifth review pass found one remaining malformed-input normalization gap in the runtime-config helper. Story 48 therefore needs one more narrow validation cleanup and a fresh full rerun before it can close honestly again.
- Subtask 1 inspection: re-read the fifth-pass finding and the named runtime-config/client/e2e files. `readRuntimeConfig()` currently rejects `undefined` by treating it as absent and rejects `null`, primitives, and arrays with a top-level `invalid_container` diagnostic, but it accepts any other truthy non-array object as a valid container. That means object-like malformed containers such as `new Date()`, `new URL(...)`, `new Map()`, or class instances flow through as `RawRuntimeConfig`, produce only per-field `undefined` reads, and get silently normalized into env/default success instead of surfacing the Task 20 top-level malformed-container diagnostic.
- Subtask 2 plain-object rule: tightened `readRuntimeConfig()` so only plain record containers with `Object.prototype` or `null` prototype are accepted. `undefined` still means absent, while class instances, built-in object instances, arrays, primitives, and `null` now all converge on the same top-level `invalid_container` diagnostic path.
- Subtask 3 precedence preservation: kept the existing field normalizers, fallback order, and `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` payload untouched for valid inputs. The change is isolated to the top-level container gate, so valid runtime values still win, malformed runtime containers still fall back cleanly to env/default, and `hasInvalidCanonicalConfig` remains driven by runtime-sourced diagnostics only.
- Subtask 4 direct test coverage: extended [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts) with a `URL`-instance container case on the API path and [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts) with a `Date`-instance container case on the logging path, so the helper no longer relies only on primitive and array malformed-container coverage.
- Subtask 5 browser-proof alignment: extended [e2e/env-runtime-config.spec.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/e2e/env-runtime-config.spec.ts) by routing `config.js` to a `Date`-instance runtime container and reusing the existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker as the proof surface for bad-runtime/good-fallback behavior.
- Testing 1: `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- Testing 2: `npm run test:summary:client` passed with `tests run: 580`, `passed: 580`, and `failed: 0`.
- Testing 3: the first full `npm run test:summary:e2e` rerun failed honestly on the new malformed-object marker assertion because the browser fell back to the built client env (`http://host.docker.internal:6010`) instead of `window.location.origin`; after correcting that expectation and rerunning the full wrapper, it passed with `tests run: 45`, `passed: 45`, and `failed: 0`.
- Testing 4: `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Testing 5: `npm run compose:up` started a healthy Story 48 verification stack with the client and server containers up after their dependency health checks completed.
- Subtask 6 final rule and proof: the helper now accepts only plain runtime-config records with `Object.prototype` or `null` prototype. The direct proof lives in [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts) for a `URL`-instance API container, [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts) for a `Date`-instance logging container, and [e2e/env-runtime-config.spec.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/e2e/env-runtime-config.spec.ts) for the browser bootstrap path.
- Testing 6: Manual Playwright-MCP verification at `http://host.docker.internal:5001` confirmed both sides of the Task 29 contract. The normal startup marker still reported runtime-sourced values, and after temporarily replacing the served `/app/client/dist/config.js` with `window.__CODEINFO_CONFIG__ = new Date('2026-03-17T00:00:00.000Z');`, the browser console reported `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` with `apiBaseUrlSource: 'env'`, `lmStudioBaseUrlSource: 'env'`, `logForwardEnabledSource: 'env'`, `logMaxBytesSource: 'env'`, `hasInvalidCanonicalConfig: true`, and `diagnostics: [{ container: '__CODEINFO_CONFIG__', source: 'runtime', rawValue: '\"2026-03-17T00:00:00.000Z\"', reason: 'invalid_container' }]`. The served config file was restored immediately after capture, the error-level browser console check returned no entries, and screenshot evidence was saved as `test-results/screenshots/0000048-29-malformed-runtime.png`.
- Testing 7: `npm run compose:down` removed the client, server, Mongo, Chroma, Zipkin, and collector containers and tore down the `codeinfo2_internal` network cleanly.

---

### 30. Re-Run Full Story 48 Validation After Fifth Review Fixes

- Task Status: `__done__`
- Git Commits: `83e447cb, 28518b2b, 04eabeab, d7d167f2`

#### Overview

After Task 29 lands, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria, all prior review-fix tasks, and the fifth-pass runtime-config cleanup. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, all five `Code Review Findings` sections above, and the durable review artifacts [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md), and [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md). Record in Task 30 `Implementation notes` how Task 29 restores the remaining runtime-config proof.
2. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) if the fifth review-fix implementation changes any final Story 48 closeout notes or runtime-config guidance.
3. [x] Update Task 30 `Implementation notes` with the final rerun results, the fifth-review-fix proof points, and any final screenshot or marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable fifth-pass review artifacts in the commit that closes the reopened story. Do not rely on the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file as the durable record.
5. [x] Remove or leave untracked the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file before the closing commit so later review passes cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, env-cutover contract, fifth-review runtime-config cleanup checks, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the fifth review pass found one remaining localized malformed-input normalization gap in the runtime-config helper. Story 48 therefore needs one more narrow cleanup task and a fresh full rerun before it can close honestly again.
- Subtask 1 proof mapping: re-read the Story 48 acceptance criteria, all five review-finding sections, and the five durable evidence/findings bundles for review passes `b791cfd6`, `810fd4f1`, `d8154d87`, `07647eeb`, and `36689200`. Task 29 restores the remaining runtime-config proof by tightening the top-level `window.__CODEINFO_CONFIG__` acceptance rule to plain record containers only, adding direct exotic-object coverage in the client suites, and proving through the existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker that a malformed object-like runtime container now falls back truthfully to env/default values while surfacing `invalid_container`.
- Subtask 2 doc check: no additional documentation update is required for Task 30. Task 29 changed runtime-config validation and proof only; it did not stale the existing Story 48 closeout guidance in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), or [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md).
- Testing 1: `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`.
- Testing 2: `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- Testing 3: `npm run test:summary:server:unit` passed with `tests run: 1286`, `passed: 1286`, and `failed: 0`; the wrapper stayed in healthy `agent_action: wait` heartbeats until it emitted a clean terminal summary.
- Testing 4: `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, and `failed: 0`.
- Testing 5: `npm run test:summary:client` passed with `tests run: 580`, `passed: 580`, and `failed: 0`.
- Testing 6: `npm run test:summary:e2e` passed with `tests run: 45`, `passed: 45`, and `failed: 0`.
- Testing 7: `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Testing 8: `npm run compose:up` started the final verification stack cleanly; the `mongo`, `server`, and `client` containers all reached their healthy/started state before manual browser validation began.
- Subtask 3 final proof summary: the post-fix live rerun re-proved the runtime-config contract through the existing `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG` marker, re-proved working-folder restore through `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` plus `DEV_0000048_T6_PICKER_SYNC`, and captured final screenshots at `/tmp/playwright-output/0000048-30-logs.png`, `/tmp/playwright-output/0000048-30-chat.png`, and `/tmp/playwright-output/0000048-30-malformed-runtime.png`.
- Subtask 4 durable artifact check: the timestamped fifth-pass review files `codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md` and `codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md` remain tracked as the durable record used for this closing pass.
- Subtask 5 transient artifact hygiene: removed `codeInfoStatus/reviews/0000048-current-review.json` from the working tree before the closing commit so later review passes cannot consume stale transient handoff state.
- Testing 9: Manual Playwright-MCP verification passed at `http://host.docker.internal:5001`; startup emitted `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`, the logs page exposed `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` and `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` with `workingFolder: /app`, the seeded Task 7 chat restore repopulated `/app` and emitted `DEV_0000048_T6_PICKER_SYNC`, a temporary live `config.js` mutation to `window.__CODEINFO_CONFIG__ = new Date('2026-03-17T00:00:00.000Z');` produced the expected runtime `invalid_container` diagnostic with `hasInvalidCanonicalConfig: true` and env-backed fallback sources, `browser_console_messages(level="error")` returned no entries, and the served file was restored before teardown.
- Testing 10: `npm run compose:down` removed the client, server, Mongo, Chroma, Zipkin, collector, and the `codeinfo2_internal` network cleanly after the final manual verification pass.

---




## Code Review Findings (Sixth Pass)

### Review Artifacts

- Evidence: [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-evidence.md)
- Findings: [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md)

### Findings Summary

1. `must_fix` `generic_engineering_issue`: the conversation working-folder edit route in [server/src/routes/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/conversations.ts) still normalizes missing or whitespace-only `workingFolder` input into a successful clear, so invalid or omitted input can erase saved state instead of being rejected.
2. `should_fix` `generic_engineering_issue`: [server/src/flows/repositoryCandidateOrder.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/repositoryCandidateOrder.ts) still lets `buildRepositoryCandidateLookupSummary(...)` report `fallbackUsed: false` when the selected repository is not present in the ordered candidates, which hides an impossible state behind a misleading success-shaped summary.

### Acceptance Criteria Proof Snapshot

- Direct proof in the sixth-pass evidence artifact: `AC01`, `AC02`, `AC04`, `AC05`, `AC06`, `AC07`, `AC11`, `AC12`, `AC13`, `AC14`, `AC15`, `AC16`, `AC17`, `AC18`, `AC19`, `AC20`, `AC23`, `AC24`, `AC26`, `AC27`, `AC28`, `AC29`, `AC31`, `AC32`, `AC33`, `AC34`, `AC35`, `AC37`, `AC38`, `AC39`, `AC40`, `AC43`, `AC44`, `AC45`, `AC46`.
- Indirect proof in the sixth-pass evidence artifact: `AC03`, `AC08`, `AC09`, `AC10`, `AC21`, `AC22`, `AC25`, `AC30`, `AC36`, `AC41`, `AC42`.
- Missing proof in the sixth-pass evidence artifact: none at the acceptance-criterion level, but the review did identify one missing direct route-contract proof for omitted/blank `workingFolder` edit payloads and one missing direct invariant proof for contradictory `selectedRepositoryPath` lookup-summary inputs.

### Succinctness Review

The implementation still remains appropriately succinct for the story’s required behavior overall. The sixth-pass findings are both narrow follow-ups in already-changed seams rather than evidence that Story 48 needs another broad restructure. The route contract in [server/src/routes/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/conversations.ts) and the invariant handling in [server/src/flows/repositoryCandidateOrder.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/repositoryCandidateOrder.ts) should be tightened locally, then the story should be rerun through one fresh full validation pass.

### 31. Require Explicit Clear Semantics On Conversation Working-Folder Edits

- Task Status: `__done__`
- Git Commits: `08cfe44c, 980600f1`

#### Overview

Close the sixth-pass `must_fix` finding by making the conversation working-folder edit route require an explicit caller choice. A non-empty string must continue to mean “save this folder”, explicit `null` must continue to mean “clear the saved folder”, and omitted or whitespace-only `workingFolder` input must stop being normalized into a successful clear.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md), then inspect [server/src/routes/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/conversations.ts), [client/src/api/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/conversations.ts), and the existing conversation working-folder tests. Record in Task 31 `Implementation notes` exactly how omitted, blank, explicit `null`, and non-empty string payloads are handled today, and why the current omitted/blank path is incorrectly normalized into success.
2. [x] Tighten the edit-route request contract in [server/src/routes/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/conversations.ts) so the route only accepts two explicit states: a non-empty string to save, or `null` to clear. Do not let an omitted `workingFolder` field, an empty string, or a whitespace-only string clear the saved value silently.
3. [x] Preserve the existing safe-message and operational-error behavior for true validation failures and temporary repository-membership failures. This task is only about explicit clear semantics and invalid-input rejection; it must not reopen the safe 503-message work from Task 24.
4. [x] Add or extend server route tests that prove all four input cases explicitly: omitted field rejects, blank/whitespace field rejects, explicit `null` clears, and a non-empty string saves. The purpose of these tests is to stop the route from ever again normalizing missing input into success.
5. [x] If any client-side API helper or page-level caller assumptions need to be clarified while keeping the public contract explicit, update those tests too, but do not broaden the change into a new client workflow. The intended outcome is that the existing helper continues to send only explicit save or clear payloads, and route-level rejection catches malformed callers.
6. [x] Update Task 31 `Implementation notes` with the final explicit-clear contract, the exact rejected payload shapes, and where the proof lives.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes a server REST contract. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server route validation and persistence behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior and the full server regression suite should still pass. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Review reopening only: the sixth review pass found that the conversation working-folder edit route still lets omitted or blank input clear saved state. Story 48 therefore needs one more localized route-contract fix before it can close honestly again.
- Re-read the sixth-pass finding and inspected the route/helper/tests. Today the server parses omitted, empty, and whitespace-only `workingFolder` values into `undefined`, then persists `validatedWorkingFolder ?? null`, so those malformed payloads silently clear state; the client helper currently makes that worse by trimming `undefined` or blank strings into `{ workingFolder: null }`. Explicit `null` already clears correctly, and non-empty strings already follow the normal save/validation path.
- Tightened the conversation edit route so `workingFolder` is now required in the request body, `z.string().trim().min(1).nullable()` rejects omitted/blank/whitespace-only values before persistence, and only explicit `null` reaches the clear path while non-empty strings still flow through the existing repository-membership validation.
- Kept the Task 24 safety behavior intact: the only change is malformed-input rejection before validation, while the existing 400 invalid-path handling and the safe 503 operational-error mapping still use the same route logic and client-safe messages for true validation or repository availability failures.
- Added direct server route proof in `server/src/test/unit/conversations-router-agent-filter.test.ts` for the four required cases: omitted payload rejects, blank payload rejects, whitespace-only payload rejects, explicit `null` clears, and non-empty strings still save.
- Clarified the client helper contract in `client/src/api/conversations.ts` and `client/src/test/conversationsApi.workingFolder.test.ts` so page-level callers still send only explicit save-or-clear payloads, while malformed helper inputs (`undefined` or blank strings) now reject locally instead of being normalized into a clear request.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the tightened explicit-clear route and helper contract still typecheck/build cleanly on the server side.
- Testing step 2 passed on rerun via full `npm run test:summary:server:unit` with `tests run: 1289`, `passed: 1289`, `failed: 0`, and `agent_action: skip_log`; the first full run failed honestly only because the new omitted/blank route tests asserted Zod’s exact wording too narrowly, so I widened those assertions to stable validation-error patterns and reran the full wrapper cleanly.
- Final explicit-clear contract: `POST /conversations/:id/working-folder` now accepts only `{ "workingFolder": "<non-empty trimmed string>" }` to save or `{ "workingFolder": null }` to clear. The route now rejects `{}`, `{ "workingFolder": "" }`, and `{ "workingFolder": "   " }` as 400 validation errors before persistence, while direct proof lives in `server/src/test/unit/conversations-router-agent-filter.test.ts` and the helper-side malformed-caller proof lives in `client/src/test/conversationsApi.workingFolder.test.ts`.
- Testing step 3 passed via full `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the broader server regression suite still holds after tightening the explicit save-vs-clear route contract.

---

### 32. Fail Closed When Lookup-Summary Inputs Contradict The Candidate Order

- Task Status: `__done__`
- Git Commits: `f6b162bf, 84893f8a`

#### Overview

Close the sixth-pass `should_fix` finding by making the shared lookup-summary helper fail closed when a caller asks it to summarize a repository path that is not actually present in the ordered candidate list. This is a localized consistency fix in the shared helper and its direct proofs; it must keep the existing success-path summary shape unchanged for valid inputs.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md), then inspect [server/src/flows/repositoryCandidateOrder.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/repositoryCandidateOrder.ts), [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [server/src/flows/markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), and [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts). Record in Task 32 `Implementation notes` exactly how the helper behaves today when the selected repository path is missing from the ordered candidates and which changed callers depend on the happy-path summary.
2. [x] Tighten [server/src/flows/repositoryCandidateOrder.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/repositoryCandidateOrder.ts) so a contradictory `selectedRepositoryPath` cannot be summarized as a false “first-choice” success. The helper should either throw or otherwise make the invariant break explicit, but it must not keep returning `fallbackUsed: false` for a path that was never in the candidate order.
3. [x] Keep the existing persisted and logged summary contract unchanged for valid inputs: `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`. This task is only about fail-closed invariant handling and direct proof for the contradictory-input path.
4. [x] Add or extend one direct unit test in [server/src/test/unit/repositoryCandidateOrder.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/repositoryCandidateOrder.test.ts) that proves a contradictory `selectedRepositoryPath` does not silently produce a success-shaped summary. The purpose of this test is to close the missing-proof gap identified in the sixth-pass review.
5. [x] Reconfirm that the changed happy-path callers in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [server/src/flows/markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), and [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) still behave identically for valid selections. The intended outcome is a narrower fail-closed helper, not a new summary schema or caller-specific workaround.
6. [x] Update Task 32 `Implementation notes` with the final invariant rule, the contradictory-input behavior you chose, and where the direct proof lives.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes a shared server helper used by flows, markdown resolution, and direct commands. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes shared server lookup-summary behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes shared server/common behavior and the full server regression suite should still pass. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Review reopening only: the sixth review pass found one remaining lookup-summary invariant gap in the shared repository-order helper. Story 48 therefore needs one more narrow helper fix and direct proof before it can close honestly again.
- Re-read the sixth-pass finding and inspected the helper plus its changed callers. Today `buildRepositoryCandidateLookupSummary(...)` resolves the selected path, lets `findIndex(...)` return `-1` for a path missing from the ordered candidates, and still returns a success-shaped summary with `fallbackUsed: false`; the changed happy-path callers in `server/src/flows/service.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/agents/service.ts` all assume the helper only summarizes a candidate that actually came from the ordered list.
- Tightened `buildRepositoryCandidateLookupSummary(...)` in `server/src/flows/repositoryCandidateOrder.ts` to throw when the selected repository path is not present in the ordered candidates, so contradictory input now fails closed instead of being mislabeled as a first-choice success.
- Kept the valid-input summary contract unchanged. For real selected candidates, the helper still returns only `selectedRepositoryPath`, `fallbackUsed`, and `workingRepositoryAvailable`, so existing persisted turn/runtime data and log payloads do not change shape.
- Added direct invariant proof in `server/src/test/unit/repositoryCandidateOrder.test.ts` that a contradictory `selectedRepositoryPath` now throws instead of producing a success-shaped summary.
- Reconfirmed by inspection that the changed happy-path callers in `server/src/flows/service.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/agents/service.ts` all build lookup summaries from a candidate they selected from the ordered list itself, so valid behavior remains unchanged and no caller-specific workaround was needed.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the fail-closed helper change still builds cleanly across the shared server paths that consume the lookup summary.
- Testing step 2 passed via full `npm run test:summary:server:unit` with `tests run: 1290`, `passed: 1290`, `failed: 0`, and `agent_action: skip_log`, so the new contradictory-input unit proof and the unchanged happy-path callers both hold across the full server unit/integration suite.
- Final invariant rule: `buildRepositoryCandidateLookupSummary(...)` may only summarize a repository path that is actually present in the ordered candidate list. Contradictory input now throws `selectedRepositoryPath ... is not present in the ordered candidate list`, while the direct proof lives in `server/src/test/unit/repositoryCandidateOrder.test.ts` and the valid-path callers remain unchanged because they only summarize candidates selected from the ordered list itself.
- Testing step 3 passed via full `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the broader server regression suite still holds after tightening the shared lookup-summary invariant.

---

### 33. Re-Run Full Story 48 Validation After Sixth Review Fixes

- Task Status: `__done__`
- Git Commits: `25eb3e59, ddf42a0c, 89340a57`

#### Overview

After Tasks 31 and 32 land, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria, all prior review-fix tasks, and the sixth-pass route-contract and lookup-summary consistency fixes. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [x] Re-read the Story 48 acceptance criteria, all six `Code Review Findings` sections above, and the durable review artifacts [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T011804Z-b791cfd6-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T050644Z-810fd4f1-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T093538Z-d8154d87-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T110320Z-07647eeb-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-evidence.md), [codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T121229Z-36689200-findings.md), [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-evidence.md), and [codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T131305Z-35932fbe-findings.md). Record in Task 33 `Implementation notes` how Tasks 31 and 32 restore the remaining route-contract and lookup-summary proof.
2. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) if the sixth review-fix implementation changes any final Story 48 closeout notes or route/runtime-config guidance.
3. [x] Update Task 33 `Implementation notes` with the final rerun results, the sixth-review-fix proof points, and any final screenshot or marker evidence captured during this post-review validation pass.
4. [x] Preserve the durable sixth-pass review artifacts in the commit that closes the reopened story. Do not rely on the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file as the durable record.
5. [x] Remove or leave untracked the transient [codeInfoStatus/reviews/0000048-current-review.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-current-review.json) handoff file before the closing commit so later review passes cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory final regression check because the story’s client/common behavior must remain green after the sixth-pass server fixes. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory final regression check because the story’s client/common behavior must remain green after the sixth-pass fixes. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, explicit-clear edit-route checks, lookup-summary regression checks, env-cutover contract, and a debug-console check confirming there are no logged errors.
10. [x] `npm run compose:down`

#### Implementation notes

- Review reopening only: the sixth review pass found one remaining explicit-clear route-contract bug and one remaining lookup-summary invariant gap. Story 48 therefore needs one more narrow server-side cleanup wave and a fresh full rerun before it can close honestly again.
- Re-read the Story 48 acceptance criteria, all six review-finding sections, and the durable review artifacts from all six review passes. Tasks 31 and 32 close the last sixth-pass proof gaps directly: Task 31 now requires explicit `null` to clear conversation working folders and proves omitted/blank payload rejection at the route and helper layers, while Task 32 now makes contradictory lookup-summary inputs throw instead of emitting a false success-shaped summary and adds the direct unit proof the sixth-pass findings called out.
- Re-checked the Story 48 closeout docs against the sixth-pass fixes and did not find any stale guidance in `README.md`, `design.md`, `projectStructure.md`, or `docs/developer-reference.md`. The fixes were route-contract and helper-invariant tightenings, so no additional checked-in doc edits are needed for Task 33 unless the final rerun surfaces a mismatch.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, keeping the reopened server/common regression gate green before the broader rerun matrix.
- Testing step 2 passed on rerun via `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first run correctly caught one lingering `AgentsPage` ref type that still allowed optional `workingFolder`, so I aligned it to Task 31’s explicit save-or-clear contract before rerunning the full wrapper cleanly.
- Testing step 3 passed via full `npm run test:summary:server:unit` with `tests run: 1290`, `passed: 1290`, `failed: 0`, and `agent_action: skip_log`; this wrapper again took the expected long healthy path with `agent_action: wait` heartbeats before reaching a clean terminal summary.
- Testing step 4 passed via full `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the reopened feature-level server regression suite still holds after the sixth-pass fixes.
- Testing step 5 passed via full `npm run test:summary:client` with `tests run: 582`, `passed: 582`, `failed: 0`, and `agent_action: skip_log`, so the client/common Story 48 regression suite remains green after the final sixth-pass server-side fixes and the small `AgentsPage` typing follow-up.
- Testing step 6 passed via full `npm run test:summary:e2e` with `tests run: 42`, `passed: 42`, `failed: 0`, and `agent_action: skip_log`; the wrapper spent several minutes in healthy `agent_action: wait` heartbeats during compose build and browser execution before reaching a clean teardown summary.
- Testing step 7 passed via `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, so the final front-end-accessible regression stack is ready for bring-up.
- Testing step 8 passed via `npm run compose:up`; the final validation stack started successfully with healthy server and client containers for the live browser checks at `http://host.docker.internal:5001`.
- Testing step 9 passed via manual Playwright-MCP verification at `http://host.docker.internal:5001`: the home page emitted `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`, the `/logs` page exposed `DEV_0000048_T7_CODEINFO_ENV_RESOLVED` plus `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` rows for explicit clear and restore/save decisions, live route probes against the seeded Task 7 conversation proved omitted and whitespace-only `workingFolder` payloads now reject with `400 validation_error` while explicit `null` clears and `\"/app\"` restores successfully, chat and flows restore still repopulated `/app` while emitting `DEV_0000048_T6_PICKER_SYNC`, the contradictory lookup-summary invariant remains covered by the direct Task 32 unit proof plus the full wrapper matrix rather than a dedicated browser seam, a fresh browser session ended with no error-level console messages, and screenshots were saved as `test-results/screenshots/0000048-33-home.png`, `test-results/screenshots/0000048-33-logs.png`, and `test-results/screenshots/0000048-33-chat.png`.
- Testing step 10 passed via `npm run compose:down`; the final validation stack shut down cleanly after the live browser checks and route-contract probes completed.
- Final rerun results stayed green across the full Story 48 matrix: `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, manual Playwright-MCP, and `npm run compose:down` all completed successfully during this sixth-pass closeout.
- The sixth-review-fix proof now closes cleanly at both seams: Task 31’s explicit save-or-clear route contract was re-verified live against the seeded conversation plus the full server wrappers, and Task 32’s contradictory lookup-summary invariant remains fail-closed through its direct unit test while the broader server wrappers stayed green.
- Preserved the durable sixth-pass review artifacts as the story record and did not rely on the transient `codeInfoStatus/reviews/0000048-current-review.json` handoff file for closeout evidence.
- Left `codeInfoStatus/reviews/0000048-current-review.json` untracked before the closing commit so later passes cannot consume stale transient review state.

---



## Historical Post-Implementation Code Review

This section records the previously completed no-findings closeout that existed before the later user-requested follow-up env-prefix expansion reopened Story 48. It is retained as historical review evidence only and should not be treated as the current story-complete state while Tasks 34-35 remain open.

### Review Pass

- Review pass id: `0000048-review-20260317T145700Z-84ca2ecd`
- Evidence artifact: [codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-evidence.md)
- Findings artifact: [codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-findings.md)
- Historical outcome at that point in time: no findings were recorded in that final review pass, so the story was considered complete before the later env-prefix follow-up request reopened the plan.

### Branch-Vs-Main Checks Performed

- Verified `codeInfoStatus/flow-state/current-plan.json` still pointed to `planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md` at the time of that review.
- Verified the selected plan file existed and that the branch story number `48` still matched the plan filename story number `0000048`.
- Re-read the active plan from disk after the final closeout commits landed.
- Reviewed `git diff --name-status main...HEAD` and grouped the changed files into planned implementation files, planned docs/tests/plan files, approved workflow artifacts, approved workflow configuration, and suspicious/out-of-scope files.
- Re-checked recent branch commits through the final Task 33 closeout wave and its audit-ledger follow-up commits.
- Confirmed the branch diff still fit Story 48 implementation plus approved workflow artifacts, with no suspicious or out-of-scope files identified.

### Acceptance-Evidence Checks

- Direct proof: `AC01`, `AC02`, `AC04`, `AC05`, `AC06`, `AC07`, `AC11`, `AC12`, `AC13`, `AC14`, `AC15`, `AC16`, `AC17`, `AC18`, `AC19`, `AC20`, `AC23`, `AC24`, `AC26`, `AC27`, `AC28`, `AC29`, `AC31`, `AC32`, `AC33`, `AC34`, `AC35`, `AC37`, `AC38`, `AC39`, `AC40`, `AC43`, `AC44`, `AC45`, `AC46`.
- Indirect proof: `AC03`, `AC08`, `AC09`, `AC10`, `AC21`, `AC22`, `AC25`, `AC30`, `AC36`, `AC41`, `AC42`.
- Missing proof: none.
- Final rerun evidence at that point remained green in Task 33: `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, manual Playwright-MCP verification, and `npm run compose:down` all passed.
- Final live/manual proof at that point remained present for the sixth-pass fixes: omitted and whitespace-only conversation edit payloads rejected, explicit `null` cleared, `/app` restore still worked, the expected Story 48 markers appeared in logs/browser output, and no error-level browser-console messages were observed.

### Files And Seams Inspected In Review

- Plan and review artifacts:
  - [planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md)
  - [codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-evidence.md)
  - [codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000048-review-20260317T145700Z-84ca2ecd-findings.md)
- Highest-risk implementation seams:
  - [server/src/workingFolders/state.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/workingFolders/state.ts)
  - [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts)
  - [server/src/flows/repositoryCandidateOrder.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/repositoryCandidateOrder.ts)
  - [server/src/routes/conversations.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/conversations.ts)
- Direct proof and contract tests:
  - [server/src/test/unit/repositoryCandidateOrder.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/repositoryCandidateOrder.test.ts)
  - [client/src/test/conversationsApi.workingFolder.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/conversationsApi.workingFolder.test.ts)
  - [client/src/test/baseUrl.env.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/baseUrl.env.test.ts)
  - [client/src/test/logging/transport.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/logging/transport.test.ts)

### Succinctness Review

The implemented code was judged appropriately succinct for the behavior Story 48 required at that review point. The densest files remained [server/src/workingFolders/state.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/workingFolders/state.ts), [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts), and [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), but that final findings pass did not identify a concrete simplification that was localized, objectively testable, and worth reopening the story for. The remaining complexity was largely a consequence of the story combining reference-resolution, persistence, env-cutover, and tokenizer contracts in one coordinated branch.

### Historical Completion Decision

The review pass above found no `must_fix`, `should_fix`, or `optional_simplification` issue that justified reopening Story 48 at that time. That historical closeout remains useful review evidence, but the story is now being reopened for the separate user-requested env-prefix follow-up below.



## Additional Requested Follow-Up

The user has now requested one extra env-prefix completion pass for a narrow set of remaining repo-owned server/runtime variables that Story 48 intentionally left unprefixed. This follow-up is not a new review finding; it is a requested scope extension on the same branch after the earlier closeout.

### 34. Rename Remaining Repo-Owned Server Runtime Variables To `CODEINFO_`

- Task Status: `__to_do__`
- Git Commits: `__none__`

#### Overview

Perform one focused env-prefix cutover for the remaining repo-owned server/runtime variables the user explicitly selected: `SERVER_PORT`, `MONGO_URI`, `CHROMA_URL`, `MCP_PORT`, `AGENTS_MCP_PORT`, `HOST_INGEST_DIR`, and `OPENAI_INGEST_MAX_RETRIES`. This task should rename only those variables to canonical `CODEINFO_` forms across checked-in product code, committed env files, compose/test-compose wiring, docs, and tests, without broadening into the existing `Codex_*` variable family.

#### Subtasks

1. [ ] Re-read this story’s env-cutover scope, then inspect every checked-in use of `SERVER_PORT`, `MONGO_URI`, `CHROMA_URL`, `MCP_PORT`, `AGENTS_MCP_PORT`, `HOST_INGEST_DIR`, and `OPENAI_INGEST_MAX_RETRIES`. Record in Task 34 `Implementation notes` the exact canonical replacement names you will use and every checked-in file family that currently consumes them.
2. [ ] Update the server-side config readers and helpers so the canonical names become `CODEINFO_SERVER_PORT`, `CODEINFO_MONGO_URI`, `CODEINFO_CHROMA_URL`, `CODEINFO_MCP_PORT`, `CODEINFO_AGENTS_MCP_PORT`, `CODEINFO_HOST_INGEST_DIR`, and `CODEINFO_OPENAI_INGEST_MAX_RETRIES`. Keep this as a clean cutover with no temporary dual-read compatibility for the old names.
3. [ ] Update committed env files, compose/test-compose files, wrappers, docs, and checked-in tests so those seven variables use the new `CODEINFO_` names consistently everywhere they are set, passed through, or documented.
4. [ ] Pay special attention to `CODEINFO_HOST_INGEST_DIR`, `CODEINFO_MCP_PORT`, and `CODEINFO_AGENTS_MCP_PORT`: verify that path mapping, volume mounts, and port wiring remain aligned between local/server code and Compose wiring after the rename.
5. [ ] Add or update tests that prove the renamed variables still drive the same runtime behavior for server startup, Mongo/Chroma wiring, ingest path mapping, MCP port config, and OpenAI ingest retry parsing.
6. [ ] Finish with one repo-wide search proving no checked-in repo-owned file still uses the old names for those seven variables.
7. [ ] Update Task 34 `Implementation notes` with the final canonical-name map, the highest-risk wiring seam you had to preserve, and where the direct proof for the rename now lives.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [ ] `npm run build:summary:server` - Use because this task changes server runtime/config wiring. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server/common env resolution and runtime behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because this task changes server/common runtime behavior that should keep feature coverage green. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Use because this task changes compose/runtime wiring that is exercised through the full app. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
5. [ ] `npm run compose:build:summary` - Use because this task changes Dockerized runtime wiring. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
6. [ ] `npm run compose:up`
7. [ ] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including startup/stack sanity for the renamed server runtime envs, at least one path that depends on mounted-ingest or working-folder behavior, and a debug-console check confirming there are no logged errors.
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending.

---

### 35. Re-Run Full Story 48 Validation After Requested Env-Prefix Follow-Up

- Task Status: `__to_do__`
- Git Commits: `__none__`

#### Overview

After Task 34 lands, rerun the full Story 48 validation matrix again so the story closes against the original acceptance criteria plus the requested follow-up env-prefix expansion. This task is intentionally a fresh full revalidation task and must not be reduced to targeted reruns.

#### Subtasks

1. [ ] Re-read the full Story 48 acceptance criteria, all six `Code Review Findings` sections above, the historical post-implementation review record, and Task 34. Record in Task 35 `Implementation notes` how the requested env-prefix follow-up extends the final env-cutover proof without reopening unrelated Story 48 seams.
2. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) if the Task 34 rename changes any final Story 48 closeout notes or runtime/env guidance.
3. [ ] Update Task 35 `Implementation notes` with the final rerun results, the requested follow-up proof points, and any final screenshot or marker evidence captured during this post-follow-up validation pass.
4. [ ] Preserve any durable review or evidence artifacts created during this requested follow-up in the closing commit. Do not rely on transient workflow handoff files as the durable record.
5. [ ] Remove or leave untracked any transient workflow handoff file created during this follow-up before the closing commit so later runs cannot consume stale state.

#### Testing

Use only the wrapper commands below. Do not attempt to run builds or tests without the wrapper.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. This preserves tokens while keeping full diagnostics available.

1. [ ] `npm run build:summary:server` - Mandatory final regression check because the reopened story still changes server/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Mandatory final regression check because the reopened story still changes server/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Mandatory final regression check because the reopened story still changes client/common behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Mandatory final regression check because the reopened story still changes full-app behavior. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - Use for the final front-end-accessible regression stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP verification at `http://host.docker.internal:5001`, including the Story 48 working-folder contract, the expanded server env-prefix contract, general regression checks, and a debug-console check confirming there are no logged errors.
10. [ ] `npm run compose:down`

#### Implementation notes

- Pending.
