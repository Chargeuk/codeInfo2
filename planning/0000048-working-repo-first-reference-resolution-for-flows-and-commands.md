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

Finally, the current working repository must be defined by one stable runtime signal so the server, websocket events, and REST-triggered execution all behave the same way. The chosen canonical identity for this story is the absolute repository root path because that is what the GUI already selects and displays to the user. If the product cannot identify a current working repository for a particular request, lookup should skip the first slot and proceed deterministically with owner -> `codeInfo2` -> others, and observability should explicitly log that no working repository was available for that lookup. The user has also chosen that the selected current folder must no longer be ephemeral UI state. Agent conversations, chat conversations, flow runs, and command runs should all persist the selected current folder and restore it when the user switches between conversations in the GUI. The editable canonical value should live on the owning conversation or thread record for each chat, agent, flow, or command context, while each individual run stores the exact working-folder snapshot that it actually used at run start. Existing conversations must also remain editable from the GUI: if the user changes the selected folder path for an existing chat, agent conversation, command run context, or flow run context, that new value should become the saved current working repository for future restores and future reference resolution. However, this editability only applies when the relevant chat, agent conversation, flow run, or command run is not currently in progress. While execution is active, the working folder must be locked against edits so runtime behavior cannot change underneath an in-flight operation. If a flow creates or uses a child agent conversation, that child conversation should inherit and save the folder path actually used by the flow step so that switching into that agent conversation later shows the same path the flow used. If a saved working-folder path later becomes invalid because it no longer exists or is no longer ingested, the product should clear it automatically and log a warning rather than preserving stale state. Without that persistence, editability, inheritance, invalid-path recovery behavior, and explicit missing-working-repo handling, the new working-repo-first lookup rule would be hard to reason about and would appear to drift unexpectedly between runs.

The user-visible restore behavior should also be treated as explicit scope for this story. When the user switches to an existing chat, agent conversation, flow run context, or command run context, the same current-folder picker already shown in the GUI should immediately show the saved absolute repository path if that path is still valid. If there is no saved path, or if the saved path has been cleared because it is invalid, the picker should show its normal empty or no-folder-selected state rather than a placeholder, stale label, or silently substituted repository. In that empty state the runtime should behave exactly like the missing-working-repository contract described above.

This story also includes a repository-wide environment-variable normalization pass because current env names are colliding with variables in user repositories. The desired end state is that repository-owned environment variables should use an uppercase `CODEINFO_` namespace, with browser-exposed Vite variables using uppercase `VITE_CODEINFO_` names. This includes updating committed `.env` files, `.env.local` examples and guidance, e2e configuration, docker-compose files, wrappers, and documentation so the product stops depending on generic names that can clash with unrelated repositories. The env rename should ship as one clean cutover once documentation, compose files, wrappers, tests, and committed defaults are updated. The goal is consistent naming and safer overrides, not cosmetic renaming for its own sake.

For this story, the env cutover target names should be treated as explicit scope rather than something left for implementation-time interpretation. The currently checked-in product-owned server names should move to the following `CODEINFO_` forms at minimum: `LMSTUDIO_BASE_URL -> CODEINFO_LMSTUDIO_BASE_URL`, `OPENAI_EMBEDDING_KEY -> CODEINFO_OPENAI_EMBEDDING_KEY`, `CHAT_DEFAULT_PROVIDER -> CODEINFO_CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL -> CODEINFO_CHAT_DEFAULT_MODEL`, `INGEST_INCLUDE -> CODEINFO_INGEST_INCLUDE`, `INGEST_EXCLUDE -> CODEINFO_INGEST_EXCLUDE`, `INGEST_TOKEN_MARGIN -> CODEINFO_INGEST_TOKEN_MARGIN`, `INGEST_FALLBACK_TOKENS -> CODEINFO_INGEST_FALLBACK_TOKENS`, `INGEST_FLUSH_EVERY -> CODEINFO_INGEST_FLUSH_EVERY`, `INGEST_COLLECTION -> CODEINFO_INGEST_COLLECTION`, `INGEST_ROOTS_COLLECTION -> CODEINFO_INGEST_ROOTS_COLLECTION`, `LOG_FILE_PATH -> CODEINFO_LOG_FILE_PATH`, `LOG_LEVEL -> CODEINFO_LOG_LEVEL`, `LOG_BUFFER_MAX -> CODEINFO_LOG_BUFFER_MAX`, `LOG_MAX_CLIENT_BYTES -> CODEINFO_LOG_MAX_CLIENT_BYTES`, and `LOG_INGEST_WS_THROTTLE_MS -> CODEINFO_LOG_INGEST_WS_THROTTLE_MS`. Browser-facing names should move to `VITE_CODEINFO_` forms at minimum: `VITE_API_URL -> VITE_CODEINFO_API_URL`, `VITE_LMSTUDIO_URL -> VITE_CODEINFO_LMSTUDIO_URL`, `VITE_LOG_LEVEL -> VITE_CODEINFO_LOG_LEVEL`, `VITE_LOG_FORWARD_ENABLED -> VITE_CODEINFO_LOG_FORWARD_ENABLED`, `VITE_LOG_MAX_BYTES -> VITE_CODEINFO_LOG_MAX_BYTES`, and `VITE_LOG_STREAM_ENABLED -> VITE_CODEINFO_LOG_STREAM_ENABLED`. If checked-in test helpers still depend on repo-owned env names such as `INGEST_TEST_GIT_PATHS`, they should follow the same prefix rule in the same cutover rather than being left behind as a hidden legacy exception.

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
- Direct agent command runs persist their editable saved working folder on the existing owning agent conversation record; this story does not introduce a separate command-conversation type or command-only storage record.
- Top-level flow runs persist their editable saved working folder on the existing flow conversation record, and any child agent conversation created or resumed by that flow persists the inherited folder on that child agent conversation record.
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
  - working-repository-available boolean;
  - ordered candidate paths when useful.
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
  - `    referenceType: 'flow-command' | 'flow-markdown' | 'command-markdown' | 'direct-command';`
  - `    referencingFile?: string;`
  - `    ownerRepositoryPath?: string;`
  - `    workingRepositoryPath?: string;`
  - `    workingRepositoryAvailable: boolean;`
  - `    candidateRepositories?: Array<{`
  - `      path: string;`
  - `      rank: 'working' | 'owner' | 'codeinfo2' | 'other';`
  - `    }>;`
  - `    selectedRepositoryPath: string;`
  - `    fallbackUsed: boolean;`
  - `  };`
  - `}`
- `runtime.workingFolder` stores the exact resolved folder snapshot used for that persisted turn or step.
- `runtime.lookupSummary` stores the compact lookup contract the story already requires for runs and steps.
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
