# Story 0000051 – GitHub Copilot SDK Chat Provider

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

The product already supports two chat providers:

- LM Studio for local downloaded chat models;
- Codex for OpenAI Codex CLI-backed chat with MCP tool support and Codex-specific runtime defaults.

Users now want a third provider based on the TypeScript GitHub Copilot SDK. The purpose of this story is to let the existing chat page and chat API talk to GitHub Copilot as an additional selectable provider, while keeping the current agent, command, and flow execution paths unchanged for now.

Repository research showed that chat provider support today is only partly generic. There is already a provider factory and provider-specific chat-interface abstraction, but the surrounding contracts still assume exactly two providers in several places:

- chat defaults are typed as `'codex' | 'lmstudio'`;
- runtime fallback logic alternates between only those two providers;
- request validation only accepts those two provider strings;
- provider ordering and UI defaults are biased around Codex and LM Studio only;
- Codex-specific flags and defaults flow through routes and UI as a special case.

That means this story is not just about adding one more SDK dependency. It is about extending the current chat provider architecture from a two-provider model into a three-provider model without broadening scope into agent execution, flow execution, or general provider-pluggability across the entire platform.

This story should also be implemented on top of the completed Story `0000047 – Codex Chat Config Defaults Bootstrap And Context7 Overlay` changes. Story `0000047` is already tightening Codex model-list, default-model, and config-bootstrap behavior in shared chat code paths. Once it is complete, this story should treat those Codex behaviors as the new baseline and extend them to a three-provider world, rather than reworking provider defaults against the older two-provider assumptions.

Important clarification for scope: Story `0000047` gives Codex a provider-specific default-model source through `codex/chat/config.toml`, but this Copilot story does not introduce an equivalent new provider-specific config file or persisted default-model source for Copilot or LM Studio. In this story, three-provider support means the shared chat provider/default selection path can understand `copilot`, and the page can bootstrap and fall back across three providers. It does not mean every provider gains a new config-backed model-default mechanism matching Codex.

The GitHub Copilot SDK is also an important architectural fit check. Research showed that it is not a raw stateless model API. It is a session-based SDK that controls the GitHub Copilot CLI over JSON-RPC. That makes it conceptually closer to the existing Codex integration than to the LM Studio integration:

- it creates and resumes named sessions;
- it streams structured session events rather than only plain text;
- it can list models and expose reasoning metadata;
- it can surface tool execution events;
- it supports MCP servers, hooks, and user-input requests;
- it requires a permission handler when creating or resuming a session.

For this story, the user only wants chat support. That is an explicit scope boundary. Agent runs and flow runs currently hardcode Codex-oriented provider assumptions and should be handled in a later story once the chat-only integration has proven out.

This story therefore introduces a new chat provider named `copilot` with the following product goal:

- the chat page can display GitHub Copilot as another provider choice;
- the server can detect whether Copilot is available and authenticated enough to be usable;
- the chat page can load Copilot models and reasoning metadata;
- chat requests can execute through the Copilot SDK and stream back into the existing chat transcript and persistence model;
- existing LM Studio and Codex behaviour keeps working;
- agent and flow execution do not change in this story.

Provider and model selection semantics should stay aligned with the current chat page behavior in this story. If the user changes provider or model, that change applies to the next send by starting a new conversation rather than mutating an existing persisted Copilot-backed conversation in place. This story should not use Copilot SDK model-switch capabilities to silently rewrite the runtime context behind an already-visible chat transcript.

Research also identified two important scope controls for this first Copilot story.

First, the Copilot SDK itself has its own nested concept of a `provider` for BYOK backends such as OpenAI-compatible APIs, Azure, Anthropic, or local servers. That is separate from this product's top-level chat-provider selection. This story is about adding GitHub Copilot as a top-level chat provider in this product, not about exposing the SDK's own BYOK provider-routing features to end users.

Second, the Copilot SDK can expose a broader agentic surface than the current chat page necessarily needs, including permission prompts and built-in tool categories such as shell, write, read, url, and MCP. For this story, the user wants that broader Copilot tool surface allowed by default rather than denied by default, matching the current permissive Codex default posture in this repository. A later story may expose Copilot permission controls in the chat interface in the same spirit as the current Codex controls, but this story should not add those extra controls yet.

The user also wants Copilot home-directory handling to mirror the existing Codex home contract as closely as possible. Today the repository already uses `CODEINFO_CODEX_HOME` to point at a repo-local or container-local Codex home, with `server/.env` using a relative development value and Docker Compose overriding that to an in-container path. Research indicates that the Copilot SDK and Copilot CLI can support a parallel arrangement:

- a product-level environment variable `CODEINFO_COPILOT_HOME` should be introduced;
- development configuration should point it at a repo-local `../copilot` path in `server/.env`;
- container execution should override it to `/app/copilot` in the same way Codex uses `/app/codex`;
- server startup and Copilot session creation should resolve that value and pass it through to the Copilot runtime using `COPILOT_HOME` and the SDK `configDir` so the behaviour is deterministic.

This is intentionally about config and state location, not about changing the project working directory. The Copilot home should be treated like a runtime home, while Copilot's working directory for chat should still point at the actual codebase location the model is meant to operate on.

Authentication also needs to be described carefully for this story. The existing product already has a Codex authentication popup dialog and a backend route that shells out to `codex login --device-auth`, parses the returned verification URL and user code, and displays that output in the UI. Follow-up Copilot SDK and Copilot CLI research now shows a documented GitHub OAuth device-flow path for Copilot as well, using `copilot login` and the interactive `/login` command. The documented flow gives the user a one-time code and the GitHub device-login URL so the user can complete authentication in a normal browser.

That makes a Copilot auth flow possible even when this product is running inside Docker images that cannot launch a browser themselves. The container only needs to start the Copilot login command and surface the verification URL and code in the UI. The user can then open the GitHub device-login page in their own browser outside the container, enter the code, and finish authentication there.

For this story, the chosen auth direction is therefore the closest practical analogue to the existing Codex flow:

- add a Copilot auth action in the shared authentication modal alongside the current Codex action;
- back that action with a Copilot-specific backend route that runs the documented Copilot device-login flow and returns the verification details needed by the user as soon as they are available, rather than waiting for the entire external browser flow to finish;
- keep the implementation explicitly GitHub Copilot auth, not BYOK token/provider routing;
- persist Copilot auth/config state under `CODEINFO_COPILOT_HOME` so successful authentication survives container restarts and can be reused by later chat requests;
- treat plaintext config persistence under that mounted Copilot home as an acceptable first implementation when the container environment does not provide a usable keychain.

This story still does not need a brand new custom GitHub OAuth application or a general-purpose token-management UI. However, it does now include a minimal in-app Copilot device-auth experience and the shared `Choose Authentication` modal changes because those are both documented-compatible and compatible with the containerized runtime constraint.

The auth UX should use a two-phase device-flow contract. The modal should surface the verification URL and code immediately once they are parsed, while completion is tracked separately so the product can refresh Copilot readiness after the user finishes the browser step. Where practical, this should be implemented as an upstream improvement to the shared auth behavior rather than a Copilot-only exception, because the existing Codex backend already has a similar early-return plus background-completion shape.

The chosen modal direction for this story is:

- title: `Choose Authentication`;
- two primary auth actions stacked vertically in the middle of the dialog body, with `Codex Auth` first and `Copilot Auth` second;
- `Close` remains in the bottom-right dialog actions area;
- any provider-specific loading state, verification output, or error state appears below the auth buttons rather than replacing the overall dialog structure.

### Acceptance Criteria

- The chat provider model in the server supports a third provider id named `copilot` without breaking existing `codex` and `lmstudio` behavior.
- The shared chat-default and runtime-provider-selection path no longer assumes exactly two providers.
- The chat provider selection flow can choose or fall back across three providers in a deterministic way.
- One explicit ordered provider list must drive provider-list ordering, default-provider fallback, and client bootstrap selection everywhere this story touches provider selection. In this story that ordered list is `codex`, then `copilot`, then `lmstudio`, unless a valid request or persisted conversation already pins a specific provider.
- `GET /chat/providers` returns provider entries in that ordered list and keeps Copilot visible with `available: false` plus a stable `reason` when Copilot is unavailable or unauthenticated.
- The implementation removes the current binary alternate-provider assumptions rather than adding a second special case for Copilot.
- This story does not add a new provider-specific default-model configuration source for Copilot or LM Studio analogous to Codex `codex/chat/config.toml`.
- If Copilot participates in default-provider or default-model bootstrap for chat, it does so through the existing shared chat-default path rather than through a new Copilot-specific config file, user preference store, or dedicated UI.
- Copilot readiness reporting keeps `available`, `toolsAvailable`, and warnings distinct, and evaluates blocking readiness in a deterministic order so the surfaced provider `reason` is stable across provider listing, model loading, auth refresh, and chat execution.
- Copilot readiness accepts every documented Copilot CLI credential source that is already present in the runtime. In this story that means `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, stored Copilot CLI login state, and authenticated `gh` fallback all count as valid existing authentication and must not force the user through the in-app device flow.
- `GET /chat/models?provider=copilot` returns Copilot model entries mapped into the existing chat-model response shape.
- Copilot model entries preserve useful reasoning metadata when the SDK exposes it.
- The implementation verifies the actual Copilot SDK `ModelInfo` shape before finalizing the mapping contract and only maps fields that are confirmed by the installed SDK/docs rather than assuming richer metadata than the runtime actually returns.
- Copilot usage and timing metadata are only populated for fields that are actually exposed and verified from the installed SDK runtime or docs. Unavailable Copilot usage or timing fields remain unset rather than being synthesized into misleading placeholder zeros.
- The chat-bubble formatter omits token or timing sub-values when they are `undefined` or `null`, so partial Copilot metadata does not degrade the transcript UI.
- Existing Codex and LM Studio transcript metadata rendering remains unchanged in this story except for the narrow formatter hardening needed to suppress missing-value placeholders. The story must not regress or relabel what those providers already show.
- `POST /chat` accepts `provider: "copilot"` and can execute a chat turn through the Copilot SDK.
- Copilot chat responses stream back into the existing chat event bridge so the current chat page can render live output without needing a brand new transport.
- Copilot chat turns persist into conversations and turns using provider value `copilot`.
- A successful Copilot chat turn creates or updates a conversation record with `provider: 'copilot'`, persists the selected model, and reuses `conversationId` directly as the Copilot `sessionId` unless direct inspection of the installed SDK proves a separate stored session id is required.
- The Copilot chat path reuses the existing conversation identity so a conversation can continue coherently across multiple Copilot turns.
- Existing shared contracts that currently hard-code `codex` and `lmstudio` only, including server defaults, request validation, Mongo conversation provider enums, conversation REST validation, shared common types, and OpenAPI request or response enums, are updated to include `copilot` without breaking existing LM Studio and Codex records or API consumers.
- Copilot session continuity is deterministic for chat in this story. A follow-up request in the same chat conversation resumes the correct Copilot session rather than creating unrelated context silently.
- The implementation prefers the simplest compatibility-safe session identity strategy: use `conversationId` directly as the Copilot `sessionId` and document or test that path. Only fall back to storing `conversation.flags.copilotSessionId` if direct inspection of the installed SDK proves a separate stored session id is required.
- Copilot session create and resume calls both provide the documented `onPermissionRequest` handler, and any required tools, hooks, or other session-scoped handlers are re-registered on resume instead of assuming the SDK persists them automatically.
- Changing provider or model continues to follow the existing chat-page next-send behavior by starting a new conversation for the next send rather than switching the Copilot runtime in place for an existing conversation.
- If an existing persisted Copilot conversation cannot resume its expected session, the chat path fails clearly for that conversation instead of silently creating a fresh Copilot session behind the same transcript.
- The first Copilot chat story allows Copilot tool and permission requests by default rather than applying a deny-by-default policy.
- This story does not yet expose Copilot permission controls in the chat UI; a later story may surface those controls similarly to the existing Codex controls.
- The initial Copilot chat story does not add support for running agents, commands, or flows through the Copilot SDK.
- The initial Copilot chat story does not introduce new Copilot-specific controls in the page beyond provider selection, model selection, and existing transcript behaviour unless a small status or warning surface is needed for usability.
- The initial Copilot chat story does not expose the Copilot SDK's nested BYOK provider configuration to product users.
- The Copilot integration supports a product-level environment variable `CODEINFO_COPILOT_HOME` that is resolved and applied in the same style as `CODEINFO_CODEX_HOME`.
- Development defaults use `CODEINFO_COPILOT_HOME=../copilot` in `server/.env`, and container execution overrides that to `/app/copilot` in the same way Codex uses `/app/codex`.
- The Copilot home location is used for Copilot config and state, while the chat working directory remains the actual repository or mounted project directory rather than the Copilot home folder.
- The product can report Copilot authentication readiness and unauthenticated reasons before and after the Copilot device-auth flow runs.
- This story includes the shared `Choose Authentication` modal update, with both `Codex Auth` and `Copilot Auth` actions exposed in the UI.
- The shared authentication modal uses title `Choose Authentication`, shows `Codex Auth` above `Copilot Auth` in the main dialog body, and keeps `Close` in the bottom-right action area.
- The `Copilot Auth` action starts a Copilot-specific backend device-auth route rather than reusing the Codex route.
- The shared auth contract is no longer a Codex-only raw-output shape. It must support two phases for both providers: first, provider-specific verification details that the UI can render immediately; second, completion or readiness refresh so the page can update provider availability after the external browser or token step finishes.
- The shared auth flow returns the verification URL and one-time code as soon as they are available, rather than waiting for the full external browser login flow to complete.
- The shared auth flow tracks completion separately from the initial verification-details response and refreshes Copilot readiness after completion is detected through the existing provider-readiness surfaces rather than a second Copilot-only polling contract unless direct code evidence forces it.
- The shared auth contract defines enough state for the UI to distinguish at least these cases deterministically: verification details ready, completion still pending, authentication complete, authentication failed, and authentication unavailable before start.
- The Copilot auth flow works when the product is running in Docker without a browser in the container, because the UI shows the GitHub device-login URL and one-time code for the user to complete in an external browser.
- Successful Copilot authentication persists under the resolved `CODEINFO_COPILOT_HOME` location so later provider checks and chat requests can reuse it.
- If Copilot is already authenticated through one of the documented non-device-flow paths, the shared auth contract reports that state deterministically instead of starting a redundant device-login flow.
- If the container environment does not provide a usable keychain, the first implementation automatically persists Copilot auth/config state using the documented fallback under the mounted `CODEINFO_COPILOT_HOME` path without showing an extra confirmation dialog.
- Server process startup and the existing `/health` endpoint remain process-level health checks only. They must not fail just because the Copilot CLI is missing, Copilot is unauthenticated, or Copilot model discovery is unavailable. Copilot readiness stays on the chat-provider and chat-model surfaces.
- The story defines one concrete Copilot runtime delivery strategy for this repository. For this first implementation, the server runtime image and local development environment must provide a Copilot CLI binary that the SDK can spawn directly, either from `PATH` or from an explicit configured `cliPath`; the implementation must not rely on an undocumented external Copilot CLI server already running somewhere else.
- Development, local Docker, and e2e runtime paths all inject and mount `CODEINFO_COPILOT_HOME` consistently enough for the selected auth and session-persistence strategy to work, using one Docker-managed named-volume persistence pattern wherever container persistence is required.
- Runtime env wiring for this story must preserve the documented Copilot CLI credential precedence instead of overriding it. Committed env files may define `CODEINFO_COPILOT_HOME`, but they must not hard-code credential secrets or break runtime use of `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, or authenticated `gh` fallback.
- `server/.env`, `server/.env.local`, `server/.env.e2e`, `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` all define or override `CODEINFO_COPILOT_HOME` consistently for their environment instead of relying on ad hoc shell state.
- This story does not add a new HTTP listener, sidecar runtime, or externally exposed Copilot CLI port. The existing server and client ports remain the only application ports in scope: main `5010`, `5011`, `5012`, `5001`; local `5510`, `5511`, `5512`, `5501`, with Playwright MCP on `8931`; e2e `6010`, `6011`, `6012`, `6001`, with Playwright MCP on `8932`.
- Docker execution for this story continues to build the server and client from copied source inside the image build, using the existing Dockerfiles and build contexts. The plan must not introduce a new host source bind mount of application code into the Copilot-enabled containers.
- Any persistent Copilot-generated artifacts in containers use one Docker-managed named-volume pattern for generated state only, not host bind-mounted source trees. Host-visible bind mounts remain acceptable for logs only.
- Automated unit, integration, and default e2e coverage for this story do not require a live authenticated Copilot account. The story must provide a fake or mocked Copilot runtime seam for automated tests and treat any live Copilot smoke check as optional or manual-only.
- If Copilot is unavailable or unauthenticated, the provider list and/or chat execution path reports a clear reason instead of failing silently.
- If Copilot is unavailable, it remains visible in the provider list as disabled with its clear reason rather than being hidden.
- Existing Codex-only request flags remain Codex-only in this story and are either ignored with warnings or left unavailable for Copilot rather than being reinterpreted incorrectly.
- Existing LM Studio and Codex chat flows continue to work after the Copilot provider is added.
- The new provider is covered by unit and integration tests for provider discovery, model listing, validation, fallback behavior, and streamed chat execution.

### Out Of Scope

- Running agents through the Copilot SDK.
- Running commands or flows through the Copilot SDK.
- Reworking the existing agent or flow services to become multi-provider in this story.
- Exposing the Copilot SDK's nested BYOK provider-routing configuration in the product UI or REST payloads.
- Building a general provider-agnostic settings framework for every possible future model runtime.
- Adding a Copilot-specific or LM Studio-specific persisted default-model config source equivalent to Codex `codex/chat/config.toml`.
- Adding a new per-user UI control to save a preferred default chat provider or default chat model.
- Adding a custom GitHub OAuth application flow or general-purpose token-management UI for Copilot in this story.
- Replacing the documented Copilot device-login flow with a bespoke auth mechanism when the documented flow is sufficient.
- Broadening the chat page to expose Copilot-specific advanced settings such as hooks, custom agents, infinite sessions, or custom MCP-server editing.
- In-place Copilot model switching for an existing persisted conversation transcript.
- Silently replacing a missing or failed-to-resume Copilot session with a fresh session for an existing persisted conversation.
- Adding Copilot permission controls or approval-policy controls to the chat UI in this story.
- Replacing the existing Codex or LM Studio integrations.
- Changing ingestion providers or other non-chat provider systems in this story.

### Additional Repositories

- No Additional Repositories

### Planning Status

- Planning questions for this story have been resolved. The canonical `## Questions` section at the end of this file should remain the single questions checkpoint for the story.

### Decisions

1. Question: Should this story add Copilot support everywhere the product runs models, or only in the chat surface? Why it matters: the repository contains both chat-provider wiring and separate Codex-oriented agent and flow execution paths, and the amount of work changes significantly depending on scope. Decision: this story is chat-only. Agent, command, and flow support remain future work. Source and why this is best: direct repository inspection showed chat already has a provider factory and provider selection path, while agent and flow services still hardcode `provider: 'codex'` in many places. This is the smallest useful slice and avoids turning one provider addition into a repo-wide execution refactor.
2. Question: What top-level provider id should be used for this story, given that the Copilot SDK itself also uses the term `provider` for nested BYOK configuration? Why it matters: reusing ambiguous names would make route payloads, internal types, and future settings harder to reason about. Decision: the product-level provider id for this story is `copilot`, and the SDK's own nested provider configuration remains out of scope. Source and why this is best: the existing chat-provider ids are short transport/runtime identifiers such as `codex` and `lmstudio`, and repository research showed the Copilot SDK's `provider` object means something different. Keeping `copilot` as the app-level provider avoids naming collisions and keeps the story focused on GitHub Copilot-backed chat.
3. Question: How should Copilot chat session continuity be mapped onto the repository's existing chat conversation model? Why it matters: the Copilot SDK is session-based rather than stateless, so this story needs one deterministic rule for creating and resuming context across turns. Decision: Copilot chat should map one product chat conversation to one Copilot SDK session by reusing the existing conversation identity as the Copilot session identity by default. Only if direct inspection of the installed SDK proves that approach cannot work should the implementation store a separate Copilot session id under `conversation.flags`. Source and why this is best: the repository already uses stable conversation ids for persistence, and the Copilot SDK supports named session creation and resumption. Reusing the existing id is the simplest fit because it preserves conversation continuity without inventing a second competing chat identity or extra persistence unless the runtime truly forces it.
4. - Question being addressed: Should the first Copilot chat story expose the Copilot runtime's broader built-in tool and permission surface, or should it stay conservative?
   - Why the question matters: the SDK requires a permission handler and can enable shell, write, read, url, MCP, and custom-tool permissions, which directly changes what Copilot can do during chat.
   - What the answer is: allow everything by default in this story, matching the repository's current Codex default posture. Do not add Copilot permission controls to the chat UI yet; defer those controls to a later story.
   - Where the answer came from: user decision during planning, plus repository context that current Codex defaults are already permissive and the chat UI can add provider-specific controls in a future follow-up.
   - Why it is the best answer to the question: it keeps the first Copilot chat slice aligned with the current permissive runtime expectations in this repository, avoids inventing a stricter default for Copilot than Codex currently has, and cleanly separates runtime-default behavior from a future UX story that can expose adjustable permission controls.
5. Question: Should this story include a Copilot login experience inside the product, or should it stop at readiness/status reporting only? Why it matters: Codex already has a device-auth experience in the repository, and the user wants Copilot auth to work in Docker without depending on a browser inside the container. Decision: include a minimal in-app Copilot device-auth flow in this story. The implementation should use the documented Copilot CLI device-login path, surface the verification URL and code in the UI, and let the user finish the GitHub OAuth step in their own browser outside the container. Source and why this is best: the Copilot SDK auth docs and Copilot CLI auth docs document `copilot login` and `/login` as GitHub OAuth device flow, which matches the container constraint well and keeps the UX close to the existing Codex popup without needing a separate custom OAuth application.
6. Question: Should Copilot home-directory handling be introduced as a new product-specific environment variable in the same style as `CODEINFO_CODEX_HOME`, and if so what values should be used? Why it matters: the repository already uses a repo-local and container-local Codex home convention, and the user wants Copilot to behave the same way for configuration and persistent state. Decision: introduce `CODEINFO_COPILOT_HOME` and mirror the Codex pattern. Use `CODEINFO_COPILOT_HOME=../copilot` in `server/.env` for development, and override to `/app/copilot` in container execution. Resolve that value in server code, pass it through to the Copilot runtime as `COPILOT_HOME`, and also apply it as SDK `configDir` for deterministic state location. Source and why this is best: direct repository inspection showed `CODEINFO_CODEX_HOME` already uses this exact split between repo-local and in-container values, while Copilot SDK research showed support for overriding the default configuration directory and Copilot CLI research showed support for `COPILOT_HOME`. This is the closest clean analogue to the existing Codex contract while still keeping Copilot's working directory separate from its config home.
7. Question: Can the existing Codex device-auth popup be adapted into a shared authentication popup with both `Codex Auth` and `Copilot Auth` actions? Why it matters: the current repository already has shared popup UI for Codex auth, and the user wants a Copilot login path that feels similar while still working inside Docker. Decision: yes, and the shared popup update is part of this story rather than a follow-up. The shared popup UI should be adapted so `Codex Auth` keeps using the current route and `Copilot Auth` starts a Copilot-specific device-auth route that returns the verification URL and code from the documented Copilot login flow. The browser step still happens outside the container on the user's own machine. Source and why this is best: repository inspection showed the existing dialog is already reusable UI, and Copilot auth research now shows a documented GitHub device-login flow that can be surfaced the same way even when the runtime is containerized.
8. Question: What should happen if the container environment does not provide a usable system keychain for Copilot credential storage? Why it matters: desktop-style keychain assumptions often break in Docker, but the user still wants the Copilot login to persist and be reusable. Decision: the first implementation should automatically rely on the documented Copilot fallback of persisting auth/config state under the mounted `CODEINFO_COPILOT_HOME` path when no keychain is available, without showing an extra confirmation message. Source and why this is best: the user explicitly approved this tradeoff, and it gives the story a deterministic container-compatible persistence path without blocking on extra keychain infrastructure or adding unnecessary UI friction.
9. Question: What exact modal copy and layout should be used for the shared authentication popup in this story? Why it matters: the story now includes the modal update itself, so implementation should not have to guess the basic structure. Decision: use title `Choose Authentication`, place `Codex Auth` and `Copilot Auth` as vertically stacked primary actions in the middle of the dialog body with `Codex Auth` first, and keep `Close` in the bottom-right action area. Provider-specific loading, verification output, and error text should render below the auth buttons. Source and why this is best: this keeps the modal simple, matches the user's stated preference for button placement, and lets both providers share one stable dialog structure while still showing provider-specific output.
10. Question: How should this story relate to Story `0000047 – Codex Chat Config Defaults Bootstrap And Context7 Overlay` once that work is complete? Why it matters: both stories touch shared chat defaults and model-loading paths, and Story `0000047` is already changing the Codex side of those contracts. Decision: implement this story on top of the completed Story `0000047` baseline. Preserve the post-`0000047` Codex default/model/bootstrap behavior and extend it to support `copilot` rather than reintroducing older two-provider assumptions. Source and why this is best: Story `0000047` directly targets shared chat-default and model-resolution behavior, which this story also extends. Treating `0000047` as the baseline reduces regression risk and keeps the Copilot work focused on additive provider support rather than re-litigating Codex correctness.
11. Question: Does extending chat defaults to three providers mean this story must add a new Copilot-specific or LM Studio-specific model-default mechanism like Codex `codex/chat/config.toml`? Why it matters: Story `0000047` makes Codex default-model behavior more explicit, which can make later three-provider wording sound broader than intended. Decision: no. This story should extend the shared provider/default-selection path so `copilot` is a valid chat provider in bootstrap and fallback behavior, but it should not add a new provider-specific persisted default-model source or a new preference UI for Copilot or LM Studio. Source and why this is best: repository inspection shows current generic chat defaults already flow through the shared `CODEINFO_CHAT_DEFAULT_*` path, while provider-specific config-backed default-model behavior is currently a Codex-only concept. Keeping that asymmetry explicit avoids accidental scope growth and matches the user's clarified expectation for this story.
12. Question: Does the current research fully define the exact Copilot SDK `ModelInfo` fields that will be available for dropdown mapping and reasoning metadata? Why it matters: the story already assumes `client.listModels()` can drive the Copilot model dropdown, but the docs snippet used in planning confirms the method exists more clearly than it documents every returned field. Decision: treat the existence of `listModels()` as confirmed, but verify the installed SDK's actual `ModelInfo` shape before locking in the response mapping. Preserve reasoning metadata when present, and do not invent unsupported fields in the app contract just because other providers expose similar metadata. Source and why this is best: current SDK documentation and research confirm runtime model listing and mention reasoning-effort discovery, but they do not guarantee every `ModelInfo` field in the planning text. Capturing this caveat in the plan keeps the implementation grounded in the real SDK surface and avoids brittle assumptions.
13. Question: How should the story handle Copilot token-usage and timing metadata when the SDK exposes only part of what the current chat bubble UI can display? Why it matters: the existing transcript formatter can show input, output, total, cached input, total time, and tokens-per-second values, but current Copilot SDK research confirms some of those fields more strongly than others. Decision: only populate usage and timing fields that are actually confirmed by the Copilot SDK at implementation time, leave unavailable fields unset, and harden the formatter so `undefined` or `null` values are omitted instead of rendering misleading zeros. Preserve the current display for Codex and LM Studio except for this defensive missing-value handling. Source and why this is best: repository inspection shows the current UI would otherwise show zero placeholders for partially populated usage metadata, while the current Copilot SDK docs most clearly confirm input/output usage and leave other fields less certain. This approach keeps the Copilot integration honest to the SDK, avoids front-end regressions, and protects the appearance of existing providers.
14. - Question being addressed: Should changing the selected Copilot provider or model on the chat page continue to start a new conversation for the next send, or should this story support in-place Copilot session model switching within the existing conversation?
    - Why the question matters: the current chat page already treats provider and model changes as next-send changes that reset the draft conversation, while the Copilot SDK also supports model changes during resume or through lower-level APIs. The story therefore needs one explicit product rule so implementation does not preserve a transcript while silently changing the underlying Copilot runtime context.
    - What the answer is: keep the current product behavior. Changing provider or model should continue to start a new conversation for the next send rather than switching the Copilot runtime in place for an existing persisted conversation.
    - Where the answer came from: repository evidence from `client/src/pages/ChatPage.tsx`, Story `0000046 – Prevent Blank Embedding Inputs And Unintended Conversation Switch Stops`, and prior codebase_question analysis of current provider/model reset behavior; external confirmation from GitHub Copilot SDK docs and DeepWiki showing that the SDK can switch or override models on session create/resume, which makes this a product-policy choice rather than an SDK constraint.
    - Why it is the best answer to the question: it preserves the current chat UX contract, avoids silent context drift inside an existing visible transcript, and keeps provider/model selection semantics consistent across Codex, LM Studio, and Copilot.
15. - Question being addressed: If the server cannot resume the expected Copilot session for an existing persisted conversation, should the chat route silently create a fresh Copilot session or fail clearly on that conversation?
    - Why the question matters: the story wants deterministic session continuity and uses the persisted conversation as the user-visible source of truth. Silently creating a fresh session on resume failure would make the transcript appear continuous even though the underlying model context had been lost.
    - What the answer is: fail clearly when an existing persisted Copilot conversation cannot resume its expected session, and require an explicit new conversation if the user wants to continue with a fresh Copilot session. Automatic `createSession(...)` fallback is only appropriate when the product is truly starting a new conversation or there is no prior Copilot session identity to recover.
    - Where the answer came from: repository evidence from the conversation-persistence design, current chat conversation-selection behavior, and prior codebase_question analysis of transcript continuity and context drift; external confirmation from GitHub Copilot SDK session-persistence and back-end examples plus DeepWiki guidance showing that `resumeSession(...)` failure handling is application-defined.
    - Why it is the best answer to the question: it keeps the transcript honest, protects users from hidden context loss, and matches the repository’s broader pattern of making new-conversation boundaries explicit instead of silently mutating persisted conversation meaning.
16. - Question being addressed: Should the shared Copilot auth UX use a two-phase device-flow contract that returns the verification URL and user code as soon as they are available and then tracks completion separately, or should the auth request block until the full `copilot login` flow finishes?
    - Why the question matters: the user must see the verification URL and one-time code quickly so they can complete the browser step outside the app or container. If the backend waits for the whole CLI login flow to finish before responding, the modal may not surface the code early enough, and the current plan would still leave completion detection underspecified.
    - What the answer is: use a two-phase shared auth contract. The backend should return verification details immediately once parsed, keep completion tracking or readiness rechecks separate, and refresh Copilot readiness after completion is detected. Where practical, implement this as an upstream improvement to the shared auth behavior rather than a Copilot-only exception.
    - Where the answer came from: repository evidence from `server/src/utils/codexDeviceAuth.ts`, `server/src/routes/codexDeviceAuth.ts`, `client/src/components/codex/CodexDeviceAuthDialog.tsx`, and `client/src/pages/ChatPage.tsx`; codebase_question results about the current Codex auth flow; external confirmation from GitHub Copilot SDK auth samples, DeepWiki guidance on device flow, and GitHub OAuth device-flow documentation describing the prompt-then-poll sequence.
    - Why it is the best answer to the question: it gives users the code quickly, matches the natural structure of device auth, avoids a sluggish blocking modal flow, and encourages one shared upstream auth contract instead of separate Codex and Copilot UX rules.
17. - Question being addressed: What exact readiness and reason-precedence rules should Copilot use in `GET /chat/providers` and `GET /chat/models` when different checks can fail, such as CLI connectivity, authentication, model listing, or tool availability?
    - Why the question matters: the acceptance criteria require clear availability and reason reporting, and without one precedence rule the provider list, model list, auth refresh path, and chat execution path could expose inconsistent states or reasons.
    - What the answer is: keep `available`, `toolsAvailable`, and warnings separate, evaluate blocking readiness in this order of precedence: Copilot CLI or SDK connectivity first, authentication status second, model-list success third, and tool-surface availability last, use the first failing blocking readiness check as the surfaced provider `reason`, and keep Copilot visible but disabled in the provider list with that reason instead of hiding it.
    - Where the answer came from: repository provider-state patterns in `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, `server/src/config/chatDefaults.ts`, `client/src/hooks/useChatModel.ts`, and `client/src/pages/ChatPage.tsx`, plus Copilot SDK and DeepWiki guidance covering `getStatus()`, `getAuthStatus()`, `ping()`, and `listModels()`.
    - Why it is the best answer to the question: it extends the product's existing provider UX and status-contract shape to Copilot, keeps readiness reporting deterministic across all chat surfaces, and still leaves room for warning-level tool-surface details without overloading the main provider reason.

### Repository Facts and Current Contracts

- Current repository only. No additional repositories are required for this story, and all provider, persistence, auth, and UI work lands in this repository.
- Current provider selection is still two-provider-only in code. `server/src/config/chatDefaults.ts` defines `ChatDefaultProvider = 'codex' | 'lmstudio'`, uses `VALID_PROVIDERS = ['codex', 'lmstudio']`, and still assumes a binary fallback model with `FALLBACK_PROVIDER = 'codex'`.
- Current provider discovery and model loading are two-provider-only. `server/src/routes/chatProviders.ts` builds a `providerMap` for `codex` and `lmstudio` only and orders the provider list by `executionProvider` plus one alternate provider. `server/src/routes/chatModels.ts` branches only for `provider === 'codex'`, otherwise it assumes LM Studio.
- Current request validation is two-provider-only. `server/src/routes/chatValidators.ts` accepts only `provider must be "codex" or "lmstudio"` and types the validated provider as `type Provider = 'codex' | 'lmstudio'`.
- Current execution factory is two-provider-only. `server/src/chat/factory.ts` registers only `codex` and `lmstudio`, so Copilot must be added as a first-class provider rather than handled through an ad hoc conditional elsewhere.
- Current persistence is partly Codex-oriented. `server/src/mongo/conversation.ts` types `ConversationProvider = 'lmstudio' | 'codex'` and documents `_id` as `conversation id (Codex thread id for Codex provider)`, so the story must tighten how Copilot session identity maps onto existing conversation ids. The preferred path is to reuse that existing conversation identity directly instead of adding a second stored id unless the SDK proves that is impossible.
- Current conversation REST validation is also two-provider-only. `server/src/routes/conversations.ts` validates `provider: z.enum(['lmstudio', 'codex'])`.
- Current shared client and OpenAPI contracts are still legacy-biased. `common/src/lmstudio.ts` exposes generic `ChatProviderInfo` and `ChatModelsResponse`, but `openapi.json` and related request or response enums still contain two-provider-only values and some older `openai` literals that need reconciliation when Copilot is added.
- Current shared auth UX is Codex-only. `client/src/components/codex/CodexDeviceAuthDialog.tsx` shows `Codex device auth` with a raw-output panel and `Start device auth`, and `common/src/api.ts` only defines `CodexDeviceAuthResponse`. `server/src/routes/codexDeviceAuth.ts` is likewise Codex-specific, so the story needs an upstream shared auth contract rather than a second unrelated modal.
- Current transcript formatting already omits timing lines when values are absent, but usage formatting still falls back missing token fields to `0` in `client/src/components/chat/chatTranscriptFormatting.ts`. The story therefore needs to harden the shared formatter rather than only adding Copilot-specific display code.

### Message Contracts and Storage Shapes

- Current repository only. All contracts and storage-shape changes in this section are owned and consumed within this repository, so this story uses the normal single-repository contract style.
- Provider discovery contract: reuse the existing shared `ChatProviderInfo` shape from `common/src/lmstudio.ts` with no new top-level response type. The only required shape change is to allow `id: 'copilot'` alongside the existing provider ids. Keep the existing fields `id`, `label`, `available`, `toolsAvailable`, and optional `reason`; do not add a Copilot-only provider payload.
- Model-list contract: reuse the existing shared `ChatModelsResponse` and `ChatModelInfo` shapes rather than inventing a Copilot-only model response. This is an existing-shape extension, not a brand new contract. Copilot model entries should map into the same `key`, `displayName`, and `type` fields, and may populate optional reasoning metadata only where the installed SDK actually exposes compatible fields. `codexDefaults` and `codexWarnings` remain Codex-only optional payload fields and should be omitted for Copilot responses rather than mirrored with Copilot-specific duplicates.
- Chat request contract: extend the existing request contract, not replace it. The validated provider enum in `server/src/routes/chatValidators.ts`, any shared client request helpers, and the corresponding request enums in `openapi.json` must all expand to include `copilot`. This story should not introduce new top-level Copilot-only request fields for normal chat sends. Any provider-specific request behavior should continue to live in validated optional flags, and Codex-only flags must remain Codex-only.
- Chat event and transcript contract: no new top-level persisted turn shape is required up front. The existing chat stream and turn payload model already supports content, tool calls, usage, timing, and status. Copilot streaming events from the SDK or CLI must therefore be translated into the current repository event model rather than stored as raw Copilot event envelopes. This means the application owns the translation layer, while the SDK remains the source of raw session events such as `assistant.message_delta`, `assistant.message`, `assistant.reasoning_delta`, `assistant.usage`, `tool.execution_*`, and `session.idle`.
- Conversation storage contract: reuse the existing conversation collection rather than creating a new Copilot-specific collection. This is an existing-shape change. `server/src/mongo/conversation.ts` and `server/src/routes/conversations.ts` must expand their provider enums to allow `provider: 'copilot'`. The default implementation path is to reuse the repository `conversationId` as the Copilot `sessionId`, which needs no extra storage field. Only if the installed SDK proves a different session id is required should that fallback value be stored under `conversation.flags.copilotSessionId`.
- Turn storage contract: no new Mongo collection or mandatory top-level turn schema is needed. The existing `Turn` shape in `server/src/mongo/turn.ts` already supports `provider`, `toolCalls`, `usage`, `timing`, `runtime`, and `status`. The required contract rule is that Copilot usage or timing fields must only be persisted when they are actually produced by the SDK or CLI. Missing values remain absent, not zero-filled. If Copilot reasoning content is shown in the UI, it should continue to flow through the repository's existing assistant-message or think-display paths rather than introducing a second persisted reasoning store in this story.
- Auth contract: this story does require one genuinely new shared message contract. The current `CodexDeviceAuthResponse` in `common/src/api.ts` is Codex-specific and cannot serve Copilot unchanged. Replace it with a shared provider-auth contract used by both Codex and Copilot. Up front, that shared contract should carry: provider id, whether verification details are available yet, verification URL when present, one-time user code when present, provider-facing display output only where still useful for the UI, completion or readiness state for the second phase of device auth, and a deterministic failure reason when auth cannot proceed. The story should treat this as a new shared contract that supersedes the Codex-only response shape rather than as a second parallel auth response family.
- OpenAPI and shared-type propagation contract: every contract change above must be reflected in `openapi.json` and the shared exported types at the same time. This includes provider enums for `/chat`, `/chat/models`, and conversation APIs, plus the new shared auth route or routes and their response schemas. The plan should treat OpenAPI updates as part of the contract definition itself, not as follow-up documentation work.
- Migration and compatibility expectations: no historical data migration should be required for existing LM Studio or Codex conversations and turns. Provider enum expansion must remain backward-compatible with existing stored data. The only new storage field currently expected is the optional `conversation.flags.copilotSessionId`, and that field should appear only if direct implementation evidence proves the simpler `conversationId` reuse path cannot work.

### Schema and Contracts Matrix

- `Server input validation`: update `server/src/routes/chatValidators.ts` so chat request bodies accept `provider: 'copilot'` and still reject malformed provider values and mis-scoped Codex-only flags.
- `Server provider defaults and fallback`: update `server/src/config/chatDefaults.ts` so provider parsing, fallback, and ordered-provider logic all understand `copilot` and use the same ordered list everywhere.
- `Server provider discovery and model routes`: update `server/src/routes/chatProviders.ts` and `server/src/routes/chatModels.ts` so Copilot availability, reason text, and model entries use the shared contract shapes already defined above.
- `Server execution factory`: update `server/src/chat/factory.ts` and the Copilot chat adapter so provider id `copilot` is accepted by the execution layer and translated into the existing event bridge.
- `Server conversation persistence`: update `server/src/mongo/conversation.ts`, `server/src/routes/conversations.ts`, and any conversation repository helpers so the stored provider enum accepts `copilot` and defaults to reusing `conversationId` as the Copilot session id. Handle `conversation.flags.copilotSessionId` only if direct implementation evidence proves that fallback is required.
- `Shared auth contract`: update `common/src/api.ts` and the server or client auth callers together so the existing Codex-only auth response becomes one shared provider-auth contract used by both `Codex Auth` and `Copilot Auth`.
- `Client provider and model consumers`: update `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, and `client/src/pages/ChatPage.tsx` so they consume the updated provider, model, and auth contracts without assuming a two-provider world.
- `Transcript rendering`: update `client/src/components/chat/chatTranscriptFormatting.ts` and related transcript consumers so partial Copilot metadata follows the shared missing-value rules already defined in this plan.
- `OpenAPI`: update `openapi.json` at the same time as the code changes above so documented request or response enums, auth routes, and provider-specific schemas match the implemented server behavior exactly.
- `Tests`: update unit, integration, Cucumber, and e2e tests anywhere they currently assert a two-provider contract or a Codex-only auth contract, and add the Copilot harness-backed coverage already described in `## Test Harnesses`.

### Edge Cases and Failure Modes

- Provider fallback must stay deterministic across server and client. If the requested provider is unavailable, both `/chat/providers` and `/chat` must use the same ordered-list fallback rules instead of drifting between routes.
- Existing LM Studio and Codex conversations must remain readable after the provider enum expansion. This story must not require migration of historical conversations just to add `copilot` as a new allowed provider.
- If Copilot model listing succeeds but returns no usable chat models, Copilot stays visible but unavailable with a clear reason instead of being silently removed from the provider list.
- If the Copilot client cannot start, times out during startup, or the spawned CLI process exits before becoming ready, the server must keep running and Copilot must surface as unavailable with a clear startup reason rather than crashing global server startup or hanging provider checks.
- If Copilot auth is unavailable because the CLI is missing, the SDK cannot connect, or an environment token is overriding the stored login unexpectedly, the surfaced provider reason must identify the first blocking state according to the precedence rules already decided in this plan.
- If the resolved `CODEINFO_COPILOT_HOME` or SDK `configDir` path is missing, not writable, or cannot persist session state, Copilot must surface a clear unavailable or auth-storage reason instead of failing later with a vague chat error.
- If the OS keychain is unavailable, the first implementation must fall back to config-file persistence under the resolved `CODEINFO_COPILOT_HOME` path without adding a manual recovery step to the UI.
- If an existing Copilot conversation cannot resume its expected session, the turn fails clearly and the user must explicitly start a new conversation. The implementation must not silently create a fresh Copilot session behind the same transcript.
- If Copilot session resume requires permission handlers, tool handlers, or other per-session callbacks to be re-registered, the implementation must restore them on resume. Missing re-registration should fail clearly and must not leave the session half-resumed with broken tool execution.
- If multiple requests target the same persisted Copilot conversation concurrently, the existing conversation lock behavior must continue to prevent concurrent session mutation rather than allowing two live Copilot turns to race against the same session state.
- If a user changes provider or model while looking at an existing conversation, the next-send new-conversation behavior still applies. The story must not mutate the runtime provider or model in place for an already persisted conversation.
- If Copilot streaming emits deltas without a final message, a final message without prior deltas, repeated final-like events, or a session error after partial output, the chat bridge must finish in one deterministic way without duplicating transcript text or leaving the conversation stuck in a streaming state.
- Any Copilot-specific request fields added in this story must be ignored with warnings or rejected clearly on non-Copilot providers. They must not be silently reinterpreted as Codex or LM Studio behavior.
- If Copilot model metadata or event payloads contain fields the repository does not currently understand, those unknown fields should be ignored safely rather than causing route failure, persistence failure, or misleading transcript labels.
- The shared auth modal must not regress current Codex auth behavior while adding Copilot. The Copilot work should extend the shared dialog contract upward rather than forking a second inconsistent dialog.

### Missing Runtime and Deployment Prerequisites

- Missing SDK and CLI runtime delivery: the repository does not yet depend on `@github/copilot-sdk`, and there is no existing Copilot CLI installation path in `server/package.json`, `server/npm-global.txt`, or `server/Dockerfile`. This story must add both the SDK dependency and one explicit way for the server runtime to find a `copilot` CLI binary.
- Missing Copilot client lifecycle seam: the current server has provider factories for Codex and LM Studio only, and no shared Copilot client bootstrap or shutdown path. This story must add a reusable Copilot client seam that can `start()`, `stop()`, and be reused across readiness, model-list, auth-refresh, and chat execution flows.
- Missing environment-variable injection path: `CODEINFO_COPILOT_HOME` is not present in `server/.env`, `server/.env.local`, `server/.env.e2e`, `server/src/config/startupEnv.ts`, `docker-compose.yml`, `docker-compose.local.yml`, or `docker-compose.e2e.yml`. This story must add that variable through every supported runtime path instead of relying on ad hoc local shell state.
- Missing Docker and compose storage mapping: the current runtime image creates `/app/codex` and compose files mount Codex-related paths, but there is no `/app/copilot` runtime directory or Copilot volume or bind mount. This story must add a writable Copilot home mapping for local Docker and whichever non-local compose profiles are expected to support Copilot auth or session persistence.
- Missing Docker build-context ignore rule: the root `.dockerignore` already excludes Codex runtime homes and auth artifacts from the server build context, but there is no equivalent Copilot exclusion yet. This story must update the active build-context ignore file so repo-local Copilot auth or session data never gets copied into image builds.
- Missing auth transport and contract: the codebase currently exposes only `/codex/device-auth`, `CodexDeviceAuthResponse`, and a Codex-specific dialog. This story must add the shared provider-auth contract and Copilot route or routes before the UI can surface Copilot device login or refresh readiness after completion.
- Missing provider-compatible startup behavior: the current `/health` endpoint only reports process uptime and Mongo connectivity. This story must explicitly preserve that behavior and avoid making global startup fail when Copilot prerequisites are missing. Copilot readiness belongs in `/chat/providers` and `/chat/models`, not in server boot success.
- Missing deployment contract for external CLI mode: there is no existing compose or runtime listener for connecting the SDK to an external headless Copilot CLI server over `cliUrl`, and nothing in the repo provisions such a service. This story therefore assumes in-process CLI spawning, not an external Copilot server, unless the plan is later revised explicitly.
- Missing automated test seam: the current test harnesses, fixtures, OpenAPI assertions, and provider tests cover only LM Studio and Codex. This story must add a fake or mock Copilot seam for unit, integration, Cucumber, and default e2e coverage so the automated suite does not depend on a real Copilot login.

## Implementation Ideas

### Rough implementation sequence

1. `Shared contracts first`: update the provider enum and request or response shapes in `common/src/api.ts`, `common/src/lmstudio.ts`, `common/src/index.ts`, `server/src/config/chatDefaults.ts`, `server/src/routes/chatValidators.ts`, `server/src/routes/conversations.ts`, and `openapi.json` together so `copilot` is accepted consistently across client, server, persistence, and docs. This step should also replace the current two-provider fallback assumptions with one ordered provider list: `codex`, `copilot`, `lmstudio`.
2. `Server runtime seam next`: add `@github/copilot-sdk` in `server/package.json`, create a small reusable Copilot lifecycle module under `server/src/chat` or `server/src/providers`, and introduce `server/src/chat/interfaces/ChatInterfaceCopilot.ts`. The seam should own `CopilotClient.start()`, `stop()`, `createSession(...)`, `resumeSession(...)`, and `listModels()` so routes do not construct clients ad hoc.
3. `Provider readiness and model routes`: extend `server/src/routes/chatProviders.ts` and `server/src/routes/chatModels.ts` to use the new Copilot seam, keep Copilot visible with a stable `reason` when unavailable, and map Copilot `ModelInfo` into the existing shared model response shape. Keep readiness precedence deterministic: connectivity first, auth second, model-list success third, tool availability last.
4. `Chat execution and persistence`: extend `server/src/chat/factory.ts`, `server/src/routes/chat.ts`, `server/src/mongo/conversation.ts`, and the shared conversation repo helpers so Copilot can create or resume chat sessions, stream events into the existing transcript pipeline, and persist a resumable session identity without silently forking an existing conversation. Reuse the repo conversation id directly as the Copilot session id unless direct SDK evidence proves a separate stored id is required, in which case store that fallback id explicitly in `conversation.flags`.
5. `Shared auth flow`: generalize the current Codex-only auth contract in `common/src/api.ts`, `server/src/routes/codexDeviceAuth.ts`, `client/src/api/codex.ts`, and `client/src/components/codex/CodexDeviceAuthDialog.tsx` into a shared provider-auth flow, then add the Copilot device-login route and UI action on top. The response contract should return the verification URL and one-time code as soon as they are available and let readiness refresh happen separately.
6. `Client provider and transcript behavior`: update `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, and `client/src/components/chat/chatTranscriptFormatting.ts` so the chat page handles three providers, preserves current next-send new-conversation behavior on provider or model change, and omits missing Copilot token or timing values instead of rendering placeholder zeros.
7. `Runtime wiring and Docker`: update `server/src/config/startupEnv.ts`, `server/.env`, `server/.env.local`, `server/.env.e2e`, `server/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, and the root `.dockerignore` so Copilot runtime state is resolved through `CODEINFO_COPILOT_HOME`, copied into images via the normal Docker build context, and persisted only via Docker-managed volumes where needed. Do not add a Copilot-specific port or a new source-tree bind mount.
8. `Test seam and validation`: add a fake Copilot adapter early so `server/src/test/unit`, `server/src/test/integration`, Cucumber, and any default e2e coverage can exercise Copilot behavior without requiring a real login. Final validation should prove three-provider fallback, readiness reporting, Copilot chat streaming, resume failure handling, shared auth flow, and transcript rendering.

### Detailed implementation notes

- `Dependency and lifecycle`: add `@github/copilot-sdk` to the server workspace and introduce a shared Copilot-client lifecycle module rather than constructing a fresh client per request. Context7 and DeepWiki both show `CopilotClient` as the main long-lived surface, with `start()`, `stop()`, `createSession(...)`, `resumeSession(...)`, and `listModels()` as the core APIs to centralize.
- `Runtime prerequisite choice`: implement Copilot through the SDK's documented child-process CLI path, not through an undocumented external listener. There is no current repo seam for a separate Copilot server, so the plan should assume in-process CLI spawning unless a later story explicitly introduces external `cliUrl` support.
- `Copilot home resolution`: add one config helper similar to the existing Codex home handling so the server has a canonical way to resolve `CODEINFO_COPILOT_HOME`, derive `COPILOT_HOME`, and pass `configDir` when creating or resuming sessions. This keeps auth and session state deterministic between local and container runs.
- `Server health boundary`: keep `/health` as a process and Mongo check only. Copilot readiness belongs in `/chat/providers` and `/chat/models`, not in global server startup success.
- `Provider detection and status`: create a dedicated Copilot readiness utility modeled after the current Codex detection flow. It should answer whether the client can start, whether auth is usable, whether models can be listed, and which first failing blocking check becomes the surfaced provider `reason`.
- `Auth UX`: adapt the existing shared authentication modal so it becomes `Choose Authentication` with vertically stacked `Codex Auth` and `Copilot Auth` actions in the body, while `Close` stays in the dialog actions area. Keep provider-specific status, verification details, and errors below the buttons instead of forking a second modal.
- `Shared auth contract`: replace the current Codex-only `rawOutput` contract with a shared provider-auth response shape that can represent provider id, verification URL, one-time code, completion or refresh state, and failure reason. This should land in `common/src/api.ts` first, then be adopted by the server routes and client UI together.
- `Copilot device auth`: add a Copilot-specific backend utility and route that runs the documented `copilot login` device flow, parses the verification URL and code, and returns them immediately for the user to finish in a normal browser outside Docker.
- `Copilot auth persistence`: keep Copilot auth and config state under the resolved `CODEINFO_COPILOT_HOME` path so login survives restarts. If the runtime lacks a usable keychain, rely on the documented config-directory fallback rather than inventing a separate token store.
- `Provider selection types`: update `server/src/config/chatDefaults.ts` so `ChatDefaultProvider` includes `copilot`, `VALID_PROVIDERS` includes `copilot`, and the runtime fallback path is driven by the explicit ordered provider list instead of a binary alternate-provider rule.
- `Validation`: update `server/src/routes/chatValidators.ts` so `provider: "copilot"` is valid. Keep Codex-only flags Codex-only in this story, and ignore them with warnings when they arrive on Copilot requests rather than misapplying them.
- `Factory and adapter`: register `ChatInterfaceCopilot` in `server/src/chat/factory.ts`. The new adapter should acquire the shared client, create or resume the Copilot session, supply an allow-by-default permission handler for this story, subscribe to session events such as `assistant.message_delta` and `session.idle`, and translate them into the repository `ChatInterface` event model.
- `Provider or model change semantics`: preserve the current chat-page rule that provider or model changes apply on the next send by starting a new conversation. Do not use Copilot session model-switch features to mutate an already persisted conversation in place.
- `Session identity and resume failure`: choose one deterministic session-identity rule and keep it consistent in code and tests. If `resumeSession(...)` fails for an existing persisted Copilot conversation, surface a clear error instead of silently creating a new session behind the same transcript.
- `Model listing`: extend `server/src/routes/chatModels.ts` with a Copilot branch that calls `listModels()` and maps only verified `ModelInfo` fields into the existing `ChatModelsResponse` shape. Preserve supported reasoning metadata only where the installed SDK actually exposes it.
- `Usage and timing mapping`: when translating Copilot session events into the repository event model, populate only verified usage or timing fields. Do not synthesize zeros for missing values, and only derive totals where the derivation is semantically correct and covered by tests.
- `Transcript formatter hardening`: update the shared transcript formatter in `client/src/components/chat/chatTranscriptFormatting.ts` so missing token and timing sub-values are omitted rather than shown as `0`. Keep current Codex and LM Studio rendering stable apart from that narrow hardening.
- `Provider listing`: extend `server/src/routes/chatProviders.ts` so the provider list can include Copilot with `available`, `toolsAvailable`, and stable `reason` handling. Keep Copilot visible but disabled when unavailable rather than hiding it.
- `Chat route`: extend `server/src/routes/chat.ts` so runtime provider resolution, fallback handling, execution, and persistence all understand Copilot. Keep the Codex runtime-config load path Codex-specific rather than making it an accidental dependency for Copilot.
- `Client model hook and page`: extend `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx` so client bootstrap, provider fallback, model loading, and auth refresh all handle three providers cleanly without forcing Copilot into LM Studio-specific assumptions or exposing Codex-only controls.
- `Compose and Docker prerequisites`: mirror the existing Codex pattern by creating `/app/copilot` in the runtime image, injecting `CODEINFO_COPILOT_HOME=/app/copilot` in container env, and attaching a Docker-managed volume for Copilot-generated state where persistence is required. Keep the existing published ports unchanged and do not add a Copilot-specific listener port.
- `Environment defaults and compose wiring`: update `server/.env`, `server/.env.local`, `server/.env.e2e`, `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` so `CODEINFO_COPILOT_HOME` follows the same repo-local versus in-container pattern as `CODEINFO_CODEX_HOME`. For container persistence, prefer a named Docker volume mounted at `/app/copilot` rather than a host source bind mount such as `./copilot:/app/copilot`.
- `Build context hygiene`: keep the current image-build model where application code is copied into Docker images from the repo build context and built there. Update the root `.dockerignore` so repo-local Copilot homes, auth files, and session-state artifacts are excluded from image builds just like existing Codex runtime secrets.
- `Permission defaults`: wire Copilot permission handling so requests are allowed by default in this story, matching the current Codex posture. Do not add Copilot-specific permission controls to the chat UI yet.
- `Naming clarity`: keep the product-level provider id `copilot` separate from any internal type or variable names that refer to the Copilot SDK's own BYOK `provider` config to avoid overloaded terminology.
- `Story ordering`: build this story on top of the completed `0000047` Codex default and model bootstrap work. In shared files such as chat defaults, chat models, and the client provider-model hook, preserve the post-`0000047` Codex behavior and layer Copilot support on top of it.
- `Test harness prerequisite`: introduce a reusable fake Copilot client or adapter seam early so unit, integration, feature, and default e2e coverage can validate provider behavior without requiring a real Copilot account or CLI login. Keep any live Copilot smoke check manual or opt-in.
- `Likely tests`: add coverage for three-provider defaulting and fallback, `provider: "copilot"` validation, Copilot event mapping, Copilot streaming and persistence in the chat route, shared auth early-return behavior, resume failure handling, provider and model selection in the client, and transcript formatting when Copilot usage or timing fields are partially missing.
- `Implementation constraint`: do not use this story to refactor agents or flows to become provider-agnostic. The later agent-support story can build on the chat integration patterns proven here.

## Test Harnesses

The story does require new test harness support, but it does not require a brand new test runner or a new test category. The existing repository already has unit, integration, Cucumber, and Playwright e2e layers. What is missing is a deterministic Copilot-ready harness inside those existing layers so the planned Copilot tests can run without a real GitHub login, a live Copilot CLI session, or flaky external state.

Repository evidence for this conclusion:

- Current server test support already includes `server/src/test/support/mockLmStudioSdk.ts` plus container helpers in `server/src/test/support/chromaContainer.ts` and `server/src/test/support/mongoContainer.ts`, but there is no Copilot equivalent.
- Current provider and execution tests are still Codex or LM Studio oriented, for example `server/src/test/unit/chatProviders.test.ts`, `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chat-interface-codex.test.ts`, `server/src/test/integration/chat-codex.test.ts`, and `server/src/test/integration/codex.device-auth.test.ts`.
- Current client test support includes generic fetch and websocket helpers under `client/src/test/support`, and transcript measurement support in `client/src/test/support/transcriptMeasurementHarness.ts`, but there is no shared provider-auth fixture or Copilot session fixture.
- Current e2e coverage already exercises chat and runtime config through Playwright, for example `e2e/chat-provider-history.spec.ts`, `e2e/chat-codex-mcp.spec.ts`, `e2e/chat-codex-trust.spec.ts`, and `e2e/env-runtime-config.spec.ts`, but there is no deterministic Copilot provider fixture yet.

External research that shapes the harness design:

- Context7 and DeepWiki both show the Node SDK centered around a long-lived `CopilotClient` with `start()`, `stop()`, `createSession(...)`, `resumeSession(...)`, `listModels()`, and streaming session events such as `assistant.message_delta` and `session.idle`.
- DeepWiki also shows the SDK project using lower-level mocking around the request layer and replay-style e2e infrastructure. For this repository, the simpler fit is to add a local fake client seam that plugs into the existing server test structure rather than introducing the SDK's own replay proxy stack into this story.

The harnesses that should be added are:

- `Server Copilot SDK fake harness`: add `server/src/test/support/mockCopilotSdk.ts`. This should expose a deterministic fake `CopilotClient` and fake session objects for unit, integration, and Cucumber-backed route tests. The fake should let tests script `start()`, `stop()`, `ping()`, `listModels()`, `createSession(...)`, `resumeSession(...)`, auth or readiness results, and emitted session events such as `assistant.message_delta`, `assistant.message`, `session.idle`, tool events, and failure paths.
- `Server Copilot auth CLI harness`: add `server/src/test/support/mockCopilotDeviceAuth.ts`. This should provide reusable fake outputs for the planned Copilot device-login route, including verification URL and one-time code parsing, delayed completion, declined or expired codes, missing CLI cases, and readiness-refresh outcomes. The current Codex auth tests inline these behaviors, but Copilot will need a reusable harness because the story explicitly adds two-phase auth behavior and provider-specific readiness refresh.
- `Client shared provider-auth fixtures`: extend the existing fetch-based client test helpers under `client/src/test/support` so client tests can drive the shared `Choose Authentication` dialog with Codex and Copilot response fixtures, including early verification details, later completion refresh, loading states, and provider-specific failure messages. Reuse `fetchMock.ts` and current auth test patterns instead of adding a second client-specific harness layer unless direct code evidence forces it.
- `Playwright and server integration Copilot scenarios`: extend the existing integration and e2e boot paths so they can enable named fake Copilot scenarios without a real login. The simplest place is to reuse the fake SDK and auth harnesses above through the repository's current test dependency-injection and wrapper-backed startup paths rather than introducing a second fixture layer for Playwright and integration tests.

The harnesses above should then support the planned tests in these locations:

- `server/src/test/unit`: provider ordering, validator changes, Copilot model mapping, readiness precedence, chat adapter event translation, usage and timing field handling, and resume-failure behavior.
- `server/src/test/integration`: `/chat/providers`, `/chat/models`, `POST /chat`, conversation persistence, and the new Copilot device-auth route.
- `server/src/test/features` and `server/src/test/steps`: extend the existing chat model and chat stream features so Copilot can be exercised with deterministic streamed events and deterministic unavailable or unauthenticated cases.
- `client/src/test`: shared auth dialog behavior, provider selection and model loading, next-send new-conversation behavior, and transcript formatting for partial Copilot metadata.
- `e2e/`: provider availability, provider-history behavior, auth refresh behavior, and transcript rendering using the same fake Copilot backend seam rather than a real login.

The story should not plan a live Copilot login as part of the default automated suite. If a manual or opt-in smoke check is desired later, that should stay outside the default wrappers and outside this story's required harness baseline.

## Proof Path Readiness

The repository already has the wrapper scripts needed for the main proof categories this story will use. Those existing wrappers are:

- `npm run build:summary:server`
- `npm run build:summary:client`
- `npm run compose:build:summary`
- `npm run test:summary:server:unit`
- `npm run test:summary:server:cucumber`
- `npm run test:summary:client`
- `npm run test:summary:e2e`

Those wrappers make the proof path realistic for this story, but only after the Copilot-specific prerequisites below have been implemented. Without these prerequisites, the wrappers themselves may run, but they will not be capable of proving the Copilot behavior this story promises.

The current repository also already fixes the discovery locations those wrappers use, so any new proof file in this story must land in the correct location or the wrapper will never execute it:

- `npm run test:summary:server:unit` only discovers `server/src/test/unit/*.test.ts`, `server/src/test/integration/*.test.ts`, and `server/src/test/mcp2/**/*.test.ts`.
- `npm run test:summary:server:cucumber` only discovers `server/src/test/features/**/*.feature` plus `server/src/test/steps/**/*.ts`.
- `npm run test:summary:client` only discovers `client/src/test/**/*.test.(ts|tsx)`.
- `npm run test:summary:e2e` only discovers Playwright specs under `e2e/`.

### Prerequisites Before Each Proof Stage

- `Before server and client build proof`: add the Copilot provider enums, shared contracts, shared auth contract, and the `@github/copilot-sdk` dependency so the server and client builds can compile the new Copilot code paths successfully.
- `Before early main-stack startup proof`: make the Copilot home helper and readiness paths tolerate the pre-Task-14 env state by resolving a deterministic default home instead of treating missing `CODEINFO_COPILOT_HOME` as fatal. Otherwise the repeated `npm run compose:up` regression checks in earlier tasks would stop being meaningful before Docker and env wiring have been implemented.
- `Before server unit and integration proof`: add the Copilot runtime seam, Copilot provider registration, Copilot route branches, and the fake Copilot SDK or auth harnesses described in `## Test Harnesses`. The server test wrappers already exist, but Copilot-specific scenarios will not be runnable until those seams exist.
- `Before Cucumber proof`: extend the existing feature and step definitions to use the fake Copilot seam. The Cucumber wrapper already exists, but it cannot currently exercise Copilot paths because the feature files and support code are still Codex and LM Studio oriented.
- `Before compose build proof`: add Copilot runtime delivery to the server image, including the SDK package, the Copilot CLI delivery strategy, writable `/app/copilot` support, `.dockerignore` updates, and the `compose:build:summary` runtime-asset marker update so the wrapper can actually prove that Copilot delivery was baked into the image instead of only reporting the pre-Copilot asset set.
- `Before e2e proof`: add `CODEINFO_COPILOT_HOME` to startup env loading, env files, compose files, and the app runtime; then wire the named Copilot scenario selector through `.env.e2e`, `docker-compose.e2e.yml`, and the `npm run test:summary:e2e` wrapper-backed stack so the existing e2e mock mode can drive a fake available Copilot provider plus fake Copilot chat and auth states. The current Playwright wrapper is already usable, but it depends on deterministic mock-backed behavior to prove Copilot without a real login.
- `Before any real-runtime smoke check`: if a live Copilot smoke check is ever used, it must come after the default wrapper-backed proof path, and it must be treated as optional or manual-only. The default proof path for this story remains mock-backed and wrapper-driven.

### Realistic Proof Order

- `Contract-first proof`: run `npm run build:summary:server` and `npm run build:summary:client` after the shared provider enums, auth contract, OpenAPI updates, and client or server type consumers have been updated.
- `Harness-backed server proof`: run `npm run test:summary:server:unit` once the fake Copilot SDK and auth harnesses exist and the server routes, persistence, and provider logic can exercise Copilot deterministically.
- `Behavioral BDD proof`: run `npm run test:summary:server:cucumber` after the Copilot feature scenarios and step definitions are wired to the same deterministic harnesses.
- `Client proof`: run `npm run test:summary:client` after the shared auth dialog, provider bootstrap flow, and transcript rendering changes can be driven through the updated shared contract fixtures.
- `Container proof`: run `npm run compose:build:summary` after Copilot CLI delivery, writable Copilot home handling, and compose env wiring have been added to the images and compose files.
- `End-to-end proof`: run `npm run test:summary:e2e` only after the fake Copilot seam is available through the e2e stack so the wrapper can prove provider selection, auth refresh, and streaming transcript behavior without depending on a real Copilot account. This wrapper already performs the compose-e2e build, up, test, and down sequence internally, so the story should treat that e2e wrapper path as the real end-to-end proof surface rather than pretending the main `compose:up` stack is enough.

### Proof Constraints To Keep In The Story

- The story must not claim that a Copilot proof step is runnable only because a generic wrapper exists. Copilot-specific proof becomes valid only when the required Copilot seams, env wiring, and test fixtures have been added first.
- The story must not rely on ad hoc raw commands for its primary proof path. The existing summary wrappers are already present in the repository and should remain the default proof route once the Copilot-specific prerequisites are in place.
- The story must not require a real authenticated Copilot account for the default proof path. If the proof path needs live credentials to pass, then the plan is still missing prerequisite mock or harness work and is not yet realistic.

## Feasibility Proof

This story stays within the current repository. No additional repository is involved, so every prerequisite check below is scoped to `Current Repository` only. The purpose of this feasibility proof is to walk the task list in order and confirm, for each task, which capabilities already exist in this repository, which capabilities must first be created by earlier tasks or as explicit prerequisite work, and which assumptions are currently invalid if a developer tried to skip ahead.

### Task 1. Expand the shared three-provider chat contracts and ordered defaults

- `Already existing capabilities`: `common/src/api.ts`, `common/src/lmstudio.ts`, `server/src/config/chatDefaults.ts`, `server/src/routes/chatValidators.ts`, `server/src/routes/conversations.ts`, `server/src/mongo/conversation.ts`, and `openapi.json` already provide the contract surfaces this task needs to extend.
- `Missing prerequisite capabilities`: none before Task 1 inside this story. This is the first explicit prerequisite task because every later server and client task depends on `copilot` being a legal provider across those shared surfaces.
- `Assumptions that are currently invalid`: it is currently invalid to assume the repository already has a provider-neutral contract layer. The live code still hard-codes `codex` and `lmstudio` in multiple validators, enums, and fallback paths.

### Task 2. Add the reusable Copilot runtime seam

- `Already existing capabilities`: `server/src/chat/interfaces/ChatInterface.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, `server/src/chat/factory.ts`, and `server/src/config/codexConfig.ts` already provide the abstraction pattern and config-helper pattern this task should mirror.
- `Missing prerequisite capabilities`: the repository does not yet have any Copilot lifecycle module, Copilot home helper, or injectable Copilot adapter. Task 2 must create those before provider readiness, auth, or chat execution can reuse them.
- `Missing prerequisite capabilities`: the repository also does not yet expose a documented Copilot auth-status seam. Task 2 must include `getAuthStatus()` alongside the basic lifecycle methods because Tasks 5 and 7 need one real auth-state source instead of guessing from route failures.
- `Assumptions that are currently invalid`: it is currently invalid to assume Copilot can be added as a small route-only branch or by squeezing it into the LM Studio path. The planned provider is session-based and needs its own lifecycle seam.

### Task 3. Add the server fake Copilot SDK harness

- `Already existing capabilities`: `server/src/test/support/mockLmStudioSdk.ts`, `server/src/test/support/wsClient.ts`, `server/src/test/unit/chat-factory.test.ts`, and `server/src/test/unit/chat-stream-bridge.test.ts` already show the repository’s test-support style for provider fakes and stream assertions.
- `Missing prerequisite capabilities`: Task 2 must complete first so the fake can plug into the real Copilot seam instead of inventing a separate test-only shape.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing LM Studio fake can cover Copilot behavior unchanged. There is no Copilot-specific fake client or fake session support in the repository today.

### Task 4. Add the server fake Copilot device-auth harness

- `Already existing capabilities`: `server/src/routes/codexDeviceAuth.ts`, `server/src/utils/codexDeviceAuth.ts`, `server/src/utils/singleFlight.ts`, `server/src/agents/authSeed.ts`, `server/src/test/unit/codexDeviceAuth.test.ts`, and `server/src/test/integration/codex.device-auth.test.ts` already show the current auth-flow shape that the harness should mirror.
- `Missing prerequisite capabilities`: none before Task 4 inside the auth area, but this harness must exist before Task 9 can prove Copilot auth deterministically and before Tasks 16, 17, and 18 can reuse auth scenarios in higher-level tests.
- `Assumptions that are currently invalid`: it is currently invalid to assume the current Codex auth tests can simply be copied inline into each Copilot route test. The story now requires a reusable two-phase auth harness rather than scattered raw fixtures.

### Task 5. Expose Copilot readiness on the server

- `Already existing capabilities`: `server/src/routes/chatProviders.ts` and `server/src/config/chatDefaults.ts` already expose provider ordering and readiness behavior for the existing providers.
- `Missing prerequisite capabilities`: Task 1 must complete first so `copilot` is a legal provider everywhere, Task 2 must complete first so the route has a real Copilot seam to call, and Task 3 must complete first so readiness coverage can run without a live Copilot account.
- `Assumptions that are currently invalid`: it is currently invalid to assume the current provider route can absorb a third provider naturally. Today it still builds a binary ordered list and does not yet respect documented Copilot auth precedence.

### Task 6. Expose Copilot model listing on the server

- `Already existing capabilities`: `server/src/routes/chatModels.ts` already exposes model-list behavior for the existing providers and is separate from provider discovery in the current codebase.
- `Missing prerequisite capabilities`: Tasks 1, 2, and 3 must complete first, and Task 5 should settle readiness semantics first so `/chat/models` does not invent a conflicting availability contract.
- `Assumptions that are currently invalid`: it is currently invalid to assume model mapping is already generic. The current route only understands Codex and LM Studio shapes.

### Task 7. Add Copilot chat execution, streaming, and conversation persistence

- `Already existing capabilities`: `server/src/routes/chat.ts`, `server/src/chat/factory.ts`, `server/src/chat/chatStreamBridge.ts`, `server/src/chat/inflightRegistry.ts`, `server/src/ws/server.ts`, `server/src/chat/memoryPersistence.ts`, `server/src/mongo/conversation.ts`, `server/src/mongo/repo.ts`, and `server/src/mongo/turn.ts` already provide the execution, streaming, locking, and persistence paths this task should extend.
- `Missing prerequisite capabilities`: Tasks 1, 2, and 3 must complete first, and Tasks 5 and 6 should settle readiness and model-route behavior before chat execution is exposed publicly.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing binary `codex` versus `lmstudio` branches in `server/src/routes/chat.ts` are already provider-neutral, or that a failed Copilot resume can safely fall back to a fresh session.

### Task 8. Generalize the shared provider-auth contract

- `Already existing capabilities`: `common/src/api.ts`, `server/src/routes/codexDeviceAuth.ts`, `server/src/utils/codexDeviceAuth.ts`, `client/src/api/codex.ts`, and the existing Codex auth tests already provide the shared contract surface and route pattern that this task should extend.
- `Missing prerequisite capabilities`: Task 2 must complete first so auth storage and status can use the shared Copilot home helper rather than scattered env reads.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing auth flow is already shared. The contract, route output, and client API are all Codex-specific today.

### Task 9. Add the Copilot device-auth backend

- `Already existing capabilities`: `server/src/routes/codexDeviceAuth.ts`, `server/src/utils/codexDeviceAuth.ts`, `server/src/index.ts`, and the existing auth tests already provide the provider-specific route and registration pattern that this task should mirror.
- `Missing prerequisite capabilities`: Task 4 must complete first for reusable Copilot auth fakes, and Task 8 must complete first so the new route lands on the settled shared contract.
- `Assumptions that are currently invalid`: it is currently invalid to assume the new Copilot route is already mounted or that device auth is the only valid authentication path. Copilot CLI also supports documented env-token and `gh` fallback authentication that the server must respect.

### Task 10. Extend the existing client provider-auth test fixtures

- `Already existing capabilities`: `client/src/test/setupTests.ts`, `client/src/test/support/fetchMock.ts`, `client/src/test/support/mockWebSocket.ts`, `client/src/test/support/userEvent.ts`, `client/src/test/codexDeviceAuthApi.test.ts`, and `client/src/test/codexDeviceAuthDialog.test.tsx` already provide the client test bootstrap and fixture style this task should follow.
- `Missing prerequisite capabilities`: Task 8 must complete first so these fixtures can target the real shared provider-auth contract rather than guessing a response shape.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing Codex-only auth fixtures are already generic. However, it is also unnecessary to add a second client harness layer when the existing fetch-based fixtures can be extended cleanly.

### Task 11. Update client provider and model selection for the three-provider contract

- `Already existing capabilities`: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `client/src/components/chat/CodexFlagsPanel.tsx`, and the current chat page provider tests already provide the hook, page, and regression surfaces this task should extend.
- `Missing prerequisite capabilities`: Task 1 must complete first so the client can compile against the three-provider contract, Tasks 5 and 6 must complete first so the backend readiness and model routes are stable, and Task 8 must complete first so provider-refresh behavior can consume the shared auth contract instead of stale Codex-only assumptions.
- `Assumptions that are currently invalid`: it is currently invalid to assume `useChatModel` and `ChatPage` are already three-provider neutral. The current fallback behavior can still collapse to LM Studio and hide a third provider if this task is not done deliberately.

### Task 12. Replace the Codex-only auth dialog with the shared Choose Authentication flow

- `Already existing capabilities`: `client/src/components/codex/CodexDeviceAuthDialog.tsx`, `client/src/components/agents/AgentsComposerPanel.tsx`, `client/src/pages/ChatPage.tsx`, and the current dialog or agents-page tests already provide the component and consumer surfaces this task should update.
- `Missing prerequisite capabilities`: Task 9 must complete first so the UI has a mounted Copilot route to call, and Task 10 must complete first so the dialog tests can reuse the shared provider-auth fixtures.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing auth dialog is already shared or only consumed by the chat page. The current dialog and client API are Codex-specific, and the agents flow also depends on that UI.

### Task 13. Harden transcript metadata rendering for partial Copilot usage and timing fields

- `Already existing capabilities`: `client/src/components/chat/chatTranscriptFormatting.ts`, `client/src/test/chatPage.stream.test.tsx`, `client/src/test/chatPage.reasoning.test.tsx`, and `client/src/test/transcriptTestHarness.test.ts` already provide the formatter and regression-test surfaces this task should update.
- `Missing prerequisite capabilities`: Task 7 must complete first so the server has a real Copilot event-to-transcript mapping and the formatter can be hardened against the actual partial metadata shape the story emits.
- `Assumptions that are currently invalid`: it is currently invalid to assume the current formatter already handles partial metadata safely. The current code still falls back some missing usage values to placeholder zeros.

### Task 14. Wire Copilot runtime environment injection

- `Already existing capabilities`: `server/src/config/startupEnv.ts`, `server/src/config/codexConfig.ts`, the env files, and runtime-config tests already provide the env-loading patterns this task should extend.
- `Missing prerequisite capabilities`: Task 2 must complete first so this wiring can point at one shared Copilot home helper instead of inventing another env-resolution path.
- `Assumptions that are currently invalid`: it is currently invalid to assume the runtime already provides `CODEINFO_COPILOT_HOME` or preserves documented Copilot credential precedence.

### Task 15. Wire Copilot Docker delivery and persistence

- `Already existing capabilities`: `server/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `.dockerignore`, and compose contract tests already provide the container-delivery patterns this task should extend.
- `Missing prerequisite capabilities`: Task 2 must complete first for the shared home helper, and Task 14 should settle the runtime env contract before Docker and compose persistence are wired around it.
- `Assumptions that are currently invalid`: it is currently invalid to assume the container image already includes Copilot runtime support, writable Copilot state, or build-context exclusions for Copilot runtime artifacts.

### Task 16. Extend existing integration, Cucumber, and e2e boot paths for fake Copilot scenarios

- `Already existing capabilities`: `server/src/test/integration`, `server/src/test/steps`, `server/src/test/support/wsClient.ts`, `e2e/support/mockChatWs.ts`, `client/src/test/support/mockChatWs.ts`, and `client/src/test/support/mockWebSocket.ts` already provide the higher-level bootstrap and transport-helper patterns this task should reuse.
- `Missing prerequisite capabilities`: Task 3 must complete first for fake Copilot SDK behavior, Task 4 must complete first for fake Copilot auth behavior, and Task 15 must define the final env and container contract before the wrapper-backed e2e path is treated as complete.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing integration and e2e stack already has a switch for fake Copilot readiness, models, chat, and auth. The simpler plan is to extend the current boot paths with named scenarios rather than creating a second cross-layer fixture abstraction.

### Task 17. Extend Cucumber coverage to prove the Copilot story through fake Copilot scenarios

- `Already existing capabilities`: `server/src/test/features/chat_models.feature`, `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_models.steps.ts`, and `server/src/test/steps/chat_stream.steps.ts` already provide the server-side BDD proof surfaces this task should extend.
- `Missing prerequisite capabilities`: Tasks 5, 6, 7, 9, 15, and 16 must complete first so the routes, auth backend, Docker-backed startup path, and extended higher-level boot path are all real and deterministic.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing Cucumber suites can prove Copilot today or that they should depend on a live authenticated Copilot account.

### Task 18. Extend Playwright coverage to prove the Copilot story through fake Copilot scenarios

- `Already existing capabilities`: `e2e/chat-provider-history.spec.ts`, `e2e/chat.spec.ts`, `e2e/chat-user-turn-ws.spec.ts`, and `e2e/env-runtime-config.spec.ts` already provide the client-facing end-to-end proof surfaces this task should extend.
- `Missing prerequisite capabilities`: Tasks 5, 6, 7, 9, 11, 12, 15, and 16 must complete first so the routes, client behavior, auth dialog, Docker-backed startup path, and extended higher-level boot path are all real and deterministic.
- `Assumptions that are currently invalid`: it is currently invalid to assume the existing Playwright suite can prove Copilot today or that a live authenticated Copilot account should be part of the default proof path.

### Task 19. Repair the final manual-validation proof contract for Story 0000051

- `Already existing capabilities`: the repository already has two proven manual-proof surfaces, but they are different surfaces for different kinds of evidence: `npm run compose:up` exposes the real main stack on port `5001`, and the existing fake-scenario contract already exists on the wrapper-backed e2e stack through `docker-compose.e2e.yml`, `scripts/test-summary-e2e.mjs`, and `npm run compose:e2e:up` on port `6001`.
- `Missing prerequisite capabilities`: Tasks 16, 17, and 18 must complete first so the named fake Copilot scenario catalog, Cucumber coverage, and Playwright browser proofs are already stable before the final manual-proof contract is rewritten around them.
- `Assumptions that are currently invalid`: it is currently invalid to assume the main compose stack on port `5001` can honor `CODEINFO_FAKE_COPILOT_SCENARIO`, and it is invalid to treat an env-file tweak alone as proof that the production startup path can switch into the Task 16 through 18 fake Copilot lifecycle.

### Task 20. Run final validation and close out Story 0000051

- `Already existing capabilities`: the repository already has the required wrapper scripts, documentation files, the real-stack manual-check path on port `5001`, and the fake-scenario e2e manual-check path on port `6001` once Task 19 rewrites the final proof contract around those existing capabilities.
- `Missing prerequisite capabilities`: every earlier task in this story plus Task 19 are prerequisites because final validation is only meaningful once the contracts, runtime seam, auth flow, client changes, Docker wiring, higher-level tests, and repaired dual-stack manual-proof contract all exist.
- `Assumptions that are currently invalid`: it is currently invalid to treat the existence of wrappers alone as proof that the story is ready to close. Those wrappers only become meaningful for Copilot once the earlier tasks complete, and the final manual pass must not assume the main stack can impersonate the fake-scenario e2e stack.

### Feasibility conclusion

- `Already existing capabilities`: this repository already has enough architectural shape to support the story without adding another repository, another application, or a parallel test stack.
- `Missing prerequisite capabilities`: the story is still blocked on explicit work in Tasks 1 through 16 before the wrapper-backed proof in Tasks 17 through 20 is realistic.
- `Assumptions that are currently invalid`: the plan must continue to treat the following dependency chain as hard gates rather than soft suggestions: Task 1 before Tasks 5, 6, 7, and 11; Task 2 before Tasks 3, 5, 6, 8, 9, 14, and 15; Task 3 before Tasks 5, 6, 7, 16, 17, and 19; Task 4 before Tasks 9, 16, and 17; Task 8 before Tasks 9, 10, and 11; Task 9 before Tasks 12, 17, and 18; Task 10 before Task 12; Task 14 before Task 15; Task 16 before Task 19; Task 18 before Task 19; Task 19 before Task 20; and Task 15 before the wrapper-backed proof in Tasks 16 through 20.

## Questions

# Tasks

Junior developer execution rule for this story: no numbered subtask in this section is standalone by itself. When assigning a numbered subtask, always include that task’s `Standalone context for every subtask in this task`, that task’s `Documentation Locations`, and that task’s `Implementation starter pattern for every subtask in this task`, because this story is written for developers who may only read one task block in isolation.
Repository ownership rule for this story: the `Additional Repositories` section is `- No Additional Repositories`, so every task in this story belongs to `Current Repository`, and every numbered subtask, numbered testing step, and Task 20 close-out validation step also belongs to `Current Repository`. No numbered item in this story may be reassigned to another repository unless the story handoff and `Additional Repositories` section are updated first.

### Manual Acceptance Log Contract

Use the repository’s existing logging paths for every Story `0000051` acceptance log: `server/src/logger.ts` plus the `/logs` store for server-side messages, and `client/src/logging/logger.ts` or `client/src/hooks/useChatStream.ts` for client-side messages that should also mirror into the browser console. Every message below must be emitted as a stable, exact string, must stay secret-safe, and must be visible on the Logs page during final Playwright-MCP verification. Include enough structured context to prove the expected outcome without logging tokens, one-time codes, raw CLI output, or other secrets.

- Task 1 log line: `story.0000051.task01.provider_contract_applied`. Trigger: the shared provider contract is loaded or served. Expected outcome: the log context shows the ordered provider contract `codex>copilot>lmstudio`.
- Task 2 log line: `story.0000051.task02.runtime_seam_ready`. Trigger: the Copilot lifecycle seam initializes. Expected outcome: the context records whether the seam is using `path` or `cliPath`.
- Task 3 log line: `story.0000051.task03.fake_sdk_scenario_selected`. Trigger: the fake Copilot SDK harness is selected for a named scenario. Expected outcome: the context names the active fake SDK scenario.
- Task 4 log line: `story.0000051.task04.fake_auth_scenario_selected`. Trigger: the fake Copilot device-auth harness is selected. Expected outcome: the context names the active auth scenario.
- Task 5 log line: `story.0000051.task05.readiness_evaluated`. Trigger: Copilot readiness is evaluated for `/chat/providers`. Expected outcome: the context records the stable blocking stage or available state.
- Task 6 log line: `story.0000051.task06.models_mapped`. Trigger: Copilot model mapping completes for `/chat/models`. Expected outcome: the context records the mapped model count and whether unknown fields were ignored safely.
- Task 7 log line: `story.0000051.task07.chat_turn_completed`. Trigger: a Copilot chat turn finishes or fails explicitly. Expected outcome: the context records create-versus-resume and whether the turn completed, stopped, or failed clearly.
- Task 8 log line: `story.0000051.task08.auth_contract_normalized`. Trigger: the shared provider-auth contract is normalized. Expected outcome: the context records the normalized auth state name.
- Task 9 log line: `story.0000051.task09.device_auth_state_emitted`. Trigger: the Copilot auth route emits a shared auth state. Expected outcome: the context records `verification_ready`, `completion_pending`, `completed`, `already_authenticated`, `failed`, or `unavailable_before_start`.
- Task 10 log line: `story.0000051.task10.client_auth_fixture_applied`. Trigger: the extended client auth fixture layer serves a named provider-auth scenario. Expected outcome: the context records the named fixture key and provider.
- Task 11 log line: `story.0000051.task11.provider_selection_applied`. Trigger: the chat page applies provider or model selection. Expected outcome: the context records the chosen provider and whether the action was next-send only.
- Task 12 log line: `story.0000051.task12.choose_auth_dialog_rendered`. Trigger: the shared `Choose Authentication` dialog renders or changes state. Expected outcome: the context records the visible auth state and selected provider branch.
- Task 13 log line: `story.0000051.task13.partial_metadata_rendered`. Trigger: transcript metadata is rendered for a partial Copilot result. Expected outcome: the context records which metadata fields were omitted safely.
- Task 14 log line: `story.0000051.task14.runtime_config_loaded`. Trigger: runtime config for Copilot loads. Expected outcome: the context records resolved home handling and whether `cliPath` override is set or absent.
- Task 15 log line: `story.0000051.task15.container_contract_ready`. Trigger: the Copilot Docker contract is active. Expected outcome: the context records `/app/copilot`, the named-volume contract, and unchanged published ports.
- Task 16 log line: `story.0000051.task16.fake_scenario_booted`. Trigger: the shared fake Copilot boot path activates. Expected outcome: the context records the named Copilot scenario wired into integration and e2e startup.
- Task 17 log line: `story.0000051.task17.cucumber_scenarios_registered`. Trigger: the server-side Cucumber Copilot scenarios are registered through the shared scenario catalog. Expected outcome: the context records the feature or scenario names made available.
- Task 18 log line: `story.0000051.task18.playwright_scenarios_registered`. Trigger: the Playwright Copilot scenarios are registered through the shared scenario catalog. Expected outcome: the context records the e2e scenario names made available.
- Task 19 log line: `story.0000051.task19.manual_proof_contract_repaired`. Trigger: the final manual-proof contract is rewritten around the already-proven main-stack and fake-scenario e2e surfaces. Expected outcome: the context records which surface now owns real-stack unavailable/auth checks and which surface now owns fake happy-path manual proof.
- Task 20 log line: `story.0000051.task20.final_traceability_verified`. Trigger: final validation completes. Expected outcome: the context records that traceability, scope audit, and manual acceptance verification all passed.

### Task 1. Expand the shared three-provider chat contracts and ordered defaults

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `7a56b651`

#### Overview

Make `copilot` a valid top-level chat provider everywhere the current repository defines shared provider ids, request validation, persistence enums, ordered fallback, and OpenAPI enums. This task is intentionally contract-first so later backend and frontend tasks can build on one consistent three-provider surface instead of adding more two-provider exceptions. It must also establish one shared ordered provider definition so the server and client do not drift into separate hard-coded orderings.

#### Documentation Locations

- OpenAPI Specification 3.1.0: `https://spec.openapis.org/oas/v3.1.0` for the canonical enum, request-body, and response-schema rules that `openapi.json` must keep matching.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with provider-ordering or shared-contract diagrams.
- Zod documentation: `https://zod.dev/` for enum, literal, and schema-validation behavior when the shared provider contract adds `copilot`.
- TypeScript Handbook union and literal types: `https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types` for the exact typing rules used by the expanded shared provider unions.

#### Subtasks

Standalone context for every subtask in this task: update `common/src/api.ts`, `common/src/lmstudio.ts`, `common/src/index.ts`, `server/src/config/chatDefaults.ts`, `server/src/routes/chatValidators.ts`, `server/src/routes/conversations.ts`, `server/src/mongo/conversation.ts`, and `openapi.json` together so one ordered provider list `codex`, `copilot`, `lmstudio` drives defaults and validation everywhere. Do not add a Copilot-only parallel contract here; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Schema and Contracts Matrix](#schema-and-contracts-matrix).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the library or spec links in front of them without hunting elsewhere in the story.
Implementation starter pattern for every subtask in this task: mirror the repository’s existing provider-enum and validation patterns in `server/src/config/chatDefaults.ts`, `server/src/routes/chatValidators.ts`, and the current enum blocks in `openapi.json`; extend those same structures to three providers instead of inventing a second Copilot-only shape.

1. [x] Re-read this story’s `Acceptance Criteria`, `Message Contracts and Storage Shapes`, and `Feasibility Proof` sections and write down the exact shared provider ordering rule for this task: `codex`, then `copilot`, then `lmstudio`. Do not start editing until that rule is written into your own working notes because every file in this task must follow it.
2. [x] Update `common/src/api.ts` and `common/src/lmstudio.ts` so every shared chat provider union, request shape, response shape, conversation summary type, and provider or model contract that currently assumes only `codex` and `lmstudio` accepts `copilot` as well. Keep the auth contract out of scope for this task unless a shared provider enum must be reused there later. Add the secret-safe acceptance log line `story.0000051.task01.provider_contract_applied` through the repository logger path when this shared contract is loaded or served, with context proving the ordered provider contract is `codex>copilot>lmstudio`.
3. [x] Create or reuse one exported ordered provider definition in the shared contract layer, then update `server/src/config/chatDefaults.ts` to consume that same ordering for default-provider resolution and fallback selection. Do not leave separate hard-coded provider arrays in server and client code.
4. [x] Update `server/src/routes/chatValidators.ts`, `server/src/routes/conversations.ts`, and `server/src/mongo/conversation.ts` so `provider: "copilot"` is accepted consistently in request validation, REST validation, and Mongo storage enums. Preserve backward compatibility for existing `codex` and `lmstudio` records.
5. [x] Update `openapi.json` so every relevant request and response enum that currently lists only `codex` and `lmstudio` includes `copilot` in the same top-level provider role. Make sure the generated contract names and enum descriptions still match the implemented server behavior.
6. [x] Add a unit test in `server/src/test/unit/config.chatDefaults.test.ts`. Test type: unit. Description: assert the shared provider order is exactly `codex`, `copilot`, `lmstudio` and that default-provider fallback uses that order. Purpose: prove one ordered provider definition drives fallback behavior.
7. [x] Add a unit test in `server/src/test/unit/chatValidators.test.ts`. Test type: unit. Description: submit a chat request with `provider: "copilot"` and confirm request validation accepts it. Purpose: prove the route validator now recognizes Copilot as a legal provider.
8. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: assert the provider-list response uses the same ordered provider definition introduced in this task. Purpose: prove server provider surfaces consume the shared ordering instead of a second hard-coded list.
9. [x] Add a unit test in `server/src/test/unit/chat-unsupported-provider.test.ts`. Test type: unit. Description: send an actually unsupported chat provider name and confirm the route still rejects it. Purpose: preserve the negative contract while adding Copilot.
10. [x] Add a unit test in `server/src/test/unit/mcp-unsupported-provider.test.ts`. Test type: unit. Description: send an actually unsupported MCP provider name and confirm the route still rejects it. Purpose: keep non-chat provider validation strict after the shared enum change.
11. [x] Update `design.md`. Document name: `design.md`. Location: repository root. Description: explain the new three-provider ordering rule, name the contract surfaces that now share it, and add a Mermaid diagram if it helps show how the shared provider definition now feeds server and client behavior. Purpose: keep the architecture and contract narrative aligned with the shared provider change.
12. [x] Update `README.md` if it currently documents chat providers or defaults in a way that would now be false. Document name: `README.md`. Location: repository root. Description: correct any user-facing provider or default-provider wording touched by this task. Purpose: keep top-level usage documentation truthful.
13. [x] Update `projectStructure.md` only if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any file additions, removals, or renames introduced by this task. Purpose: keep the repository file map accurate.
14. [x] Update this plan file after implementation by marking the completed checkboxes for Task 1, recording the task’s implementation notes, and listing the task commit hashes once they exist.
15. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
16. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.
5. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Confirmed the canonical ordered provider contract for Task 1 is `codex`, then `copilot`, then `lmstudio`, and started Task 1 implementation against that shared ordering.
- Added the shared `codex>copilot>lmstudio` provider contract to common types, server defaults, validation, persistence enums, provider-list ordering, and OpenAPI so Task 1 no longer leaves binary provider assumptions behind.
- Added the Task 1 acceptance log marker on `/chat/providers` and kept Copilot visible there as an unavailable top-level provider while runtime readiness/model work remains in later tasks.
- Added Task 1 unit coverage for ordered fallback, Copilot request validation, provider-list ordering, and strict unsupported-provider rejection paths for both REST chat and MCP.
- Updated `design.md` and `README.md`; no `projectStructure.md` update was needed because Task 1 changed files in place without adding, removing, or renaming files.
- `npm run lint` required the mandated `npm run lint:fix` pass to clean import ordering, then one manual follow-up removed an unused local in `server/src/config/runtimeConfig.ts` before lint passed cleanly.
- `npm run format:check` required the mandated `npm run format` pass; Prettier normalized the Task 1 files and a few unrelated markdown/test files before the follow-up check passed.
- `npm run build:summary:server` initially failed on a narrow MCP helper type after the shared provider union widened; broadening that internal helper to `ChatDefaultProvider` fixed the server build and kept Task 1 scoped to contract groundwork rather than fake Copilot runtime support.
- `npm run build:summary:client` initially failed because `useChatModel` still had a legacy LM Studio fallback literal typed as plain `string`; narrowing that fallback id to the shared provider union restored client type safety and the wrapper passed cleanly.
- `npm run test:summary:server:unit` initially exposed one integration assertion that still depended on the old default-model assumption and one MCP validation assertion that expected a more specific error message than the shared responder returns; after relaxing the brittle model assertion and matching the actual MCP invalid-params contract, the full wrapper rerun passed with `1376/1376` tests.
- `npm run test:summary:server:cucumber` passed cleanly on the first full-wrapper run after the Task 1 contract changes, which confirmed the three-provider baseline did not regress the existing server BDD layer.
- `npm run test:summary:client` passed cleanly with `632/632` tests once the shared provider union changes and the LM Studio fallback typing fix were in place, so Task 1 closed with green server build, client build, server unit, server Cucumber, and client wrapper proof.

---

### Task 2. Add the reusable Copilot runtime seam

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `c30df23f`

#### Overview

Create the reusable server-side Copilot client seam that later route and chat tasks will depend on. This task is intentionally about the runtime boundary only; it should not yet add the fake harnesses, and it should not yet wire Copilot into the public routes. The seam must make CLI discovery explicit by supporting the repository's normal `PATH`-based runtime and one optional explicit `cliPath` override without introducing a separate external Copilot service contract.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked SDK surface used here, especially `CopilotClient`, `start()`, `stop()`, `ping()`, `getAuthStatus()`, `listModels()`, `createSession(...)`, and `resumeSession(...)`.
- DeepWiki GitHub Copilot SDK repository docs: `github/copilot-sdk` for the checked architecture pages covering connection management, sessions, lifecycle hooks, permissions, and persistence that explain how the runtime seam should be shaped.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with architecture diagrams.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for product-level runtime and authentication context that sits outside the Node SDK API reference.

#### Subtasks

Standalone context for every subtask in this task: work in `server/package.json`, the shared Copilot home helper next to `server/src/config/codexConfig.ts`, and the new Copilot lifecycle seam under `server/src/chat` or `server/src/providers`. The required seam is one injectable runtime boundary for `start()`, `stop()`, `ping()`, `getAuthStatus()`, `listModels()`, `createSession(...)`, and `resumeSession(...)`; do not add a global singleton. This task must also make the Copilot CLI launch rule explicit: use an optional configured `cliPath` when present, otherwise rely on normal in-process `PATH` discovery. Follow [Acceptance Criteria](#acceptance-criteria), [Repository Facts and Current Contracts](#repository-facts-and-current-contracts), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the SDK and architecture references in front of them without re-reading the whole story.
Implementation starter pattern for every subtask in this task: mirror the repository’s current config-helper style in `server/src/config/codexConfig.ts` and the existing chat interface boundaries in `server/src/chat/interfaces/ChatInterfaceCodex.ts` and `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`; add the Copilot seam in the same style, but keep it injectable rather than global.

1. [x] Add the Copilot SDK dependency to `server/package.json` and update the matching lockfile entries so the server workspace can compile against the official SDK types. Do not add a second package manager or ad hoc install script.
2. [x] Add or reuse a dedicated Copilot runtime-home helper module alongside `server/src/config/codexConfig.ts` so runtime code and auth code can resolve `CODEINFO_COPILOT_HOME`, the Copilot config directory, and any file-store paths through one shared implementation instead of scattered env lookups. Until Task 14 lands, this helper must also provide a deterministic non-fatal default so the earlier `npm run compose:up` startup checks remain runnable.
3. [x] Create a reusable Copilot lifecycle module under `server/src/chat` or `server/src/providers` that owns `start()`, `stop()`, `ping()`, `getAuthStatus()`, `listModels()`, `createSession(...)`, and `resumeSession(...)` through one injectable seam. Make it consume the shared Copilot home/config helper from the previous step, keep route code out of this module, and make sure session creation and resumption both have access to the resolved `configDir` value derived from `CODEINFO_COPILOT_HOME`.
4. [x] Make the Copilot CLI launch rule explicit inside that seam. If a configured CLI path is supplied, pass it through as the SDK `cliPath`; otherwise rely on normal process `PATH` discovery. Do not add a host, port, or external long-running Copilot service contract as a workaround. Emit the secret-safe acceptance log line `story.0000051.task02.runtime_seam_ready` when the seam initializes, with context showing whether the runtime is using `path` or `cliPath`.
5. [x] Add `server/src/chat/interfaces/ChatInterfaceCopilot.ts` with a minimal adapter shape that later tasks can extend for real chat execution. At the end of this task the adapter can still be incomplete, but the class or module should compile and expose the intended dependency boundary cleanly, including any session-level configuration the SDK requires on both create and resume.
6. [x] Make the new Copilot seam injectable in the server test environment without affecting production behavior. Reuse the repository’s existing test-support pattern instead of adding a one-off global mutable singleton.
7. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: construct the new lifecycle seam and confirm `start()` forwards correctly to the injected Copilot runtime. Purpose: prove startup wiring works through the seam instead of ad hoc route code.
8. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: call `stop()` after startup and confirm shutdown reaches the injected runtime cleanly. Purpose: prove the seam owns runtime teardown as well as startup.
9. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: inject a test runtime implementation and confirm the seam uses that dependency instead of a hidden singleton. Purpose: prove dependency injection works for later harness tasks.
10. [x] Add a unit test in `server/src/test/unit/copilotConfig.test.ts`. Test type: unit. Description: resolve `CODEINFO_COPILOT_HOME` and the derived config path through the new helper. Purpose: prove runtime-home path resolution is centralized and deterministic.
11. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: construct the seam with an explicit Copilot CLI path override and confirm the runtime client receives that `cliPath` instead of assuming `PATH` lookup. Purpose: prove the explicit configured-CLI branch exists for local development or controlled runtimes.
12. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: construct the seam without an explicit CLI path and confirm it leaves CLI discovery to the in-process `PATH` branch rather than requiring a second external service endpoint. Purpose: prove the default runtime path stays simple and in-process.
13. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: call `getAuthStatus()` through the seam and confirm the result is passed through unchanged. Purpose: prove later readiness and auth tasks can trust the shared runtime boundary.
14. [x] Add a unit test in `server/src/test/unit/copilotLifecycle.test.ts`. Test type: unit. Description: make the injected runtime throw during startup or status lookup and confirm the seam propagates a clear error. Purpose: prove error handling is explicit before higher-level route tasks depend on it.
15. [x] Update `design.md` if the new lifecycle seam or Copilot home/config helper changes the repository architecture in a way a future junior developer would not infer from code alone. Document name: `design.md`. Location: repository root. Description: describe the runtime seam, Copilot home helper, the explicit `cliPath` versus `PATH` launch rule, and any new lifecycle flow, and add Mermaid flowcharts or sequence diagrams if they help explain the runtime boundary. Purpose: keep architecture documentation in sync with the new server seam.
16. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: list the new lifecycle seam files, Copilot config helper, and any new test files added by this task after those files exist. Purpose: keep the repository file map accurate after file creation.
17. [x] Update this plan file after implementation by marking the completed checkboxes for Task 2, recording implementation notes, and listing the task commit hashes once they exist.
18. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
19. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Added `@github/copilot-sdk@0.2.0` to the server workspace and updated the npm lockfile so Task 2 can compile against the real SDK types instead of a guessed seam surface.
- Added `server/src/config/copilotConfig.ts` so Copilot home resolution, derived `configDir`, `COPILOT_HOME`, and future file-store paths now come from one deterministic helper with a non-fatal default `./copilot` until Task 14 wires the env files.
- Added `server/src/chat/copilotLifecycle.ts` as the injectable Copilot runtime seam around `CopilotClient`, including the required `path` versus `cliPath` branch and the Task 2 acceptance log marker `story.0000051.task02.runtime_seam_ready`.
- Added `server/src/chat/interfaces/ChatInterfaceCopilot.ts` as the minimal adapter boundary for later create/resume chat work, keeping real route wiring out of Task 2 while still codifying the required session config shape with `approveAll` and `configDir`.
- Added unit coverage in `server/src/test/unit/copilotLifecycle.test.ts` and `server/src/test/unit/copilotConfig.test.ts` for startup, shutdown, dependency injection, home/config resolution, `cliPath` override handling, default PATH discovery, auth-status passthrough, and explicit runtime errors.
- Updated `design.md` and `projectStructure.md` to document the new Copilot config helper, lifecycle seam, explicit `cliPath` versus `PATH` launch rule, and the exact files added by Task 2.
- `npm run lint` required the mandated `npm run lint:fix` pass for import ordering, then one manual follow-up consumed the placeholder `execute(...)` arguments in `ChatInterfaceCopilot` so the minimal adapter could stay intentionally incomplete without tripping the unused-vars rule.
- `npm run format:check` required the mandated `npm run format` pass; Prettier normalized the new Copilot seam files and a couple already-touched server files before the follow-up check passed cleanly.
- `npm run build:summary:server` initially failed on a factory type that tried to index the optional `CopilotLifecycle` constructor params too narrowly; switching that dependency surface to the exported `CopilotLifecycleOptions` type fixed the seam wiring and the wrapper passed cleanly.
- `npm run test:summary:server:unit` passed cleanly with `1385/1385` tests after the seam landed, which confirmed the new helper, lifecycle module, adapter boundary, and injection points did not regress the existing server unit and integration suite.

---

### Task 3. Add the server fake Copilot SDK harness

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `9a7e5afc`

#### Overview

Create the dedicated fake Copilot SDK harness for server tests so unit, integration, and BDD layers can script Copilot startup, model discovery, session resumption, streaming events, and deterministic failure cases without a real Copilot account. This task depends on Task 2 because the fake must plug into the real Copilot seam instead of creating a second test-only interface. This task is only about the harness and the proof that the harness itself can run and surface scripted errors.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked session, event, model-list, and error-shape behavior that the fake SDK harness has to mirror closely enough for repository tests.
- DeepWiki GitHub Copilot SDK repository docs: `github/copilot-sdk` for the checked repository architecture notes on sessions, events, permissions, and test-support patterns that help keep the fake aligned with real SDK behavior.
- Node.js test runner documentation: `https://nodejs.org/api/test.html` for the `node:test` patterns used by the dedicated harness proof tests in this repository.

#### Subtasks

Standalone context for every subtask in this task: add the fake under `server/src/test/support/mockCopilotSdk.ts` by mirroring `server/src/test/support/mockLmStudioSdk.ts`, and plug it into the injectable Copilot seam from Task 2. The goal is one scenario-driven fake in the repository’s existing mock style, not a second mocking framework; follow [Test Harnesses](#test-harnesses), [Proof Path Readiness](#proof-path-readiness), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the SDK event and test-runner references available while building the fake.
Implementation starter pattern for every subtask in this task: copy the scenario-driven fake style already used in `server/src/test/support/mockLmStudioSdk.ts`; the Copilot harness should look like the next sibling of that file rather than a brand new mocking framework.

1. [x] Add `server/src/test/support/mockCopilotSdk.ts` by mirroring the structure and ergonomics of `server/src/test/support/mockLmStudioSdk.ts`. The fake client and fake session model must be able to script `start()`, `stop()`, `ping()`, `listModels()`, `createSession(...)`, `resumeSession(...)`, streamed assistant events, tool events, and deterministic failures without introducing a brand new mocking style. When a named fake SDK scenario is selected, emit the secret-safe acceptance log line `story.0000051.task03.fake_sdk_scenario_selected` so final manual verification can confirm which fake SDK scenario was active.
2. [x] Define one clear scripting API for the harness so later tests can queue success and failure cases without mutating hidden globals. Document the helper names in comments where a junior developer would otherwise have to reverse-engineer them from call sites.
3. [x] Wire the harness into the server test bootstrap path created in Task 2 so unit, integration, and Cucumber tests can opt into the fake Copilot runtime without affecting production runtime wiring.
4. [x] Add a unit test in `server/src/test/unit/mockCopilotSdk.test.ts`. Test type: unit. Description: instantiate the fake Copilot SDK harness with no scenario overrides and confirm the fake client boots successfully. Purpose: prove the harness itself is executable before downstream tests depend on it.
5. [x] Add a unit test in `server/src/test/unit/mockCopilotSdk.test.ts`. Test type: unit. Description: script assistant or tool events and confirm the fake session emits them deterministically in the requested order. Purpose: prove later chat and stream tests can rely on the harness for repeatable event playback.
6. [x] Add a unit test in `server/src/test/unit/mockCopilotSdk.test.ts`. Test type: unit. Description: script a startup or session error and confirm the harness surfaces the error exactly once. Purpose: prove failure-path scenarios are deterministic and inspectable.
7. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: list the new fake Copilot SDK harness file and its proof test after both files are created. Purpose: keep the repository file map accurate after adding harness files.
8. [x] Update `design.md` only if the harness entry point needs one sentence of explanation for future maintainers. Document name: `design.md`. Location: repository root. Description: add a brief note about how the fake Copilot SDK harness plugs into the runtime seam if that relationship is not obvious from code. Purpose: prevent future test-maintainer confusion.
9. [x] Update this plan file after implementation by marking the completed checkboxes for Task 3, recording implementation notes, and listing the task commit hashes once they exist.
10. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
11. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Added `server/src/test/support/mockCopilotSdk.ts` as the scenario-driven fake Copilot runtime, including deterministic `start`, `stop`, `ping`, `listModels`, `createSession`, `resumeSession`, scripted session events, and the Task 3 acceptance marker `story.0000051.task03.fake_sdk_scenario_selected`.
- Added `createMockCopilotSdkHarness(...)` as the explicit scripting API so each test gets an isolated scenario instance instead of relying on hidden global runtime state.
- Wired the fake into the Task 2 seam by exposing `createLifecycle()` and `createClientFactory()` helpers that feed the existing injectable `CopilotLifecycle` without changing production runtime wiring.
- Added unit coverage in `server/src/test/unit/mockCopilotSdk.test.ts` for harness boot success, deterministic assistant and tool event ordering, and explicit startup/session failures.
- Updated `design.md` and `projectStructure.md` to document the fake harness entry point and the exact files added by Task 3.
- `npm run lint` passed cleanly on the first run after the harness landed, so the new fake support files did not need any lint-specific cleanup.
- `npm run format:check` required the mandated `npm run format` pass; Prettier normalized the two new harness files and the follow-up check then passed cleanly.
- `npm run build:summary:server` initially failed on Copilot SDK type mismatches in the new harness; narrowing the fake session event discriminants and driving the proof test through `session.sendAndWait(...)` fixed the build, and the wrapper then passed cleanly.
- `npm run test:summary:server:unit` passed cleanly with `1388/1388`, confirming the new fake SDK harness stays compatible with the full server unit and integration suite.
- Recorded the Task 3 implementation commit hash after the full proof passed and marked the task complete so downstream Copilot readiness work can depend on the shared fake harness.

---

### Task 4. Add the server fake Copilot device-auth harness

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `cd830996`

#### Overview

Create the dedicated fake Copilot device-auth harness for server tests so auth routes can prove verification-code parsing, completion polling, missing CLI behavior, and failure outcomes without depending on a real external login. This task must land before Task 9 so the Copilot auth route can be proved through a reusable fake instead of route-specific inline fixtures. This task is only about the auth harness and the proof that the harness itself can run and expose deterministic errors.

#### Documentation Locations

- GitHub OAuth device flow documentation: `https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow` for the checked verification URL, user code, and polling phases the fake device-auth harness must model.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for checked Copilot sign-in and product-auth context that explains why the harness needs already-authenticated, pending, and failure outcomes.
- Node.js test runner documentation: `https://nodejs.org/api/test.html` for the `node:test` patterns used by the dedicated harness proof tests in this repository.

#### Subtasks

Standalone context for every subtask in this task: add the fake auth support under `server/src/test/support/mockCopilotDeviceAuth.ts` and mirror the existing Codex device-auth flow in `server/src/routes/codexDeviceAuth.ts` and `server/src/utils/codexDeviceAuth.ts`. Keep the harness two-phase, deterministic, and reusable for missing CLI, verification-ready, pending, success, and failure outcomes; follow [Acceptance Criteria](#acceptance-criteria), [Test Harnesses](#test-harnesses), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the device-flow and auth-shape references available while wiring the fake.
Implementation starter pattern for every subtask in this task: mirror the two-phase auth behavior already present in `server/src/routes/codexDeviceAuth.ts` and `server/src/utils/codexDeviceAuth.ts`; the fake should expose the same early-verification then completion-aware shape, just with deterministic scripted outcomes.

1. [x] Add `server/src/test/support/mockCopilotDeviceAuth.ts` with reusable fixtures and helpers for verification URL parsing, one-time code parsing, completion-pending state, completion success, CLI-missing, expired code, and generic failure cases. When a named fake auth scenario is selected, emit the secret-safe acceptance log line `story.0000051.task04.fake_auth_scenario_selected` so final manual verification can confirm which auth scenario was active.
2. [x] Define one clear harness API that later tests can call to request each auth outcome deterministically. Keep raw fixture strings and parser helpers in the harness instead of scattering them across route tests, and mirror the existing Codex route’s single-flight plus completion-side-effect phases so later tests exercise the same shape the production auth flow already uses.
3. [x] Wire the harness into the server test bootstrap path so later auth route tests can choose the fake device-auth behavior explicitly without changing production code paths.
4. [x] Add a unit test in `server/src/test/unit/mockCopilotDeviceAuth.test.ts`. Test type: unit. Description: script a verification-ready device-auth response and confirm the harness returns the expected URL and one-time code. Purpose: prove the fake can drive the happy path for downstream route tests.
5. [x] Add a unit test in `server/src/test/unit/mockCopilotDeviceAuth.test.ts`. Test type: unit. Description: script a missing-CLI or explicit failure outcome and confirm the harness returns that failure deterministically. Purpose: prove error-path auth scenarios are reusable and stable.
6. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: list the new fake Copilot device-auth harness file and its proof test after both files are created. Purpose: keep the repository file map accurate after adding auth harness files.
7. [x] Update `design.md` only if the harness entry point or fake auth phases need brief architectural clarification. Document name: `design.md`. Location: repository root. Description: add a brief explanation of the fake auth phases only if later maintainers would not infer them from the code and tests. Purpose: keep auth-harness architecture understandable.
8. [x] Update this plan file after implementation by marking the completed checkboxes for Task 4, recording implementation notes, and listing the task commit hashes once they exist.
9. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
10. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Added `server/src/test/support/mockCopilotDeviceAuth.ts` with reusable verification-output fixtures, parsing helpers, named auth scenarios, and the Task 4 acceptance marker `story.0000051.task04.fake_auth_scenario_selected`.
- Defined one instance-scoped harness API through `createMockCopilotDeviceAuthHarness(...)` so later tests can request verification-ready, pending, completed, already-authenticated, CLI-missing, expired-code, and generic failure outcomes without mutating hidden globals.
- Wired the fake into the future auth-route bootstrap seam by exposing `createRouteBindings()`, which gives later route tests explicit `startDeviceAuth` and `readDeviceAuthState` callbacks without changing production code paths.
- Added a harness proof that verifies verification-ready output parsing, one-time code extraction, and deterministic pending-to-completed completion-state playback.
- Added a failure-path proof that exercises explicit CLI-missing and generic start-failure outcomes so later auth route tests can reuse stable negative scenarios.
- Updated `projectStructure.md` with the new fake device-auth harness ledger so the repository map now records the added support and proof files for Task 4.
- Added a short `design.md` note explaining that the fake auth harness mirrors the Codex-style two-phase contract and exposes injectable route bindings for the later Copilot auth backend task.
- `npm run lint` passed cleanly after the new harness, tests, and documentation notes landed, so the Task 4 auth support did not need any lint-specific cleanup.
- `npm run format:check` initially reported Prettier drift in the new auth harness and the previously landed fake SDK harness, so I ran `npm run format`; the follow-up `npm run format:check` then passed cleanly.
- `npm run build:summary:server` passed cleanly after the auth harness landed, which confirmed the new support file, proof tests, and doc updates all compile together in the server workspace.
- `npm run test:summary:server:unit` passed cleanly with `1390/1390`, which confirmed the fake device-auth harness and its proof tests integrate cleanly with the full server unit and integration suite.
- Recorded the Task 4 implementation commit hash after the wrapper proof passed and marked the task complete so the later Copilot auth backend work can depend on a checked-in fake auth seam.

---

### Task 5. Expose Copilot readiness on the server

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `c0303d10`

#### Overview

Wire the reusable Copilot seam into `GET /chat/providers` so Copilot appears in the provider list with deterministic availability reasons and stable ordered placement. This task depends on Tasks 1, 2, and 3 because it needs the three-provider contract, the runtime seam, and the fake Copilot SDK proof path in place first. This task stops at provider readiness and should not yet take on Copilot model mapping.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked readiness-related SDK calls such as `ping()` and `getAuthStatus()` that drive provider availability.
- DeepWiki GitHub Copilot SDK repository docs: `github/copilot-sdk` for the checked lifecycle and auth-status architecture notes that help define stable readiness precedence.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with provider-readiness diagrams.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for checked credential and authentication context so provider readiness does not misclassify valid env-token or `gh`-backed states.

#### Subtasks

Standalone context for every subtask in this task: update `server/src/routes/chatProviders.ts` and `server/src/config/chatDefaults.ts` so provider order is always `codex`, `copilot`, `lmstudio`, Copilot stays visible when unavailable, and the surfaced readiness `reason` is stable across provider listing, model loading, auth refresh, and chat execution. Follow [Acceptance Criteria](#acceptance-criteria), [Edge Cases and Failure Modes](#edge-cases-and-failure-modes), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the readiness and auth-status references visible during implementation.
Implementation starter pattern for every subtask in this task: keep the existing provider-entry payload shape already returned by `server/src/routes/chatProviders.ts`; add a Copilot branch and stable readiness precedence inside that route instead of creating a second provider-list structure.

1. [x] Update `server/src/routes/chatProviders.ts` so the provider payload includes Copilot in the ordered list `codex`, `copilot`, `lmstudio`, even when Copilot is unavailable. Keep `available`, `toolsAvailable`, warnings, and the surfaced `reason` distinct.
2. [x] Implement one explicit readiness precedence rule in the Copilot readiness path and document it in code comments if the ordering would otherwise be hard to follow. The surfaced `reason` must be stable across provider listing, auth refresh, and chat execution, and it must respect the documented Copilot CLI credential precedence so existing env-token or `gh`-fallback authentication is treated as authenticated rather than as unauthenticated. Reuse the repository logger or route-debug pattern to record the blocking readiness stage and the surfaced reason without logging raw CLI output, token-like values, or other secrets, and use the exact acceptance log line `story.0000051.task05.readiness_evaluated` so manual verification can confirm the stable readiness result.
3. [x] Keep the route behavior deterministic when Copilot is unavailable, authenticated via env-token or `gh` fallback, or unauthenticated. Unknown warning details should be ignored safely, not treated as fatal errors.
4. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: call the provider-list route and confirm Copilot is present in the ordered list `codex`, `copilot`, `lmstudio` even when unavailable. Purpose: prove the provider remains visible and ordered correctly.
5. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: simulate an unauthenticated Copilot runtime and confirm the route returns the expected blocking `reason` while keeping `available`, `toolsAvailable`, and warnings distinct. Purpose: prove readiness precedence for the main unavailable path.
6. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: set an existing Copilot credential env var such as `COPILOT_GITHUB_TOKEN` and confirm Copilot surfaces as authenticated without requiring device auth. Purpose: prove the authenticated-via-env happy path.
7. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: simulate stored login state or authenticated `gh` fallback and confirm the route still reports Copilot as authenticated. Purpose: prove non-env credential sources also satisfy the readiness contract.
8. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: simulate startup or connectivity failure before auth succeeds and confirm the first blocking startup reason is surfaced. Purpose: prove the readiness precedence order is explicit and deterministic.
9. [x] Add a unit test in `server/src/test/unit/chatProviders.test.ts`. Test type: unit. Description: simulate startup, auth, model, or tool-surface failure combinations and confirm the readiness path records the expected blocking stage and surfaced `reason` without emitting token-like values or raw CLI output. Purpose: prove readiness observability is deterministic and secret-safe.
10. [x] Update `design.md` if the provider readiness precedence would otherwise only exist in tests. Document name: `design.md`. Location: repository root. Description: record the final readiness precedence order, availability-reason contract, and the safe blocking-stage observability rule, and add a Mermaid diagram if it helps explain the readiness decision path. Purpose: keep architecture documentation aligned with provider readiness behavior.
11. [x] Update `README.md` only if it contains provider-list behavior that would now be inaccurate. Document name: `README.md`. Location: repository root. Description: correct any user-facing description of provider availability or provider ordering changed by this task. Purpose: keep top-level usage documentation truthful.
12. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any file additions, removals, or renames introduced by this task after those changes land. Purpose: keep the repository file map accurate.
13. [x] Update this plan file after implementation by marking the completed checkboxes for Task 5, recording implementation notes, and listing the task commit hashes once they exist.
14. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
15. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
3. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Task 1 (`7a56b651`) already completed the contract-baseline slice of this task by keeping Copilot visible in `server/src/routes/chatProviders.ts` with the ordered list `codex`, `copilot`, `lmstudio`, and by adding the matching ordered-provider route proof in `server/src/test/unit/chatProviders.test.ts`.
- The earlier contract-only baseline for this task has now been superseded by the runtime-backed readiness implementation, auth-source handling, secret-safe readiness logging, and the remaining readiness-path tests that landed in `c0303d10`.
- Added `server/src/providers/copilotReadiness.ts` so `/chat/providers` now uses one documented readiness-precedence resolver instead of a hardcoded Copilot placeholder branch.
- The readiness resolver now evaluates Copilot in the planned order of connectivity, authentication, model-list success, and tool-surface availability, and it emits `story.0000051.task05.readiness_evaluated` with only secret-safe blocking-stage context.
- Updated `server/src/routes/chatProviders.ts` to consume the shared readiness result, including env-token and `gh`-fallback auth handling, while keeping Copilot visible in the ordered provider list.
- Extended `server/src/test/unit/chatProviders.test.ts` to prove unauthenticated, env-token-authenticated, `gh`-fallback-authenticated, startup-failure, and model-vs-tools precedence paths through the real route response.
- Updated `design.md` with the final readiness precedence and auth-source rules so later model and auth tasks can share one documented Copilot availability contract.
- `README.md` did not need a Task 5 wording change because this task only refined server-side readiness semantics without changing any top-level user setup instructions yet.
- Updated `projectStructure.md` to record the new `server/src/providers/copilotReadiness.ts` helper and the files touched by the readiness route work.
- `npm run lint` initially failed on import-order warnings in the new readiness route and test imports, so I ran the required `npm run lint:fix`; the follow-up `npm run lint` then passed cleanly.
- `npm run format:check` initially reported Prettier drift in `server/src/providers/copilotReadiness.ts` and the expanded `chatProviders` test file, so I ran `npm run format`; the follow-up `npm run format:check` then passed cleanly.
- `npm run build:summary:server` initially failed on implicit `any` parameters in the new readiness-log assertions inside `chatProviders.test.ts`; adding explicit `unknown` types fixed the compile, and the rerun passed cleanly.
- `npm run test:summary:server:unit` initially surfaced three stale provider-route expectations that still asserted the old placeholder Copilot reason; after updating those assertions to the new auth-required readiness contract, the targeted `chatProviders` run passed and the full wrapper passed cleanly with `1395/1395`.
- `npm run test:summary:server:cucumber` passed cleanly with `71/71`, which confirmed the readiness changes did not regress the existing server-side BDD coverage.
- Recorded the Task 5 implementation commit hash after the wrapper proof passed and marked the task complete so the later Copilot model and auth work can reuse the shared readiness precedence contract.

---

### Task 6. Expose Copilot model listing on the server

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `35411115`

#### Overview

Wire the reusable Copilot seam into `GET /chat/models` so Copilot model metadata is returned through the existing shared response shape without inventing a second contract. This task depends on Tasks 1, 2, 3, and 5 because it needs the three-provider contract, the runtime seam, the fake Copilot SDK proof path, and the settled provider-readiness behavior in place first. This task should stop at model discovery and mapping; it should not yet execute chat turns.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked `listModels()` response shape and model metadata fields that can be mapped safely into the repository contract.
- DeepWiki GitHub Copilot SDK repository docs: `github/copilot-sdk` for the checked session and connection-management notes that explain where model discovery sits in the client lifecycle.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with model-discovery diagrams.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for product-level model and entitlement context that can affect why model lists are empty or unavailable.

#### Subtasks

Standalone context for every subtask in this task: update `server/src/routes/chatModels.ts` so `GET /chat/models?provider=copilot` reuses the existing shared model response shape and maps only SDK fields that are actually verified. Ignore unknown Copilot fields safely and do not invent placeholder metadata; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the verified SDK model-shape references in front of them.
Implementation starter pattern for every subtask in this task: extend the current branch structure already used in `server/src/routes/chatModels.ts` for Codex and LM Studio; Copilot should map into the same response object shape and should ignore unsupported fields rather than introducing a Copilot-only model payload.

1. [x] Update `server/src/routes/chatModels.ts` so `GET /chat/models?provider=copilot` calls the new Copilot seam and maps only verified Copilot model fields into the existing response shape. Do not synthesize token or timing metadata that the SDK does not actually expose. Emit the secret-safe acceptance log line `story.0000051.task06.models_mapped` with context showing how many Copilot models were mapped and whether unsupported fields were ignored.
2. [x] Keep the route behavior deterministic when Copilot returns no usable models or returns model fields the repository does not yet understand. Unknown fields should be ignored safely, not treated as fatal errors.
3. [x] Add a unit test in `server/src/test/unit/chatModels.copilot.test.ts`. Test type: unit. Description: simulate Copilot being unavailable before model discovery and confirm the route returns the expected unavailable-model behavior. Purpose: prove the model route stays aligned with provider readiness.
4. [x] Add a unit test in `server/src/test/unit/chatModels.copilot.test.ts`. Test type: unit. Description: return an empty model list from the fake Copilot seam and confirm the route handles it deterministically. Purpose: prove the empty-list corner case does not silently look like success.
5. [x] Add a unit test in `server/src/test/unit/chatModels.copilot.test.ts`. Test type: unit. Description: return verified model fields plus unknown extra fields and confirm only the supported fields are mapped into the shared response shape. Purpose: prove model mapping is strict without being brittle.
6. [x] Update `design.md` if the Copilot model-mapping contract would otherwise only exist in tests. Document name: `design.md`. Location: repository root. Description: describe the verified Copilot model-mapping rules and add a Mermaid diagram if it helps explain the model-discovery and mapping path. Purpose: keep architecture documentation aligned with model discovery behavior.
7. [x] Update `README.md` only if it contains model-list behavior that would now be inaccurate. Document name: `README.md`. Location: repository root. Description: correct any user-facing wording about model discovery or unavailable-model behavior touched by this task. Purpose: keep top-level usage documentation truthful.
8. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any file additions, removals, or renames introduced by this task after those changes land. Purpose: keep the repository file map accurate.
9. [x] Update this plan file after implementation by marking the completed checkboxes for Task 6, recording implementation notes, and listing the task commit hashes once they exist.
10. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
11. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
3. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Added the `provider=copilot` branch in `server/src/routes/chatModels.ts`, wired it through the Copilot runtime seam, and emitted `story.0000051.task06.models_mapped` with mapped-count plus ignored-field context.
- Added strict Copilot model mapping that only keeps verified shared-contract fields, drops unusable entries, and returns deterministic `copilot models unavailable` behavior instead of failing on unknown SDK fields.
- Added `server/src/test/unit/chatModels.copilot.test.ts` to cover readiness-driven unavailability, empty model discovery, and strict mapping with extra-field ignore behavior through the real route payload.
- Documented the Copilot model-mapping contract in `design.md`, corrected the top-level README note now that Copilot model discovery exists on the server, and logged the new unit test file in `projectStructure.md`.
- `npm run lint` passed cleanly against the new Copilot model-route branch, tests, and docs without needing any follow-up fixes.
- `npm run format:check` initially reported Prettier drift in the new route and Copilot model-route test, so I ran `npm run format`; the follow-up `npm run format:check` then passed cleanly.
- `npm run build:summary:server` initially failed because the new Copilot route test used a direct `LMStudioClient` cast on a tiny stub; switching that helper to the repository’s usual `unknown as LMStudioClient` pattern fixed the compile, and the rerun passed cleanly.
- `npm run test:summary:server:unit` passed cleanly with `1398/1398`, which proved the new Copilot model-route unit suite and the broader server unit/integration surface still line up.
- `npm run test:summary:server:cucumber` passed cleanly with `71/71`, and I removed the generated `server/copilot` runtime artifacts afterward so the task could finish with a clean working tree before commit.
- Recorded implementation commit `35411115` in the task ledger so later Story 51 tasks can trace the model-route baseline back to the exact change set that introduced it.

---

### Task 7. Add Copilot chat execution, streaming, and conversation persistence

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `d28ec542`

#### Overview

Implement the actual Copilot chat turn path on the server so `POST /chat` can create or resume a Copilot session, stream transcript events into the existing bridge, and persist the conversation deterministically. This task depends on Tasks 1, 2, and 3, and it should start only after Tasks 5 and 6 have settled the provider-readiness and model-route behavior the chat path will share. This task is intentionally backend-only because the frontend should not consume Copilot chat until the server contract and persistence behavior are working.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked session create/resume, permission callback, event-stream, and hook behavior used by the real Copilot chat adapter.
- DeepWiki GitHub Copilot SDK repository docs: `github/copilot-sdk` for the checked pages on sessions, permissions, event listeners, and persistence so the server adapter reuses the SDK lifecycle correctly.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with chat-flow diagrams.
- Context7 Mongoose docs: `/automattic/mongoose/9.0.1` for the checked `Schema.Types.Mixed`, optional-field, and persistence-shape behavior used when storing Copilot session-related flags without over-modeling the schema.

#### Subtasks

Standalone context for every subtask in this task: update `server/src/chat/factory.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/routes/chat.ts`, `server/src/chat/memoryPersistence.ts`, `server/src/mongo/conversation.ts`, and related repo helpers together. Reuse `conversationId` as the Copilot session id by default, keep Codex-only flags Codex-only, use the existing chat stream bridge and websocket flow, and fail clearly on resume mismatch instead of silently creating a new session; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Proof Path Readiness](#proof-path-readiness).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the session, event, persistence, and Mongoose references beside the code files.
Implementation starter pattern for every subtask in this task: mirror the existing server chat flow already split across `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/routes/chat.ts`, and the current stream-bridge and inflight-registry path; Copilot should plug into that same bridge instead of creating a second execution pipeline.

1. [x] Update `server/src/chat/factory.ts` so the chat factory can construct the Copilot chat adapter through the reusable seam added in Task 2. Keep the existing Codex and LM Studio branches unchanged except where the shared provider contract already required updates.
2. [x] Finish `server/src/chat/interfaces/ChatInterfaceCopilot.ts` so it can create and resume Copilot sessions, register the documented `onPermissionRequest` handler on both create and resume, re-register any required tools or hooks when resuming, and translate Copilot events into the existing `ChatInterface` event model. Route streamed output through the existing `chatStreamBridge` and websocket publishing path instead of inventing a second transport. Allow permissions by default for this story. Emit the secret-safe acceptance log line `story.0000051.task07.chat_turn_completed` whenever a Copilot turn reaches a clear terminal outcome, with context showing create-versus-resume plus `completed`, `stopped`, or `failed`.
3. [x] Update `server/src/routes/chat.ts` so `provider: "copilot"` is accepted, uses the shared runtime-selection contract, replaces the remaining binary `codex` versus `lmstudio` branches with provider-neutral logic, and reuses the existing inflight registry, conversation lock, and transcript transport flow without introducing a new websocket or HTTP transport.
4. [x] Keep Codex-only request flags server-side. When a Copilot request arrives with Codex-specific flags, ignore them safely or return the documented warning behavior for this repository, but do not reinterpret them as Copilot settings or let them silently change Copilot execution semantics.
5. [x] Reuse `conversationId` as the Copilot session id throughout the default implementation path. Update both Mongoose-backed persistence and `server/src/chat/memoryPersistence.ts` so that direct reuse is stored and resumed deterministically in normal runtime and in test-mode memory persistence. Only introduce `conversation.flags.copilotSessionId` if direct code evidence from the installed SDK proves a separate stored id is required, and do not add a new nested Mongoose sub-schema for `flags` unless that fallback path truly forces it.
6. [x] Make resume failure explicit. If an existing persisted Copilot conversation cannot resume its expected session, return a clear error for that conversation instead of silently creating a fresh Copilot session behind the same transcript.
7. [x] Add a unit test in `server/src/test/unit/chat-interface-copilot.test.ts`. Test type: unit. Description: create a new Copilot session through `ChatInterfaceCopilot` and confirm the adapter maps the first streamed events into the repository `ChatInterface` event model. Purpose: prove the create-session happy path is translated correctly.
8. [x] Add a unit test in `server/src/test/unit/chat-interface-copilot.test.ts`. Test type: unit. Description: resume an existing Copilot session and confirm resumed events are mapped into the same repository event model. Purpose: prove create and resume flows stay behaviorally aligned.
9. [x] Add a unit test in `server/src/test/unit/chat-interface-copilot.test.ts`. Test type: unit. Description: trigger `onPermissionRequest` during session creation and confirm the default handler returns an allow result. Purpose: prove the story’s allow-by-default permission rule is implemented on create.
10. [x] Add a unit test in `server/src/test/unit/chat-interface-copilot.test.ts`. Test type: unit. Description: trigger `onPermissionRequest` after session resume and confirm resumed tool or hook handlers are re-registered and still work. Purpose: prove the permission and tool path survives resume.
11. [x] Add a unit test in `server/src/test/unit/chat-interface-copilot.test.ts`. Test type: unit. Description: force tool or hook re-registration to fail after session resume and confirm the adapter returns a clear error instead of continuing with a half-resumed session. Purpose: prove resume-time dependency failures are explicit and recoverable.
12. [x] Add a unit test in `server/src/test/unit/chat-stream-bridge.test.ts`. Test type: unit. Description: send delta-only Copilot output and confirm the bridge finishes once without duplicate transcript text. Purpose: prove the first stream-edge case is handled deterministically.
13. [x] Add a unit test in `server/src/test/unit/chat-stream-bridge.test.ts`. Test type: unit. Description: send a final message without prior deltas and confirm the bridge still produces one final transcript update. Purpose: prove final-without-deltas output is supported.
14. [x] Add a unit test in `server/src/test/unit/chat-stream-bridge.test.ts`. Test type: unit. Description: emit repeated final-like events and confirm the bridge deduplicates them. Purpose: prove final-event replay does not duplicate transcript content.
15. [x] Add a unit test in `server/src/test/unit/chat-stream-bridge.test.ts`. Test type: unit. Description: emit a session error after partial output and confirm the bridge closes cleanly without leaving the conversation in a stuck streaming state. Purpose: prove partial-output error handling is deterministic.
16. [x] Add an integration test in `server/src/test/integration/chat-copilot.test.ts`. Test type: integration. Description: create a Copilot-backed conversation, persist it, send a follow-up turn, and confirm the same session identity is resumed. Purpose: prove session creation, persistence, and resumption work together.
17. [x] Add an integration test in `server/src/test/integration/chat-copilot-resume.test.ts`. Test type: integration. Description: force resume failure for an existing persisted Copilot conversation and confirm the route returns a clear error instead of silently creating a new session. Purpose: prove resume failure follows the story contract.
18. [x] Add an integration test in `server/src/test/integration/chat-copilot-lock.test.ts`. Test type: integration. Description: fire two turns at the same persisted Copilot conversation and confirm the existing conversation lock prevents concurrent mutation. Purpose: prove the concurrency corner case remains protected.
19. [x] Add an integration test in `server/src/test/integration/chat-copilot-fallback.test.ts`. Test type: integration. Description: request Copilot when the provider is unavailable and confirm the `/chat` route follows the shared fallback rule or returns the documented clear reason. Purpose: prove runtime fallback stays aligned with provider discovery.
20. [x] Add an integration test in `server/src/test/integration/chat-copilot-flags.test.ts`. Test type: integration. Description: send Codex-only flags on a Copilot request and confirm they are ignored with the documented warning behavior; if implementation adds any Copilot-only request field, also send it to non-Copilot providers and confirm it is ignored with warnings or rejected clearly. Purpose: prove cross-provider flag isolation in both directions.
21. [x] Add an integration test in `server/src/test/integration/chat-copilot-stop.test.ts`. Test type: integration. Description: start a Copilot-backed run, trigger the existing stop or cancel path, and confirm the inflight registry, websocket finalization, and conversation state all settle cleanly. Purpose: prove existing stop or cancel behavior still works when Copilot uses the shared chat transport.
22. [x] Update `design.md`. Document name: `design.md`. Location: repository root. Description: document the chosen Copilot session identity rule, Codex-only flag handling, event-to-transcript mapping, the clear failure path for resume-time re-registration errors, and the create or resume chat flow, and add Mermaid diagrams for the request, stream, resume, and stop paths when they clarify the flow. Purpose: keep architecture and flow documentation aligned with the implemented chat path.
23. [x] Update `README.md` only if user-facing chat behavior needs clarification. Document name: `README.md`. Location: repository root. Description: explain any user-visible Copilot chat behavior, errors, or warnings introduced by this task. Purpose: keep top-level usage documentation truthful.
24. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: list any new chat adapter, route test, or helper files added by this task after those files are created. Purpose: keep the repository file map accurate after file creation.
25. [x] Update this plan file after implementation by marking the completed checkboxes for Task 7, recording implementation notes, and listing the task commit hashes once they exist.
26. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
27. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Finished `server/src/chat/interfaces/ChatInterfaceCopilot.ts` as the real Copilot adapter, including create-versus-resume execution, allow-by-default permission handling, resume-time hook/tool re-registration, session-event mapping into shared chat events, and the Task 7 terminal log marker.
- Updated `server/src/routes/chat.ts` to treat Copilot as a first-class shared chat provider by reusing runtime selection, inflight ownership, the existing stream bridge, lock handling, and provider-neutral flag sanitization instead of a binary Codex-versus-LM Studio split.
- Kept the session identity rule simple: `conversationId` is reused directly as the Copilot session id, so neither Mongo persistence nor memory persistence needed a new Copilot-only stored session field.
- Made resume failure explicit by surfacing a clear adapter error when session resume or resume-time re-registration fails instead of silently creating a fresh Copilot session behind an existing transcript.
- Added `server/src/test/unit/chat-interface-copilot.test.ts` to prove create mapping, resume mapping, allow-by-default permissions, resume-time handler re-registration, and explicit resume-time hook failure behavior.
- Extended `server/src/test/unit/chat-stream-bridge.test.ts` with the Copilot stream edge cases for delta-only output, final-without-deltas, repeated final dedupe, and partial-output error finalization.
- Added Copilot integration proof in `server/src/test/integration/chat-copilot.test.ts`, `chat-copilot-resume.test.ts`, `chat-copilot-lock.test.ts`, `chat-copilot-fallback.test.ts`, `chat-copilot-flags.test.ts`, and `chat-copilot-stop.test.ts`, backed by the new `server/src/test/integration/support/copilotChatHarness.ts`.
- The first full server test run exposed two implementation wrinkles: the fake Copilot session needed to forward `config.onEvent` into scripted events, and the concurrent-lock tests needed an eagerly started first Supertest request instead of a lazily awaited one.
- Updated `design.md`, `README.md`, and `projectStructure.md` so the repo docs now describe the session-id rule, shared `/chat` transport reuse, Codex-only flag isolation, fallback behavior, and the new Task 7 proof files.
- `npm run lint` required the mandated `npm run lint:fix` pass for import ordering, then one manual cleanup removed an unused import from `chat-copilot.test.ts`; the follow-up lint run passed cleanly.
- `npm run format:check` required the mandated `npm run format` pass; Prettier normalized the Task 7 adapter, route, tests, harness, and plan updates before the follow-up check passed cleanly.
- `npm run build:summary:server` passed cleanly after the Task 7 adapter, route, tests, and docs were formatted and the fake runtime forwarded `onEvent` correctly.
- `npm run build:summary:client` passed cleanly, which confirmed the Task 7 server-side and documentation changes did not break the client workspace typecheck or build gate.
- The first `npm run test:summary:server:unit` run failed on four cases and gave the real diagnostics needed to finish Task 7: Copilot event forwarding in the fake session plus eager-start concurrency in the lock tests. After those fixes, the rerun passed cleanly with `1413/1413`.
- `npm run test:summary:server:cucumber` passed cleanly with `71/71`, which confirmed the Task 7 server changes did not regress the existing higher-level server behavior while Copilot still stays outside the story’s later Cucumber-specific tasks.

---

### Task 8. Generalize the shared provider-auth contract

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `98de20b6`

#### Overview

Replace the current Codex-only auth contract with one shared provider-auth contract and update the existing Codex path to use it without changing Codex behavior. This task depends on Task 2 for the shared Copilot home helper because the shared contract now has to represent auth-state outcomes consistently across providers. This task is intentionally contract-first so the Copilot backend and client tasks can build on one settled shape instead of chasing a moving auth response.

#### Documentation Locations

- OpenAPI Specification 3.1.0: `https://spec.openapis.org/oas/v3.1.0` for the shared provider-auth request and response schema rules that must stay in sync with `openapi.json`.
- GitHub OAuth device flow documentation: `https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow` for the checked two-phase verification and polling model the shared auth contract has to represent.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with shared auth-flow diagrams.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for checked Copilot auth context so the shared contract can cover Copilot and Codex without baking in Codex-only wording.

#### Subtasks

Standalone context for every subtask in this task: update `common/src/api.ts`, `server/src/routes/codexDeviceAuth.ts`, `server/src/utils/codexDeviceAuth.ts`, `client/src/api/codex.ts`, `server/src/test/unit/openapi.contract.test.ts`, `server/src/test/integration/chat-codex.test.ts`, and `server/src/test/integration/agents-run-client-conversation-id.test.ts` together so Codex and Copilot share one provider-auth contract. The contract must stay two-phase, return verification details early, preserve the current empty `{}` request contract and single-flight Codex route behavior, and preserve existing Codex unlock behavior for chat, agents, flow, and MCP while removing the Codex-only raw-output shape; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Schema and Contracts Matrix](#schema-and-contracts-matrix).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the auth-contract and device-flow references beside the existing Codex code.
Implementation starter pattern for every subtask in this task: start from the current Codex-only shared contract and callers in `common/src/api.ts`, `server/src/routes/codexDeviceAuth.ts`, `server/src/utils/codexDeviceAuth.ts`, and `client/src/api/codex.ts`; generalize those exact shapes into one provider-auth contract instead of layering a parallel Copilot-only response family on top.

1. [x] Update `common/src/api.ts` so the shared auth contract can represent provider id, verification URL, one-time code, early verification-ready state, completion-pending state, completed state, already-authenticated state, failed state, and unavailable-before-start state. Keep the contract generic enough for Codex and Copilot without exposing BYOK provider details. Add the secret-safe acceptance log line `story.0000051.task08.auth_contract_normalized` anywhere the shared contract is normalized for runtime use, with context naming the normalized auth state.
2. [x] Refactor the existing Codex auth route and utilities so they use the new shared provider-auth contract without changing Codex behavior. Preserve the current empty `{}` request shape, single-flight auth start behavior, and the ability to return verification details early while completion continues separately.
3. [x] Update `openapi.json` for the shared provider-auth contract and any Codex route schema changes that now reference it.
4. [x] Add a unit test in `server/src/test/unit/codexDeviceAuth.test.ts`. Test type: unit. Description: start the shared Codex auth flow and confirm the contract exposes verification-ready state with URL and code. Purpose: prove early verification details survive the contract refactor.
5. [x] Add an integration test in `server/src/test/integration/codex.device-auth.test.ts`. Test type: integration. Description: keep the Codex auth flow pending and confirm the shared contract exposes completion-pending state. Purpose: prove the two-phase contract still represents incomplete auth deterministically.
6. [x] Add an integration test in `server/src/test/integration/codex.device-auth.test.ts`. Test type: integration. Description: complete the Codex auth flow and confirm the shared contract reports completed state. Purpose: prove the happy path still works after the contract generalization.
7. [x] Add a unit test in `server/src/test/unit/codexDeviceAuth.test.ts`. Test type: unit. Description: simulate an already-authenticated Codex runtime and confirm the shared contract returns already-authenticated state. Purpose: prove that state is part of the shared contract, not a Copilot-only branch.
8. [x] Add a unit test in `server/src/test/unit/codexDeviceAuth.test.ts`. Test type: unit. Description: force an auth failure and confirm the shared contract reports failed state. Purpose: prove failure remains observable through the shared contract.
9. [x] Add a unit test in `server/src/test/unit/codexDeviceAuth.test.ts`. Test type: unit. Description: simulate unavailable-before-start conditions and confirm the shared contract reports that state clearly. Purpose: prove the contract distinguishes pre-start unavailability from an in-flight failure.
10. [x] Add a unit test in `server/src/test/unit/openapi.contract.test.ts`. Test type: unit. Description: assert the updated `/codex/device-auth` schema still enforces an empty JSON request body and now exposes the shared provider-auth response shape instead of the old raw-output-only contract. Purpose: prove the public Codex route contract stayed deterministic while it was generalized.
11. [x] Add an integration test in `server/src/test/integration/chat-codex.test.ts`. Test type: integration. Description: complete one successful shared-contract Codex auth flow and confirm a follow-up chat run still unlocks without extra target selection. Purpose: prove the contract refactor did not break the existing chat unlock behavior.
12. [x] Add an integration test in `server/src/test/integration/agents-run-client-conversation-id.test.ts`. Test type: integration. Description: complete one successful shared-contract Codex auth flow and confirm agent, flow, and MCP runs still reuse that auth state as they do today. Purpose: prove downstream shared-auth reuse still works after the contract change.
13. [x] Update `design.md` if it currently describes only the Codex-specific auth shape or omits the shared provider-auth flow. Document name: `design.md`. Location: repository root. Description: describe the shared provider-auth state machine and add Mermaid auth-flow diagrams if they help show the two-phase contract. Purpose: keep architecture and auth-flow documentation aligned with the generalized contract.
14. [x] Update `README.md` if it currently describes only the Codex-specific auth shape or wording. Document name: `README.md`. Location: repository root. Description: correct any top-level auth wording that should now describe the shared provider-auth behavior. Purpose: keep user-facing documentation truthful.
15. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any file additions, removals, or renames introduced by this contract task after those changes land. Purpose: keep the repository file map accurate.
16. [x] Update this plan file after implementation by marking the completed checkboxes for Task 8, recording implementation notes, and listing the task commit hashes once they exist.
17. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
18. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Normalized `common/src/api.ts` onto one shared provider-auth state machine for Codex and Copilot, and the runtime normalization path now emits `story.0000051.task08.auth_contract_normalized` with the normalized state name.
- Refactored `server/src/utils/codexDeviceAuth.ts` and `server/src/routes/codexDeviceAuth.ts` to keep the strict `{}` request body and shared-home single-flight flow while returning `verification_ready`, `completion_pending`, `completed`, `already_authenticated`, `failed`, and `unavailable_before_start` instead of the old raw-output-only success payload.
- Updated `openapi.json` and `server/src/test/unit/openapi.contract.test.ts` together so the published `/codex/device-auth` contract now documents the shared auth-state union rather than a `status/rawOutput` shape.
- Expanded Codex auth proof in `server/src/test/unit/codexDeviceAuth.test.ts` and `server/src/test/integration/codex.device-auth.test.ts` to cover verification-ready, completion-pending, completed, already-authenticated, failed, and unavailable-before-start branches.
- Updated the existing downstream shared-auth regression tests in `server/src/test/integration/chat-codex.test.ts` and `server/src/test/integration/agents-run-client-conversation-id.test.ts` so the contract refactor still proves chat, agent, flow, and MCP unlock reuse.
- Updated `client/src/api/codex.ts` plus the Codex dialog tests to consume the shared provider-auth response shape without waiting for the later shared `Choose Authentication` dialog task.
- Synced `design.md` and `README.md` to the new two-phase provider-auth contract, and left `projectStructure.md` unchanged because this task changed contracts only and did not add, remove, or rename files.
- `npm run lint` initially flagged one unused route import and the stripped `completion` binding in the response-normalization helper, so I removed the dead import and explicitly discarded the internal promise before rerunning; the follow-up lint pass succeeded cleanly.
- `npm run format:check` reported expected Prettier drift across the new auth-contract files, so I ran `npm run format`; the follow-up `npm run format:check` then passed cleanly.
- `npm run build:summary:server` passed cleanly once the shared auth-state route stopped leaking the internal `completion` promise into the HTTP payload and cache.
- `npm run build:summary:client` initially failed because `client/src/api/codex.ts` was still exporting the broader shared route union that included invalid-request payloads; narrowing the client helper back to the success-state union fixed the dialog typecheck and the rerun passed cleanly.
- `npm run test:summary:server:unit` initially found Codex auth regression drift in the new state-machine expectations, so I added the cached completion-pending and completed assertions, stripped `completion` from the route payload, and reran; the full server unit suite then passed with `1419/1419`.
- `npm run test:summary:client` passed cleanly with `632/632` after the dialog tests were updated to the new verification URL plus one-time-code rendering and the stricter success-log payload.
- Recorded implementation commit `98de20b6` after the full Task 8 wrapper proof passed, and this follow-up plan update commit exists only to lock that hash into the task ledger for downstream traceability.

---

### Task 9. Add the Copilot device-auth backend

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `573ba2de`, `e5664a2e`

#### Overview

Add the server-side Copilot device-auth route that uses the documented device-login flow and returns verification details early through the shared contract settled in Task 8. This task depends on Task 4 for the reusable auth fake and on Task 8 for the shared contract. This task remains server-first so the frontend can consume one settled backend route in the later dialog task instead of chasing backend changes.

#### Documentation Locations

- GitHub OAuth device flow documentation: `https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow` for the checked verification URL, user-code, and completion-polling steps implemented by the Copilot auth backend.
- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked auth-status and runtime-home expectations that the Copilot route has to respect before starting device flow.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with Copilot device-auth flow diagrams.
- OpenAPI Specification 3.1.0: `https://spec.openapis.org/oas/v3.1.0` for the new Copilot auth route schema and the shared provider-auth response contract it must expose.

#### Subtasks

Standalone context for every subtask in this task: add the Copilot auth route alongside `server/src/routes/codexDeviceAuth.ts`, register it in `server/src/index.ts`, and keep auth refresh flowing back through the shared auth contract and the existing provider-readiness surfaces rather than a new Copilot-only polling API unless code evidence forces it. Reuse the repository’s current single-flight auth-start pattern and keep error logging secret-safe so raw verification output is not sprayed into failure logs. Respect documented env-token and `gh` fallback auth before starting device flow; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Edge Cases and Failure Modes](#edge-cases-and-failure-modes).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the device-auth, SDK, and OpenAPI references visible during the backend route work.
Implementation starter pattern for every subtask in this task: mirror the route registration and early-verification pattern already used by `server/src/routes/codexDeviceAuth.ts` and `server/src/index.ts`; build the Copilot route as the matching sibling that swaps in Copilot-specific runtime checks and storage paths while preserving the shared auth contract.

1. [x] Add the Copilot device-auth backend route and utility code using the documented Copilot device-login flow. Register the new route in `server/src/index.ts`, return the verification URL and one-time code as soon as they are available rather than waiting for the whole login to finish, and reuse the repository’s existing single-flight pattern so repeated start requests do not launch duplicate auth attempts for the same Copilot home. Emit the secret-safe acceptance log line `story.0000051.task09.device_auth_state_emitted` whenever the route returns a shared auth state, with context naming `verification_ready`, `completion_pending`, `completed`, `already_authenticated`, `failed`, or `unavailable_before_start`.
2. [x] Make readiness refresh explicit by reusing the shared auth contract state plus the existing provider-readiness surfaces the UI already consumes. After the external browser step completes, the UI should be able to learn whether authentication is complete or has failed without guessing from raw output text, and without adding a second Copilot-only polling route unless direct code evidence forces it. That same refresh path must also recognize already-authenticated Copilot states that came from documented env-token or `gh` fallback credentials rather than from the device flow route itself.
3. [x] Keep the auth storage location aligned with the shared Copilot home/config helper from Task 2, and make missing CLI, unavailable keychain, unwritable config directory, and failed login outcomes surface as clear reasons rather than generic route failures. If Copilot is already authenticated through env-token, stored login, or `gh` fallback, return the shared contract’s already-authenticated or unavailable-before-start state instead of forcing a redundant device-login flow. Keep request and error logs secret-safe by avoiding raw verification output, codes, or token-like strings in failure-path logging.
4. [x] Add an integration test in `server/src/test/integration/copilot.device-auth.test.ts`. Test type: integration. Description: start the Copilot auth route and confirm it returns verification URL and one-time code before the full login completes. Purpose: prove the route exposes early verification details on the happy path.
5. [x] Add an integration test in `server/src/test/integration/copilot.device-auth.test.ts`. Test type: integration. Description: complete the fake Copilot device flow and confirm the shared contract reports completion through the mounted route. Purpose: prove completion remains observable from the real route, not only the harness.
6. [x] Add a unit test in `server/src/test/unit/copilotDeviceAuth.test.ts`. Test type: unit. Description: simulate existing env-token authentication and confirm the route short-circuits to already-authenticated state without starting device flow. Purpose: prove the env-token happy path is explicit.
7. [x] Add a unit test in `server/src/test/unit/copilotDeviceAuth.test.ts`. Test type: unit. Description: simulate stored login or authenticated `gh` fallback and confirm the route also short-circuits to already-authenticated state. Purpose: prove non-env authenticated paths are covered too.
8. [x] Add a unit test in `server/src/test/unit/copilotDeviceAuth.test.ts`. Test type: unit. Description: force missing-CLI or unwritable-config conditions and confirm the route surfaces a clear failure or unavailable-before-start reason. Purpose: prove infrastructure failures are observable.
9. [x] Add an integration test in `server/src/test/integration/copilot.device-auth.test.ts`. Test type: integration. Description: simulate keychain-unavailable but writable `CODEINFO_COPILOT_HOME` fallback and confirm auth can still persist through the documented config-home path. Purpose: prove the container-compatible fallback path works.
10. [x] Add an integration test in `server/src/test/integration/copilot.device-auth.test.ts`. Test type: integration. Description: fire concurrent Copilot auth-start requests against the same home and confirm they share one single-flight auth attempt instead of spawning duplicates. Purpose: prove the new route matches the repository’s current auth concurrency behavior.
11. [x] Add an integration test in `server/src/test/integration/copilot.device-auth.test.ts`. Test type: integration. Description: force a parse or failure-path auth error and confirm the resulting logs stay secret-safe without emitting raw verification URLs, one-time codes, or token-like output. Purpose: prove the new route preserves the repository’s current auth logging safety expectations.
12. [x] Add a unit test in `server/src/test/unit/openapi.contract.test.ts`. Test type: unit. Description: assert the new `/copilot/device-auth` schema enforces the expected request shape and shared provider-auth response contract. Purpose: prove the published Copilot auth route contract stays in sync with the implementation.
13. [x] Update `openapi.json` for the new Copilot auth route path so the shared provider-auth response contract and route schema stay in sync with the implementation.
14. [x] Update `design.md` if this task needs new Copilot-auth-specific wording. Document name: `design.md`. Location: repository root. Description: describe the Copilot device-auth flow, readiness refresh path, single-flight behavior, and fallback persistence behavior, and add Mermaid diagrams if they help explain the flow. Purpose: keep architecture and auth-flow documentation aligned with the backend route.
15. [x] Update `README.md` if this task needs new Copilot-auth-specific wording. Document name: `README.md`. Location: repository root. Description: explain any user-visible Copilot auth behavior or prerequisites introduced by this task. Purpose: keep top-level usage documentation truthful.
16. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: list the new Copilot auth route, utility, and test files after they are created. Purpose: keep the repository file map accurate after file creation.
17. [x] Update this plan file after implementation by marking the completed checkboxes for Task 9, recording implementation notes, and listing the task commit hashes once they exist.
18. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
19. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Marked Task 9 in progress and then added `server/src/routes/copilotDeviceAuth.ts` plus `server/src/utils/copilotDeviceAuth.ts` so Copilot now has a real shared-contract device-auth route with early verification parsing, single-flight reuse, and state-marker logging.
- Reused the settled Task 8 auth states for Copilot and kept refresh on the same `POST /copilot/device-auth` path, which avoided inventing a Copilot-only polling route while still letting repeated requests observe `completion_pending` and `completed`.
- Extended `server/src/config/copilotConfig.ts` with a writable config-dir check so missing CLI and unwritable-home failures surface as `unavailable_before_start` instead of generic route errors.
- Added `server/src/test/unit/copilotDeviceAuth.test.ts` and `server/src/test/integration/copilot.device-auth.test.ts`; one integration expectation had to be corrected when the real overlapping-request behavior matched Codex and returned `completion_pending` for the second caller instead of duplicating the first `verification_ready` payload.
- Synced `openapi.json`, `README.md`, `design.md`, and `projectStructure.md` with the new Copilot auth route before the task-level lint/format/build validation step.
- `npm run lint`, `npm run format` + `npm run format:check`, and `npm run build:summary:server` all passed after minor import-order and unused-import cleanup in the new Copilot auth files.
- Targeted proof first confirmed the previously failing loop-flow integration now passes in isolation via `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "flow stop during a looped flow prevents later iterations from continuing"`, which narrowed the remaining risk to full-suite stability rather than Copilot auth behavior.
- Full wrapper proof then completed cleanly on rerun via `npm run test:summary:server:unit`, with `tests run: 1428`, `passed: 1428`, `failed: 0`, and saved log `test-results/server-unit-tests-2026-03-23T06-16-59-084Z.log`, so the Task 9 blocker is resolved and the task can be closed honestly.
- Recorded implementation commit `573ba2de` for the Task 9 backend route, proof, and documentation sync; the later full-wrapper rerun cleared the remaining proof blocker and closed the task.

---

### Task 10. Extend the existing client provider-auth test fixtures

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `17997e18`

#### Overview

Extend the existing client-side fetch-based auth fixtures so dialog and auth API tests can script Codex and Copilot auth states without duplicating raw responses in every test file. This task depends on Task 8 because the fixtures must target the real shared provider-auth contract instead of a guessed interim shape. This task is only about reusing and extending the current fixture layer, not about inventing a second client harness abstraction.

#### Documentation Locations

- Context7 Jest docs: `/jestjs/jest` for the checked mock, assertion, and async-test patterns used by the client fixture proof tests.
- Testing Library documentation: `https://testing-library.com/docs/` for the checked render and user-facing assertion style used by the repository’s client tests.
- React documentation: `https://react.dev/` for checked component-state and render-cycle context when extending the existing client auth test helpers around React components.

#### Subtasks

Standalone context for every subtask in this task: stay inside the existing client test helper layer, centered on `client/src/test/support/fetchMock.ts`, current auth tests, and the shared contract from Task 8. The rule here is to extend the current fetch-based fixture style for Codex and Copilot states, not to introduce a second client harness abstraction; follow [Test Harnesses](#test-harnesses), [Acceptance Criteria](#acceptance-criteria), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Jest, Testing Library, and React references open while extending the fixtures.
Implementation starter pattern for every subtask in this task: stay inside the existing fetch-mocking style used by `client/src/test/support/fetchMock.ts` and the current auth tests; add named provider-auth fixture builders in that same layer instead of inventing a second client-side harness.

1. [x] Extend the existing fetch-based client test helpers, centered on `client/src/test/support/fetchMock.ts` and any current auth fixture utilities, so tests can request Codex and Copilot auth start, verification-ready, completion-pending, completed, already-authenticated, failed, and unavailable-before-start states without rebuilding raw response objects in each file. When a named fixture is applied in the browser-backed scenario path, emit the secret-safe acceptance log line `story.0000051.task10.client_auth_fixture_applied` with context naming the fixture and provider.
2. [x] Define one clear fixture API around those existing helpers so later client tests can request a named provider-auth scenario without adding a second test-support layer.
3. [x] Update the existing client test bootstrap path so dialog and API tests can opt into the extended fixtures cleanly without affecting unrelated client tests.
4. [x] Add a client test in `client/src/test/providerAuthFixtures.test.ts`. Test type: client unit. Description: request a verification-ready provider-auth fixture and confirm the helper returns the expected shared contract shape. Purpose: prove the happy-path fixture is reusable.
5. [x] Add a client test in `client/src/test/providerAuthFixtures.test.ts`. Test type: client unit. Description: request an already-authenticated fixture and confirm the helper returns that shared contract shape without extra raw fields. Purpose: prove the extended fixture layer supports the new auth state cleanly.
6. [x] Add a client test in `client/src/test/providerAuthFixtures.test.ts`. Test type: client unit. Description: request a failure fixture and confirm the helper returns the expected error-state shape without throwing unexpected serialization or parsing errors. Purpose: prove failure fixtures are stable for downstream dialog tests.
7. [x] Update `projectStructure.md` only if this task adds or removes files beyond the current helper locations. Document name: `projectStructure.md`. Location: repository root. Description: list any new fixture helper or proof-test files after they are created. Purpose: keep the repository file map accurate after file creation.
8. [x] Update `design.md` only if the client test entry point needs brief explanation for future maintainers. Document name: `design.md`. Location: repository root. Description: add a short note about the shared provider-auth fixture entry point only if future maintainers would not infer it from the test code. Purpose: keep test architecture understandable.
9. [x] Update this plan file after implementation by marking the completed checkboxes for Task 10, recording implementation notes, and listing the task commit hashes once they exist.
10. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
11. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Extended `client/src/test/support/fetchMock.ts` with named provider-auth fixture builders plus an opt-in fetch installer, which kept Task 10 inside the existing fetch-mock layer instead of creating a second client harness.
- The fixture API is `createProviderAuthFixture(...)` plus `installProviderAuthFetchFixtures(...)`, so later tests can ask for named states like `copilot:verification_ready` without rebuilding raw response payloads.
- Updated `client/src/test/codexDeviceAuthApi.test.ts` and `client/src/test/codexDeviceAuthDialog.test.tsx` to opt into the shared fixture builders, which proved the new bootstrap path can be used selectively without changing unrelated client tests.
- Added `client/src/test/providerAuthFixtures.test.ts` to prove reusable verification-ready, already-authenticated, and failed fixture states, including the task log marker on the browser-backed fetch path.
- Updated `projectStructure.md` for the new `providerAuthFixtures` proof file; `design.md` did not need extra wording because the fixture entry point stays localized to `fetchMock.ts` and the focused proof file.
- `npm run lint` passed on the first run, while `npm run format:check` initially flagged `client/src/test/support/fetchMock.ts`; running `npm run format` and then rerunning `npm run format:check` cleared the formatting drift.
- Wrapper-backed proof passed cleanly with `npm run build:summary:client` and `npm run test:summary:client`, so the new fixture layer is covered both by focused fixture tests and the full client suite before Task 12 consumes it.

---

### Task 11. Update client provider and model selection for the three-provider contract

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `e10d1c09`

#### Overview

Teach the existing chat page to consume the new three-provider contract for provider ordering, provider availability, model loading, and next-send conversation semantics. This task depends on Tasks 1, 5, 6, and 8, and it must not start earlier because the chat page would otherwise be forced to guess provider, model, or auth semantics that still belong to the server. This task must not change the shared auth dialog yet; it should only update the provider and model selection flow that depends on those settled backend contracts.

#### Documentation Locations

- Context7 Jest docs: `/jestjs/jest` for the checked client test-runner, assertion, and mock patterns used by the chat page Jest tests in this task.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with provider-selection flow diagrams.
- React documentation: `https://react.dev/` for checked component-state guidance used by the chat page and provider-selection flow.
- React state preservation and reset guidance: `https://react.dev/learn/preserving-and-resetting-state` for the exact behavior this task preserves when provider or model changes should affect only the next send.
- MUI 6.4.12 Select API via MUI MCP: `https://llms.mui.com/material-ui/6.4.12/api/select.md` for checked select value, disabled-state, and `onChange` behavior used by provider and model selectors.
- MUI 6.4.12 FormControl API via MUI MCP: `https://llms.mui.com/material-ui/6.4.12/api/form-control.md` for checked wrapper, disabled, error, and layout behavior around the existing selection controls.

#### Subtasks

Standalone context for every subtask in this task: update `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `client/src/components/chat/CodexFlagsPanel.tsx`, and related chat page tests together. Preserve provider order `codex`, `copilot`, `lmstudio`, show unavailable Copilot with its reason instead of hiding it, keep provider/model changes as next-send new-conversation behavior, and keep Codex-only controls out of Copilot requests; follow [Acceptance Criteria](#acceptance-criteria), [Implementation Ideas](#implementation-ideas), and [Edge Cases and Failure Modes](#edge-cases-and-failure-modes).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the client contract and component-library references open while editing the page logic.
Implementation starter pattern for every subtask in this task: extend the existing provider-selection and model-selection flow already present in `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, and `client/src/components/chat/CodexFlagsPanel.tsx`; add Copilot to that current path instead of rewriting the chat page around a new abstraction.

1. [x] Update `client/src/hooks/useChatModel.ts` so the hook reads and preserves the shared provider order `codex`, `copilot`, `lmstudio`, handles disabled providers with reasons, and loads models for `copilot` through the existing `/chat/models` surface. Emit the secret-safe acceptance log line `story.0000051.task11.provider_selection_applied` whenever provider or model selection is applied, with context recording the chosen provider and whether the change is next-send only.
2. [x] Update `client/src/pages/ChatPage.tsx` so provider bootstrap and fallback follow the server contract instead of any remaining two-provider client-side shortcuts. Do not hide Copilot when it is unavailable; show it as unavailable with the surfaced reason.
3. [x] Preserve the existing rule that changing provider or model only affects the next send by starting a new conversation. Do not mutate the runtime provider or model in place for an already-persisted conversation.
4. [x] Keep existing Codex-only flags, defaults, and warning surfaces Codex-only in this task. When the selected provider is Copilot, hide or disable Codex-only UI such as `CodexFlagsPanel`, do not misapply Codex settings to the outgoing request payload, and preserve the existing Codex experience when the user switches back to Codex.
5. [x] Update any legacy provider-bootstrap handling or test fixtures in `useChatModel` and the chat page so three-provider provider-list responses are the normal path and any fallback-to-LM-Studio behavior remains an explicit degraded fallback rather than an accidental default that would hide Copilot.
6. [x] Add a client test in `client/src/test/chatPage.provider.test.tsx`. Test type: client unit. Description: load a three-provider response and confirm the chat page renders providers in the order `codex`, `copilot`, `lmstudio`, including Copilot’s disabled reason when unavailable. Purpose: prove provider ordering and disabled-state rendering.
7. [x] Add a client test in `client/src/test/chatPage.provider.test.tsx`. Test type: client unit. Description: return a degraded fallback provider list and confirm Copilot is still shown instead of being hidden accidentally. Purpose: prove the degraded-fallback regression case is covered.
8. [x] Add a client test in `client/src/test/chatPage.models.test.tsx`. Test type: client unit. Description: select Copilot and confirm the page loads Copilot models from `/chat/models`. Purpose: prove the Copilot model-loading happy path.
9. [x] Add a client test in `client/src/test/chatSendPayload.test.tsx`. Test type: client unit. Description: send a Copilot chat request and confirm Codex-only flags are omitted from the outgoing payload. Purpose: prove provider-specific payload isolation.
10. [x] Add a client test in `client/src/test/chatPage.provider.test.tsx`. Test type: client unit. Description: switch from Copilot back to Codex and confirm Codex-only banners and flags-panel behavior still render correctly. Purpose: prove Codex UI regressions are prevented.
11. [x] Add a client test in `client/src/test/chatPage.newConversation.test.tsx`. Test type: client unit. Description: change provider or model while viewing an existing conversation and confirm the next send starts a new conversation instead of mutating the current one. Purpose: prove next-send semantics are preserved.
12. [x] Update `design.md` if the client bootstrap sequence or next-send behavior is now clearer when written down. Document name: `design.md`. Location: repository root. Description: document the provider-selection and next-send flow and add Mermaid diagrams if they help explain the client flow. Purpose: keep client-flow architecture documentation aligned with the implementation.
13. [x] Update `README.md` only if user-facing provider behavior changed in a way the docs already describe. Document name: `README.md`. Location: repository root. Description: correct any top-level wording about provider selection, disabled providers, or next-send conversation behavior. Purpose: keep user-facing documentation truthful.
14. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any new chat page test or helper files after they are created. Purpose: keep the repository file map accurate after file creation.
15. [x] Update this plan file after implementation by marking the completed checkboxes for Task 11, recording implementation notes, and listing the task commit hashes once they exist.
16. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
17. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.
Defer wrapper-backed Docker and browser proof for this task to Tasks 15, 16, 18, and 20. Before the Copilot env wiring, Docker delivery, and fake-scenario plumbing land, those layers would only prove the pre-Copilot stack and would not give meaningful proof for this task's client behavior. When Task 20 reaches the repaired dual-stack manual Playwright-MCP step, capture and review screenshots stored under `playwright-output-local`. For this task's visual proof, save at least one screenshot showing provider order with Copilot visible in the selector and one screenshot showing Copilot selected while Codex-only UI such as `CodexFlagsPanel` is hidden or disabled, then check those images yourself to confirm the GUI matches this task's contract.

1. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Normalized `useChatModel` around the shared `codex > copilot > lmstudio` order and added the Task 11 provider/model selection acceptance marker with next-send context.
- Updated the chat page selectors to keep unavailable Copilot visible with its reason and to route provider/model sync through the new selection helpers without touching Task 12 auth dialog flow.
- Preserved next-send semantics by keeping provider/model changes on draft reset paths while conversation selection still rehydrates persisted provider/model state explicitly.
- Kept Codex-only controls isolated by continuing to gate `CodexFlagsPanel` and device-auth UI on Codex while adding a Copilot payload-isolation proof in `chatSendPayload.test.tsx`.
- Added the named provider-order, degraded-fallback, Copilot model-loading, Codex regression, and next-send conversation client tests required by this task before wrapper validation.
- `npm run lint` passed after adding the missing `useCallback` dependencies in `useChatModel` instead of suppressing the hook rule.
- `npm run format:check` initially flagged the updated hook and Copilot model test, so `npm run format` was applied and the formatting check then passed cleanly.
- `npm run build:summary:client` first failed on a test-only TypeScript narrowing issue in `chatSendPayload.test.tsx`; after narrowing the captured payload explicitly, the wrapper passed cleanly with zero warnings.
- The first full `npm run test:summary:client` run exposed older client tests that still assumed LM Studio bootstrapped first or used fuzzy `/lm studio/i` option matching that now collides with Copilot's degraded-fallback reason text; those tests were updated to select LM Studio explicitly or to use exact option names without weakening the Task 11 product behavior.
- `design.md`, `README.md`, and `projectStructure.md` did not need edits for Task 11 because no new files were added and the user-facing docs already matched the provider-selection behavior after the code/test updates.
- Final validation passed with `npm run lint`, `npm run format:check`, `npm run build:summary:client`, and `npm run test:summary:client` after the regression-test cleanup above.

---

### Task 12. Replace the Codex-only auth dialog with the shared Choose Authentication flow

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits:
  - `2bae71ed` DEV-[51] - Add shared authentication dialog flow

#### Overview

Update the existing client auth experience so the chat page uses one shared `Choose Authentication` dialog with `Codex Auth` and `Copilot Auth`, and so the UI consumes the shared provider-auth contract from Task 8 through the extended client fixtures from Task 10. This task depends on Tasks 9 and 10 and should not start earlier because the dialog would otherwise be built against a contract or fixture layer that does not exist yet. This task should stay focused on the dialog flow, not on provider or model selection, which belongs to Task 11.

#### Documentation Locations

- Context7 Jest docs: `/jestjs/jest` for the checked client test-runner, assertion, and mock patterns used by the shared auth dialog Jest tests in this task.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with shared authentication flow diagrams.
- MUI 6.4.12 Dialog API via MUI MCP: `https://llms.mui.com/material-ui/6.4.12/api/dialog.md` for checked `open`, `onClose`, `aria-labelledby`, and `aria-describedby` behavior used by the shared auth dialog shell.
- MUI 6.4.12 DialogTitle API via MUI MCP: `https://llms.mui.com/material-ui/6.4.12/api/dialog-title.md`, DialogContent API: `https://llms.mui.com/material-ui/6.4.12/api/dialog-content.md`, and DialogActions API: `https://llms.mui.com/material-ui/6.4.12/api/dialog-actions.md` for the checked internal dialog structure the repository already uses.
- MUI 6.4.12 Button API via MUI MCP: `https://llms.mui.com/material-ui/6.4.12/api/button.md` and Stack API: `https://llms.mui.com/material-ui/6.4.12/api/stack.md` for checked button ordering, disabled/loading presentation, and simple vertical layout behavior.
- React state preservation and reset guidance: `https://react.dev/learn/preserving-and-resetting-state` for the exact rule this task relies on when provider-specific dialog output should reset only intentionally.
- React documentation: `https://react.dev/` for checked component rendering and state-flow context around the shared dialog.

#### Subtasks

Standalone context for every subtask in this task: update `client/src/components/codex/CodexDeviceAuthDialog.tsx`, `client/src/components/agents/AgentsComposerPanel.tsx`, `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/api/codex.ts`, `client/src/test/codexDeviceAuthApi.test.ts`, and the shared fixtures from Task 10 together. The dialog must use title `Choose Authentication`, show `Codex Auth` above `Copilot Auth`, keep `Close` bottom-right, reuse the current MUI `Dialog` structure, refresh readiness through the existing provider or model surfaces, and keep agents execution Codex-backed in this story even though the shared dialog can start either auth flow; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Edge Cases and Failure Modes](#edge-cases-and-failure-modes).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the MUI dialog docs and shared auth-contract references visible while changing the modal.
Implementation starter pattern for every subtask in this task: preserve the existing dialog shell in `client/src/components/codex/CodexDeviceAuthDialog.tsx` and the current API-calling style in `client/src/api/codex.ts`; convert that one dialog into the shared `Choose Authentication` flow instead of creating a second modal or a different layout system.

1. [x] Replace or rename the current Codex-specific dialog component so the client exposes one shared `Choose Authentication` dialog with `Codex Auth` first, `Copilot Auth` second, and `Close` in the bottom-right action area. Reuse the existing MUI `Dialog`, `DialogTitle`, `DialogContent`, and `DialogActions` structure already used in this repository, and keep `aria-labelledby` and `aria-describedby` wired correctly as the title and body content evolve. Emit the secret-safe acceptance log line `story.0000051.task12.choose_auth_dialog_rendered` whenever the shared dialog renders or changes auth state, with context naming the visible provider branch and auth status.
2. [x] Generalize the client auth API layer so the dialog can start either provider’s auth flow and render the shared provider-auth response shape. Remove any client-only assumption that auth responses are Codex raw output, but preserve the current empty-request POST behavior and error-surface conventions for the existing Codex route while the client API becomes provider-aware.
3. [x] Render verification URL, one-time code, loading state, completion-pending state, completion success, already-authenticated state, and failure state below the shared auth buttons without replacing the overall dialog structure. Keep the outer dialog tree stable while provider-specific content changes so provider output only resets when the implementation chooses to reset it intentionally.
4. [x] Update every current consumer of `CodexDeviceAuthDialog`, including `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/components/agents/AgentsComposerPanel.tsx`, so the shared dialog keeps existing Codex behavior working outside the chat page while adding Copilot support to the shared component. Do not broaden agent execution itself beyond the current Codex-backed path in this story.
5. [x] Refresh provider readiness after auth completion using the shared provider and model surfaces instead of guessing from stale local state. Keep current Codex behavior working while adding Copilot behavior through the same contract.
6. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: open the shared dialog and confirm the title, `Codex Auth` then `Copilot Auth` button order, and bottom-right `Close` action are rendered correctly. Purpose: prove the new shared layout matches the story contract.
7. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: start auth and confirm early verification URL and one-time code render below the shared buttons without replacing the outer dialog tree. Purpose: prove the early verification happy path.
8. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: return already-authenticated state and confirm the dialog renders the correct success status without showing raw output assumptions. Purpose: prove the new already-authenticated state is surfaced correctly.
9. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: return unavailable-before-start or provider-specific failure state and confirm the dialog shows the correct error path. Purpose: prove pre-start unavailability and explicit failures are distinct in the UI.
10. [x] Add a client test in `client/src/test/codexDeviceAuthApi.test.ts`. Test type: client unit. Description: start a Copilot auth request through the generalized client API helper and confirm it accepts the shared verification-ready response shape without Codex-only raw-output parsing. Purpose: prove the API helper is truly provider-aware before the dialog consumes it.
11. [x] Add a client test in `client/src/test/codexDeviceAuthApi.test.ts`. Test type: client unit. Description: return unavailable-before-start or failed shared auth responses and confirm the generalized API helper preserves those states as structured client errors instead of forcing Codex-specific handling. Purpose: prove error handling is shared before the dialog relies on it.
12. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: return completion-pending state and confirm the shared dialog renders the in-progress status without collapsing back to the pre-start button view. Purpose: prove the pending branch of the shared auth contract is visible in the UI.
13. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: return completed state and confirm the shared dialog renders the final success status distinctly from already-authenticated state. Purpose: prove post-completion success is covered separately from pre-existing auth.
14. [x] Add a client test in `client/src/test/chatPage.authRefresh.test.tsx`. Test type: client unit. Description: complete an auth flow and confirm the page refreshes provider readiness through the shared provider or model surfaces instead of stale local state. Purpose: prove completion refresh behavior.
15. [x] Add a client test in `client/src/test/agentsPage.authDialog.test.tsx`. Test type: client unit. Description: trigger re-authentication from the agents page and confirm the shared dialog still supports that existing flow while agent execution remains Codex-backed. Purpose: preserve the agents-page regression path without accidentally broadening scope.
16. [x] Add a client test in `client/src/test/codexDeviceAuthDialog.test.tsx`. Test type: client unit. Description: run the Codex branch through the shared dialog and confirm the old Codex behavior still works. Purpose: prove the shared dialog did not break the existing provider.
17. [x] Update `README.md` if it describes the old Codex-only dialog wording or flow. Document name: `README.md`. Location: repository root. Description: correct any top-level wording about the shared `Choose Authentication` dialog and its supported providers. Purpose: keep user-facing documentation truthful.
18. [x] Update `design.md` if it describes the old Codex-only dialog wording or flow. Document name: `design.md`. Location: repository root. Description: document the shared auth dialog flow, provider-refresh behavior, the unchanged agents execution scope, and any Mermaid diagrams needed to show the UI auth flow clearly. Purpose: keep architecture and user-flow documentation aligned with the shared dialog.
19. [x] Update `projectStructure.md` if this task adds or removes files, including any renamed dialog components or test helpers. Document name: `projectStructure.md`. Location: repository root. Description: record any renamed or newly added dialog, page, or test files after those file operations are complete. Purpose: keep the repository file map accurate after file creation or rename work.
20. [x] Update this plan file after implementation by marking the completed checkboxes for Task 12, recording implementation notes, and listing the task commit hashes once they exist.
21. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
22. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.
Defer wrapper-backed Docker and browser proof for this task to Tasks 15, 16, 18, and 20. Before the Copilot env wiring, Docker delivery, and fake-scenario plumbing land, those layers would only prove the pre-Copilot stack and would not give meaningful proof for this task's shared dialog behavior. When Task 20 reaches the repaired dual-stack manual Playwright-MCP step, capture and review screenshots stored under `playwright-output-local`. For this task's visual proof, save one screenshot of the default `Choose Authentication` dialog layout with `Codex Auth`, `Copilot Auth`, and `Close` in the required positions, plus one screenshot of a non-default status state such as verification-ready, completion-pending, completed, or unavailable, then check those images yourself to confirm the dialog layout and status rendering match this task's contract.

1. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Shared `Choose Authentication` dialog now reuses the existing MUI shell, keeps `Codex Auth` above `Copilot Auth`, keeps `Close` in the action row, and emits the Task 12 render/state marker with only provider branch and auth-state context.
- The client auth API now exposes a provider-aware `postProviderDeviceAuth(...)` helper while preserving the strict empty-body POST and existing Codex wrapper path so Codex consumers did not need a route contract change.
- The dialog body now renders shared provider-auth states under the shared buttons instead of depending on Codex-only raw-output assumptions; completion-pending still shows optional status details without replacing the outer dialog tree.
- Chat and agents consumers now keep using the same shared dialog component; chat auth completion refreshes provider readiness and only refreshes models when the authenticated provider matches the active chat provider so the UI does not swap models from stale local guesses.
- Dialog proof now covers layout order, early verification output, pending/completed/already-authenticated branches, unavailable states, the preserved Codex branch, and the Task 12 secret-safe render marker through the shared fixture-backed client tests.
- The generalized client API proof now covers Copilot verification-ready responses plus unavailable and failed shared auth states without reintroducing Codex-only raw-output parsing assumptions.
- Added focused page regressions for chat auth refresh and agents-page dialog reuse so provider refresh stays tied to real fetch surfaces while agents execution remains Codex-backed.
- `README.md` did not contain obsolete Codex-only dialog wording, so the task left it unchanged after verification; `design.md` and `projectStructure.md` were updated to reflect the shared dialog flow and the new client proof files.
- `npm run lint` initially failed on one unused dialog import after the provider-aware API refactor, and `npm run format:check` flagged the shared dialog plus new proof files; `npm run lint:fix`, `npm run format`, and the final reruns cleared those validation issues before wrapper-backed build/test proof started.
- `npm run build:summary:client` initially failed because the shared dialog still referenced the removed URL regex helper during typecheck; restoring that helper cleared the wrapper and the rerun passed with `warning_count: 0`.
- The first full `npm run test:summary:client` run surfaced one duplicated unavailable-state assertion in the shared dialog proof, so a targeted rerun for `client/src/test/codexDeviceAuthDialog.test.tsx` verified the fix before the final full wrapper passed with `640/640`.

---

### Task 13. Harden transcript metadata rendering for partial Copilot usage and timing fields

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits:
  - `023e5061` DEV-[51] - Harden partial Copilot transcript metadata

#### Overview

Update the existing transcript formatting path so partial Copilot usage and timing metadata render cleanly without placeholder zeros or misleading labels. This task depends on Task 7 because the formatter should harden itself against the real Copilot metadata shape the server emits rather than against guessed placeholder payloads. This task is intentionally narrow: it should improve shared transcript formatting without rewriting the rest of the chat page.

#### Documentation Locations

- Context7 Jest docs: `/jestjs/jest` for the checked client test-runner, assertion, and render patterns used by the transcript Jest tests in this task.
- React conditional rendering guidance: `https://react.dev/learn/conditional-rendering` for the checked pattern of omitting missing metadata instead of rendering misleading placeholder values.
- React documentation: `https://react.dev/` for checked component-rendering context around transcript metadata display.
- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked usage and timing metadata variability that makes partial Copilot transcript fields a real case to support.

#### Subtasks

Standalone context for every subtask in this task: update `client/src/components/chat/chatTranscriptFormatting.ts` and the existing transcript tests so missing Copilot usage or timing values are omitted rather than zero-filled. Do not relabel or redesign Codex or LM Studio transcript metadata here; follow [Acceptance Criteria](#acceptance-criteria), [Message Contracts and Storage Shapes](#message-contracts-and-storage-shapes), and [Edge Cases and Failure Modes](#edge-cases-and-failure-modes).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the transcript-formatting and test references available while making the formatter stricter.
Implementation starter pattern for every subtask in this task: harden the existing helper functions inside `client/src/components/chat/chatTranscriptFormatting.ts`; follow the current omission logic for missing timing fields and extend that same approach to Copilot usage or timing values instead of redesigning the transcript UI.

1. [x] Update `client/src/components/chat/chatTranscriptFormatting.ts` so missing or `null` token and timing sub-values are omitted rather than rendered as `0` or other misleading placeholders. Emit the secret-safe acceptance log line `story.0000051.task13.partial_metadata_rendered` when a partial Copilot transcript metadata block is rendered, with context listing which usage or timing fields were omitted safely.
2. [x] Keep existing Codex and LM Studio metadata rendering stable. This task should only broaden the formatter enough to handle partial Copilot metadata safely, not relabel or redesign the existing transcript details.
3. [x] Review any transcript rendering code that assumes every provider sends the same metadata fields and narrow those assumptions to the fields that are actually present. Ignore unknown Copilot metadata fields safely.
4. [x] Add a client test in `client/src/test/sharedTranscript.proofContract.test.tsx`. Test type: client unit. Description: render partial Copilot metadata with missing timing fields and confirm no misleading placeholder timing values appear. Purpose: prove the missing-timing corner case.
5. [x] Add a client test in `client/src/test/sharedTranscript.proofContract.test.tsx`. Test type: client unit. Description: render partial Copilot metadata with missing token fields and confirm the formatter omits those values cleanly. Purpose: prove the missing-token corner case.
6. [x] Add a client test in `client/src/test/sharedTranscript.proofContract.test.tsx`. Test type: client unit. Description: render `null` and `undefined` Copilot usage values and confirm the formatter omits them instead of showing zero placeholders. Purpose: prove defensive rendering for partial SDK metadata.
7. [x] Add a client test in `client/src/test/sharedTranscript.proofContract.test.tsx`. Test type: client unit. Description: render existing Codex or LM Studio transcript metadata and confirm current labels and values are unchanged. Purpose: prove no regression for existing providers.
8. [x] Update `design.md` only if the transcript metadata contract needs one sentence of clarification for future developers. Document name: `design.md`. Location: repository root. Description: add a short note about partial metadata omission only if the formatter contract would be hard to infer from the tests and code alone. Purpose: keep rendering behavior understandable.
9. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any new transcript test files after they are created. Purpose: keep the repository file map accurate after file creation.
10. [x] Update this plan file after implementation by marking the completed checkboxes for Task 13, recording implementation notes, and listing the task commit hashes once they exist.
11. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
12. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.
Defer wrapper-backed Docker and browser proof for this task to Tasks 15, 16, 18, and 20. Before the Copilot env wiring, Docker delivery, and fake-scenario plumbing land, those layers would only prove the pre-Copilot stack and would not give meaningful proof for this task's transcript rendering behavior. When Task 20 reaches the repaired dual-stack manual Playwright-MCP step, capture and review screenshots stored under `playwright-output-local`. For this task's visual proof, save one screenshot of a Copilot transcript entry whose partial timing or token metadata omits missing values cleanly, then check that image yourself to confirm the GUI does not show placeholder zeros or misleading empty labels.

1. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- The shared transcript formatter now omits missing Copilot token and timing sub-values instead of zero-filling them, and the transcript row emits the Task 13 marker once per rendered partial metadata shape with only omitted field names in context.
- Existing Codex and LM Studio transcript labels remain unchanged because the formatter still renders all present values in the same order when metadata is complete.
- Transcript rendering assumptions are now narrowed to fields that are actually present by threading provider identity into hydrated transcript messages and by making the omission logic field-aware instead of provider-agnostic zero-filling.
- `client/src/test/sharedTranscript.proofContract.test.tsx` now covers partial Copilot timing, partial Copilot tokens, `null`/`undefined` usage values, and unchanged Codex rendering in one focused proof file.
- `design.md` did not need extra clarification because the omission contract is explicit in the formatter and proof file, and `projectStructure.md` did not need an update because this task reused the existing transcript proof file without adding or removing files.
- `npm run lint` and `npm run format:check` both passed on the first attempt after the formatter and transcript-row changes, so no auto-fix or formatting rerun was needed before wrapper-backed build and test proof.
- `npm run build:summary:client` passed on the first wrapper run with `warning_count: 0`, so the formatter changes did not introduce new typecheck or build drift.
- The first full `npm run test:summary:client` run caught one existing cached-token transcript expectation that still assumed the old parenthesized suffix form; updating that proof to the new omission-safe token line and rerunning the targeted test plus the full wrapper closed the regression cleanly at `644/644`.

---

### Task 14. Wire Copilot runtime environment injection

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `ae16097d`

#### Overview

Add the runtime env prerequisites that let the existing server and wrapper-backed startup paths resolve Copilot state safely: `CODEINFO_COPILOT_HOME`, one optional explicit `cliPath` override for runtimes that cannot rely on `PATH`, credential-precedence-safe env loading, and process-level health behavior that stays separate from provider readiness. This task depends on Task 2 so the env wiring can point at one shared Copilot home helper. This task stops at runtime env loading and does not yet take on Docker image delivery or named-volume persistence.

#### Documentation Locations

- Context7 GitHub Copilot SDK docs: `/github/copilot-sdk` for the checked runtime-home and auth-status expectations that the server env wiring must satisfy.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for checked credential precedence and runtime context around `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN`.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with runtime-env or health-flow diagrams.
- Docker Compose environment-variable guidance: `https://docs.docker.com/compose/environment-variables/` for the checked rules on passing env values into the wrapper-backed container runtime.
- GitHub Copilot CLI setup docs: `https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli` for the checked local CLI installation expectations that make the `PATH` versus explicit `cliPath` rule concrete for this repository.

#### Subtasks

Standalone context for every subtask in this task: update `server/src/config/startupEnv.ts`, the shared Copilot home helper from Task 2, and `server/.env`, `server/.env.local`, and `server/.env.e2e` together. Add `CODEINFO_COPILOT_HOME`, keep `/health` process-only, preserve runtime credential precedence for `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, and `gh` fallback, and expose one optional explicit CLI path input for runtimes where `copilot` is not on `PATH`; follow [Acceptance Criteria](#acceptance-criteria), [Missing Runtime and Deployment Prerequisites](#missing-runtime-and-deployment-prerequisites), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the runtime-env and container-doc references open while wiring configuration.
Implementation starter pattern for every subtask in this task: copy the existing environment-resolution style already used for Codex in `server/src/config/startupEnv.ts`, `server/src/config/codexConfig.ts`, and the current server `.env` files; add `CODEINFO_COPILOT_HOME` as the parallel path rather than inventing a second env-loading mechanism, and keep any optional Copilot CLI path override in that same startup-config path instead of adding a second settings source.

1. [x] Update `server/src/config/startupEnv.ts`, the shared Copilot home/config helper from Task 2, and the server env files so `CODEINFO_COPILOT_HOME` is loaded in development, local Docker, and e2e in the same style as `CODEINFO_CODEX_HOME`. Keep the development default repo-local and the container path `/app/copilot`, and make sure this env wiring does not override or mask the documented Copilot credential env vars `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN`. Emit the secret-safe acceptance log line `story.0000051.task14.runtime_config_loaded` when runtime config resolves, with context showing the Copilot home path and whether `cliPath` override is present or absent.
2. [x] Add one optional explicit Copilot CLI path setting through the same startup-config path, for example `CODEINFO_COPILOT_CLI_PATH`, so local development or constrained runtimes can supply the SDK `cliPath` when the `copilot` binary is not available on `PATH`. Keep that setting optional, keep the default `PATH`-based behavior intact, and do not add a second external service contract.
3. [x] Make sure `/health` remains a process-level health check and does not start failing just because the Copilot CLI is missing, Copilot is unauthenticated, or Copilot models are unavailable. Copilot readiness belongs on the chat provider and model surfaces only.
4. [x] Add a unit test in `server/src/test/unit/runtimeConfig.test.ts`. Test type: unit. Description: load the server env defaults and confirm `CODEINFO_COPILOT_HOME` is injected for development, Docker, and e2e modes. Purpose: prove runtime env injection is explicit.
5. [x] Add a unit test in `server/src/test/unit/runtimeConfig.test.ts`. Test type: unit. Description: set an explicit Copilot CLI path override and confirm runtime loading preserves it as the optional `cliPath` input without making it mandatory. Purpose: prove the configured-CLI branch is available when `PATH` cannot be relied on.
6. [x] Add a unit test in `server/src/test/unit/runtimeConfig.test.ts`. Test type: unit. Description: set credential env vars in different combinations and confirm runtime loading preserves the documented Copilot credential precedence. Purpose: prove env loading does not mask higher-precedence credentials.
7. [x] Add a unit test in `server/src/test/unit/runtimeConfig.test.ts`. Test type: unit. Description: resolve the derived Copilot-home paths from the loaded env and confirm they match the shared helper contract. Purpose: prove home-path resolution is stable.
8. [x] Add an integration test in `server/src/test/integration/health.copilot-isolation.test.ts`. Test type: integration. Description: make Copilot missing, unauthenticated, or model-unavailable and confirm `/health` still returns process-level success. Purpose: prove Copilot readiness does not break server health.
9. [x] Update `README.md`. Document name: `README.md`. Location: repository root. Description: document the new Copilot env var, the optional explicit Copilot CLI path override for local development, and any user-visible runtime prerequisites introduced by this task. Purpose: keep top-level usage documentation truthful.
10. [x] Update `design.md`. Document name: `design.md`. Location: repository root. Description: describe the runtime-env loading flow, the explicit `cliPath` versus `PATH` rule, the `/health` isolation rule, and add Mermaid diagrams if they help explain the runtime flow. Purpose: keep architecture and runtime-flow documentation aligned with the implementation.
11. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: record any new runtime-config or health-isolation test files after they are created. Purpose: keep the repository file map accurate after file creation.
12. [x] Update this plan file after implementation by marking the completed checkboxes for Task 14, recording implementation notes, and listing the task commit hashes once they exist.
13. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
14. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.

#### Implementation notes

- `server/src/config/startupEnv.ts`, `server/src/config/copilotConfig.ts`, `server/src/index.ts`, and the server env files now carry `CODEINFO_COPILOT_HOME` end to end with a repo-local dev default, a container `/app/copilot` path for override flows, and the Task 14 runtime-config log marker; the only wrinkle was keeping the log secret-safe by recording only the resolved home and whether the CLI override is present.
- The shared Copilot helper now resolves an optional `CODEINFO_COPILOT_CLI_PATH` through the same startup-config path and keeps `PATH` discovery as the default, so no second Copilot settings source or external service contract was needed.
- `/health` stayed process-only by leaving the route unchanged and adding a dedicated integration proof that exercises connectivity, authentication, and model-unavailable Copilot states through `/chat/providers` without turning those readiness failures into health failures.
- `server/src/test/unit/runtimeConfig.test.ts` now covers explicit Copilot-home injection, optional CLI override behavior, credential precedence, and derived path resolution through the shared helper contract instead of ad hoc env parsing.
- `server/src/test/integration/health.copilot-isolation.test.ts` is the new focused proof file for Task 14 and keeps the health-isolation check small by routing the Copilot scenarios through the existing provider-readiness surface.
- `README.md`, `design.md`, and `projectStructure.md` now all describe the settled Task 14 env contract: repo-local `../copilot` development home, `/app/copilot` container override, optional `CODEINFO_COPILOT_CLI_PATH`, and the explicit rule that `/health` remains separate from Copilot readiness.
- `npm run lint` initially failed on import-order warnings in the new Task 14 files, so `npm run lint:fix` was enough to normalize the import blocks and the rerun then passed cleanly.
- `npm run format:check` flagged only the new health-isolation integration file, so `npm run format` reformatted that test and the rerun passed without further manual changes.
- `npm run build:summary:server` passed with `warning_count: 0`, so the Task 14 env helper, startup logging, and health-isolation proof compile cleanly together.
- Targeted wrapper runs for `server/src/test/unit/runtimeConfig.test.ts` and `server/src/test/integration/health.copilot-isolation.test.ts` passed first, which made it easier to localize one early build break before the full suite.
- The full `npm run test:summary:server:unit` wrapper then passed cleanly at `1435/1435`, so Task 14 closes on the required full server-unit proof instead of targeted-only coverage.

---

### Task 15. Wire Copilot Docker delivery and persistence

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits:
  - `e5471e10` DEV-[51] - Wire Copilot Docker contract
  - `1d8e7a5f` DEV-[51] - Close Task 15 Docker proof

#### Overview

Add the Docker and compose prerequisites that let the existing stack host Copilot safely: CLI delivery, writable runtime storage, Docker-managed persistence, and build-context exclusions. This task depends on Tasks 2 and 14 so the container wiring can point at one shared Copilot home helper and the runtime env contract is already settled. This task must keep the repository’s image-build model intact and must not introduce host source bind mounts for application code.

#### Documentation Locations

- Context7 Docker docs: `/docker/docs` for the checked Dockerfile and Compose behavior used when adding the Copilot runtime prerequisites without changing the repo’s image-build model.
- Docker Compose volumes documentation: `https://docs.docker.com/reference/compose-file/volumes/` for the checked named-volume syntax and persistence rules used by the Copilot runtime home.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with Docker or persistence-flow diagrams.
- GitHub Copilot product docs: `https://docs.github.com/en/copilot` for checked runtime-context details that explain why Copilot state needs writable persistent storage inside the containerized stack.

#### Subtasks

Standalone context for every subtask in this task: update `server/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, and `.dockerignore` together. Use one Docker-managed named-volume pattern for Copilot state, add no new ports, and do not introduce a bind-mounted source tree; follow [Acceptance Criteria](#acceptance-criteria), [Missing Runtime and Deployment Prerequisites](#missing-runtime-and-deployment-prerequisites), and [Proof Path Readiness](#proof-path-readiness).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Docker and compose references available while editing the runtime delivery path.
Implementation starter pattern for every subtask in this task: mirror the existing Codex Docker and compose treatment in `server/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, and `.dockerignore`; Copilot state should become the parallel named-volume and ignore-path sibling, not a new bind-mounted source-tree workflow.

1. [x] Update `server/Dockerfile` so the server image includes the Copilot runtime prerequisites and a writable `/app/copilot` path without changing the existing “copy source into the image and build there” model. Do not introduce a bind-mounted source tree. Emit the secret-safe acceptance log line `story.0000051.task15.container_contract_ready` when the containerized Copilot runtime contract is active, with context confirming `/app/copilot`, the named-volume pattern, and unchanged published ports.
2. [x] Update `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` so Copilot home is injected consistently and persisted through one Docker-managed named-volume pattern wherever container persistence is required. Do not add any new published ports, and do not hard-code Copilot credential secrets into committed compose or env files.
3. [x] Update `.dockerignore` so repo-local Copilot auth files, session state, and runtime-home artifacts are excluded from the image build context just like other local runtime secrets. Keep only required application files in the build context.
4. [x] Update `scripts/compose-build-summary.mjs` so the wrapper’s runtime-asset proof includes the new Copilot runtime root and does not keep reporting a pre-Copilot image asset set after this task lands. Keep the wrapper output format stable while extending the runtime-asset marker to include `/app/copilot`.
5. [x] Add a unit test in `server/src/test/unit/copilot-compose-contract.test.ts`. Test type: unit. Description: inspect the compose config and confirm the existing published port contract is unchanged after Copilot wiring. Purpose: prove Docker changes do not shift network expectations.
6. [x] Add a unit test in `server/src/test/unit/copilot-compose-contract.test.ts`. Test type: unit. Description: inspect the compose config and confirm Copilot state uses the selected Docker-managed named volume. Purpose: prove the persistence mechanism is the documented one.
7. [x] Add a unit test in `server/src/test/unit/copilot-compose-contract.test.ts`. Test type: unit. Description: inspect the compose and Docker ignore rules and confirm one single persistence rule is used while repo-local Copilot auth artifacts stay out of the build context. Purpose: prove container persistence and build-context exclusions are aligned.
8. [x] Add a unit test in `server/src/test/unit/copilot-compose-contract.test.ts`. Test type: unit. Description: inspect the compose config and confirm services that need Copilot state inject `CODEINFO_COPILOT_HOME=/app/copilot` consistently. Purpose: prove the Docker env contract matches the planned container runtime path.
9. [x] Add a unit test in `server/src/test/unit/copilot-compose-contract.test.ts`. Test type: unit. Description: inspect `scripts/compose-build-summary.mjs` and confirm the runtime-asset marker now includes the Copilot runtime root. Purpose: prove the wrapper-backed compose build proof can actually detect the new Copilot delivery path.
10. [x] Update `README.md`. Document name: `README.md`. Location: repository root. Description: document the named-volume runtime persistence rule and any user-visible Docker prerequisites introduced by this task. Purpose: keep top-level usage documentation truthful.
11. [x] Update `design.md`. Document name: `design.md`. Location: repository root. Description: describe the Docker delivery and persistence flow, and add Mermaid diagrams if they help explain the container runtime path. Purpose: keep architecture and deployment-flow documentation aligned with the implementation.
12. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: record the new Docker contract test file and any other file additions after those files are created. Purpose: keep the repository file map accurate after file creation.
13. [x] Update this plan file after implementation by marking the completed checkboxes for Task 15, recording implementation notes, and listing the task commit hashes once they exist.
14. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
15. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
3. [x] Run `npm run compose:build:summary`. If the wrapper reports `failed`, unknown counts, or unexpected failure totals, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun the same wrapper.
4. [x] Run `npm run compose:up`. If startup fails, use `npm run compose:logs` to inspect the running stack, fix the issue, and rerun `npm run compose:up`.
5. [x] Run `npm run compose:down` after the Docker delivery proof finishes.

#### Implementation notes

- `server/Dockerfile`, `server/npm-global.txt`, and `server/entrypoint.sh` now install the GitHub Copilot CLI alongside the existing global tooling, prepare writable `/app/copilot`, and emit `story.0000051.task15.container_contract_ready` with only container-contract facts; the main wrinkle was keeping the marker secret-safe while still proving the named-volume contract.
- `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` now all inject `CODEINFO_COPILOT_HOME=/app/copilot` and mount the same logical `copilot-data` named-volume pattern, which keeps container persistence aligned without changing the published port contract or source-bind count.
- `.dockerignore` now excludes repo-local Copilot runtime homes alongside the existing Codex secrets so local Copilot auth and session artifacts do not leak into the Docker build context.
- `scripts/compose-build-summary.mjs` now extends the existing runtime-asset marker to include `/app/copilot` without changing the wrapper output contract.
- `server/src/test/unit/copilot-compose-contract.test.ts` now locks down the Task 15 contract in one focused proof file by checking unchanged published ports, the shared `copilot-data` named-volume pattern, Docker-ignore alignment, consistent `/app/copilot` env injection, and the compose-build runtime asset marker.
- `README.md`, `design.md`, and `projectStructure.md` now document the settled Task 15 container contract: image-baked Copilot CLI delivery, `/app/copilot` runtime home, the shared `copilot-data` named-volume pattern, unchanged ports, and the new focused compose-contract proof file.
- `npm run lint` passed on the first run after the Dockerfile, compose, and proof-file changes, so the new container contract landed without needing any automatic lint cleanup.
- `npm run format:check` also passed on the first run, so the Docker, compose, and documentation edits already matched the repository Prettier rules.
- `npm run build:summary:server` passed on the first wrapper run with `warning_count: 0`, so the container-contract edits did not introduce any server compile drift before the heavier test and compose proof.
- Testing step 2 is now closed: a focused rerun of `server/src/test/integration/chat-copilot-lock.test.ts` exposed the real flake, where the concurrent-turn proof relied on a timed delay before the first request actually held the conversation lock under full-suite load.
- `server/src/test/integration/chat-copilot-lock.test.ts` now waits for `getActiveRunOwnership(conversationId)` before sending the competing request, which keeps the assertion tied to the real lock state instead of event-loop timing luck.
- The focused rerun `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-lock.test.ts` passed at `1/1`, and the full wrapper rerun `npm run test:summary:server:unit` then passed cleanly at `1440/1440` with log `test-results/server-unit-tests-2026-03-23T09-41-29-483Z.log`, so the earlier Task 15 blocker did not survive the lock-proof hardening.
- `npm run compose:build:summary` then passed with `items passed: 2`, `items failed: 0`, and the expected runtime-asset marker including `/app/copilot`, so the wrapper-backed Docker build proof now matches the Task 15 container contract.
- `npm run compose:up` brought the stack up cleanly with the `codeinfo2_copilot-data` named volume, `codeinfo2-server-1` reaching `Healthy`, and `codeinfo2-client-1` starting without any port-contract drift.
- `npm run compose:down` then removed the stack cleanly, including the internal network and the runtime services, so the Docker delivery proof finished without leaving the repository in a running-stack state.
- Recorded the Task 15 implementation commit hash in this plan after the blocker-state commit was created, and this closeout loop completed the remaining wrapper-backed proof so the task can now move from `in_progress` to `completed`.

---

### Task 16. Extend existing integration, Cucumber, and e2e boot paths for fake Copilot scenarios

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `ccbf3969`, `30f574bd`, `485bea52`, `a0ca9b85`, `421f956d`

#### Overview

Extend the repository's existing integration, Cucumber, and Playwright boot paths so they can run named fake Copilot scenarios with deterministic availability, model responses, auth states, and streamed chat events. This task depends on Tasks 3 and 4 for the lower-level fake surfaces it composes, and it must stay aligned with Task 15 before the wrapper-backed e2e stack is treated as complete. This task is about extending the current boot paths, not about introducing a second cross-layer fixture abstraction or writing the full end-to-end story coverage yet.

#### Documentation Locations

- Context7 Playwright docs: `/microsoft/playwright` for the checked fixture, setup, and scenario-boot patterns used when extending the repository’s existing higher-level proof path.
- Cucumber guides root: `https://cucumber.io/docs/guides/` for the official guides index that should be referenced alongside the specific Cucumber guidance used by this mixed proof task.
- Cucumber 10-minute tutorial: `https://cucumber.io/docs/guides/10-minute-tutorial/` for the checked scenario and step-definition structure, and Cucumber testable architecture guide: `https://cucumber.io/docs/guides/testable-architecture/` for keeping the higher-level boot-path logic out of step files.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with higher-level boot-path or scenario-selection diagrams.
- Node.js test runner documentation: `https://nodejs.org/api/test.html` for the checked integration-proof pattern used by the dedicated boot-path smoke test.

#### Subtasks

Standalone context for every subtask in this task: extend the existing higher-level test boot paths under `server/src/test/integration`, `server/src/test/steps`, `server/src/test/support/wsClient.ts`, and the wrapper-backed e2e startup path. Reuse the fake SDK and fake device-auth harnesses from Tasks 3 and 4, expose named Copilot scenarios, and do not invent a second cross-layer fixture system; follow [Test Harnesses](#test-harnesses), [Proof Path Readiness](#proof-path-readiness), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Playwright, Cucumber, Mermaid, and Node test references in front of them while extending the boot path.
Implementation starter pattern for every subtask in this task: extend the repository’s current wrapper-backed startup and websocket-support path around `server/src/test/support/wsClient.ts` and the existing integration or e2e boot helpers; add named Copilot scenarios to that path instead of inventing another cross-layer fixture system.

1. [x] Extend the existing server-side integration and wrapper-backed boot paths so tests can enable fake Copilot provider readiness, fake model lists, fake chat streams, and fake auth states without touching production runtime defaults. Reuse the current integration boot paths, websocket helpers, and mock transport helpers instead of introducing a second test startup stack. Emit the secret-safe acceptance log line `story.0000051.task16.fake_scenario_booted` when the named fake Copilot scenario boot path becomes active, with context naming the selected scenario.
2. [x] Define one clear scenario-selection contract, using the repository's current env-driven or dependency-injection style, so integration, Cucumber, and e2e tests can enable named Copilot scenarios instead of rebuilding bespoke setup code in each suite.
3. [x] Wire that scenario selection into the existing integration and e2e startup path so later tests can reuse it from `server/src/test/integration`, `server/src/test/steps`, and the Playwright wrapper-backed stack.
4. [x] Wire the same named Copilot scenario selector through the wrapper-backed e2e runtime path by updating the files that actually feed `npm run test:summary:e2e`, including `.env.e2e`, `docker-compose.e2e.yml`, and any required wrapper or runtime-config readers. The goal is that the Playwright wrapper can request the same named fake scenarios as integration and Cucumber without a manual shell export.
5. [x] Add an integration proof test in `server/src/test/integration/copilot.boot-path.test.ts`. Test type: integration. Description: boot the application through the extended higher-level path with a named happy-path Copilot scenario and assert the stack is usable. Purpose: prove the new scenario-selection path works end to end.
6. [x] Add an integration proof test in `server/src/test/integration/copilot.boot-path.test.ts`. Test type: integration. Description: boot the application through the same higher-level path with a named deterministic error scenario and assert the failure is surfaced cleanly. Purpose: prove the boot path can exercise negative scenarios too.
7. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: list any new higher-level support files and proof tests after those files are created. Purpose: keep the repository file map accurate after file creation.
8. [x] Update `design.md` if the boot-path extension needs explanation for future maintainers. Document name: `design.md`. Location: repository root. Description: describe the scenario-selection and higher-level boot flow, and add Mermaid diagrams if they help explain the path. Purpose: keep architecture and boot-flow documentation aligned with the implementation.
9. [x] Update this plan file after implementation by marking the completed checkboxes for Task 16, recording implementation notes, and listing the task commit hashes once they exist.
10. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
11. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.
5. [x] Run `npm run compose:build:summary`. If the wrapper reports `failed`, unknown counts, or unexpected failure totals, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun the same wrapper.
6. [x] Run `npm run test:summary:e2e` using the wrapper only and allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full wrapper.

#### Implementation notes

- `server/src/test/support/copilotScenarioCatalog.ts` is the new named scenario catalog for the higher-level Copilot proof path, which keeps readiness, auth, models, and stream behavior aligned across integration and e2e without inventing another fixture vocabulary.
- `server/src/test/support/copilotBootPath.ts` now boots a real Express plus websocket stack around the fake Copilot SDK and fake device-auth harnesses, and it emits `story.0000051.task16.fake_scenario_booted` with only scenario name and surface context.
- `server/src/test/integration/copilot.boot-path.test.ts` is the focused proof file for the new happy-path and auth-required boot scenarios.
- `.env.e2e`, `server/.env.e2e`, `docker-compose.e2e.yml`, `scripts/test-summary-e2e.mjs`, and `e2e/support/copilotFakeScenario.ts` now carry the named `E2E_COPILOT_SCENARIO` / `CODEINFO_FAKE_COPILOT_SCENARIO` selector through the wrapper-backed e2e path instead of relying on manual shell exports.
- `e2e/chat.spec.ts`, `design.md`, and `projectStructure.md` now describe and consume the shared named scenario contract so later Tasks 17 and 18 can extend the same boot path instead of branching into a second startup stack.
- `npm run lint` initially stopped on import-order warnings in the new Task 16 files, so `npm run lint:fix` normalized those imports and the rerun then passed cleanly.
- `npm run format:check` initially flagged four Task 16 files, so `npm run format` rewrote them and the rerun then passed cleanly.
- `npm run build:summary:server` first failed on Task 16 fake boot-path type drift, so I aligned the mock auth-file-store return shape and Copilot SDK model/auth fixtures with the real server contracts; the rerun then passed cleanly with zero warnings.
- `npm run build:summary:client` passed cleanly on the first wrapper run with zero warnings, which confirmed the Task 16 e2e scenario selector wiring did not break the client build path.
- Earlier full-wrapper proof for testing step 3 (`npm run test:summary:server:unit`) did reach a terminal result at `test-results/server-unit-tests-2026-03-23T10-25-30-551Z.log`, but it failed in the new Task 16 boot-path proof because `server/src/test/integration/copilot.boot-path.test.ts` still assumed Copilot would always appear at a fixed provider slot. That specific proof mismatch is now addressed by the later Task 16 test update in `30f574bd`, and the targeted rerun for `server/src/test/integration/copilot.boot-path.test.ts` then passed cleanly with `tests run: 2`, `passed: 2`, `failed: 0`. The remaining active blocker for this task is the newer full-wrapper completion issue recorded below, not the original fixed-slot provider assertion.
- **BLOCKING ANSWER** Repository precedent shows this blocker is a higher-level expectation mismatch, not a missing Task 16 runtime seam. Fresh `code_info` results plus direct inspection show the failing assertions live in `server/src/test/integration/copilot.boot-path.test.ts`, while `server/src/test/support/copilotBootPath.ts` already mounts one shared fake Copilot lifecycle into `/chat`, `/chat/providers`, and `/chat/models`. The real provider-order contract is already proven elsewhere in this repo: `server/src/routes/chatProviders.ts` builds the response as `executionProvider` first and then appends the remaining ids from `ORDERED_CHAT_PROVIDERS`, `server/src/config/chatDefaults.ts` chooses that `executionProvider` from the shared runtime-selection path, and `server/src/test/unit/chatProviders.test.ts` already proves that the first slot moves when fallback selection changes. `server/src/test/integration/support/copilotChatHarness.ts` also proves the fake Copilot lifecycle can already execute real `POST /chat` requests without any second boot stack. That means the Task 16 blocker is not “the fake lifecycle was not injected” and it is not “Copilot cannot boot end to end”; it is that the new higher-level assertions copied a fixed-slot expectation (`providers[1] === 'copilot'`) that conflicts with the already-proven execution-provider-first contract.
- **BLOCKING ANSWER** External library and framework precedent points to the same fix boundary. DeepWiki `expressjs/express`, Context7 `/expressjs/express`, and the official Express middleware and routing docs all describe the normal pattern as one application mounting modular routers through `app.use()` while they share the same app-level dependencies or injected factories, not creating route-local runtime seams per endpoint. For the assertion shape itself, official MDN guidance for `Array.prototype.find()` matches the stable contract here: when the important property is object identity such as `id === 'copilot'`, lookup by that property is the correct stable read path and array index should only be asserted when order is itself the contract under test. That matches the current local setup in `copilotBootPath.ts`: the boot helper already creates one fake Copilot lifecycle factory and passes it into all three chat routers, so the fix belongs in the Task 16 proof expectation rather than in startup wiring.
- **BLOCKING ANSWER** Issue-resolution research and the saved full-suite log converge on one proper fix. The log `test-results/server-unit-tests-2026-03-23T10-25-30-551Z.log` reaches a real terminal result (`# pass 1440`, `# fail 2`) and both failures are strict assertion mismatches where the boot-path test expected `copilot` at a fixed slot but actually received `codex`; this is the classic “brittle order-dependent assertion” failure mode, not a startup crash or missing mock. The proper fix for this repo is therefore: keep the existing shared Task 16 boot-path wiring, update `server/src/test/integration/copilot.boot-path.test.ts` and any copied higher-level scenario fixtures to locate the `copilot` provider entry by `id` and assert its availability or auth-required reason directly, and only assert a specific first-position order in scenarios that explicitly pin the shared runtime selection to that provider. Temporary workarounds such as forcing a default-provider env only for this test or weakening the assertion to a generic success check would hide the real contract, while anti-patterns such as changing `chatProviders` fallback ordering or adding a second per-route fake lifecycle would reopen already-completed provider-contract work and fight the repo’s existing router-factory design. This chosen fix fits the current local repo state because Task 16 is meant to prove the named fake-scenario boot path through the existing provider contract, not redefine that provider contract.
- **BLOCKING ANSWER** Research on the later “wrapper never finished” note proved that issue was observational, not a new runtime defect. Local wrapper inspection shows `scripts/test-summary-server-unit.mjs` only emits its final wrapper status after the `node --test` child ends and `runLoggedCommand()` receives the child-process `close` event; DeepWiki `nodejs/node`, Context7 `/nodejs/node`, and the official Node child-process docs all describe `close` as the reliable signal that the process and stdio are fully finished, while the `node:test` docs describe summary output as an end-of-run event rather than an intermediate heartbeat. The saved log `test-results/server-unit-tests-2026-03-23T11-16-19-458Z.log` now proves the run did finish cleanly with `# tests 1442`, `# pass 1442`, `# fail 0`, so the right fix is to treat the earlier heartbeat-only polling window as incomplete observation and mark testing step 3 complete from the finished log. Rejected alternatives are not suitable here: adding `--test-force-exit`, changing the wrapper to emit a fake early final state, or mutating the Task 16 harness without evidence would be workarounds against a run that actually completed successfully.
- Recorded blocker checkpoint commit `ccbf3969` after the shared fake-scenario plumbing, docs, and plan updates were saved so the next loop can resume from a stable Task 16 in-progress state.
- Updated `server/src/test/integration/copilot.boot-path.test.ts` to look up the `copilot` provider entry by `id` instead of assuming it always sits at array index `1`, and the targeted wrapper rerun `npm run test:summary:server:unit -- --file server/src/test/integration/copilot.boot-path.test.ts` then passed with `tests run: 2`, `passed: 2`, `failed: 0`.
- The fresh full wrapper run for testing step 3 at `test-results/server-unit-tests-2026-03-23T11-16-19-458Z.log` did eventually reach a clean terminal result after the earlier heartbeat-only polling window. The saved log ends with `# tests 1442`, `# pass 1442`, `# fail 0`, and `# duration_ms 788429.679692`, so testing step 3 is now complete even though the earlier audit stopped polling before the wrapper finished printing its final summary. There is no remaining active Task 16 blocker after the fixed-slot assertion update and the later full-wrapper completion proof; Task 16 stays `in_progress` only because testing steps 4 through 6 are still unrun.
- `npm run test:summary:server:cucumber` then passed cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so the shared fake-scenario boot-path work did not regress the existing Cucumber proof layer.
- `npm run compose:build:summary` then passed with `items passed: 2`, `items failed: 0`, and the expected runtime-asset marker including `/app/copilot`, so the wrapper-backed container contract still matches the Task 15 and Task 16 fake-scenario boot-path expectations.
- The first full `npm run test:summary:e2e` run reached a terminal failure and pointed to two concrete Playwright selector problems rather than a Task 16 runtime-contract gap: `e2e/chat-codex-reasoning.spec.ts` used an ambiguous `getByText('OpenAI Codex')` selector, and `e2e/chat.spec.ts` no longer started on the LM Studio path that exposes `Mock Model 1` after the Task 16 mock-provider ordering change.
- Updated `e2e/chat-codex-reasoning.spec.ts` to click the Codex provider by role `option`, and restored `e2e/chat.spec.ts` mock providers to keep LM Studio first while still surfacing Copilot in the mocked provider list.
- Historical blocker checkpoint: testing step 6 (`npm run test:summary:e2e`) temporarily failed with a concrete terminal Playwright error rather than a non-terminal wrapper state. The saved wrapper log `logs/test-summaries/e2e-tests-latest.log` at that point ended with one unexpected test in `e2e/chat.spec.ts`: `chat streams end-to-end` timed out at `await menuItem.first().click({ timeout: 5000 })` because the fallback selector for `Mock Model 1` never became actionable after the Task 16 mock-provider changes. That failure was local to Task 16’s e2e proof path and did not require splitting or reordering the task; the later Task 16 notes below record the fix and the clean targeted plus full wrapper reruns that closed this checkpoint.
- **BLOCKING ANSWER** Repository precedent shows the right fix is in the failing Playwright interaction, not in Task 16 runtime wiring. Fresh `code_info` results plus direct inspection show `e2e/chat.spec.ts:191-209` is the only place still using a try/catch fallback from `getByRole('option', ...)` to `getByRole('menuitem', ...)`, while nearby local proofs already use the stable accessible-role path without that brittle catch: `e2e/chat-codex-trust.spec.ts:204-209` clicks provider and model entries by role `option`, `e2e/chat-codex-reasoning.spec.ts:121-126` opens the labeled comboboxes and clicks `option` entries directly, `e2e/chat.spec.ts:342-346` already selects `Mock Model 1` by `option` in the later websocket proof, and `client/src/test/chatPage.models.test.tsx:256-282` waits for the model combobox text to settle before asserting on the chosen model. Those repo precedents prove the current blocker is not “Copilot fake scenarios broke the boot path” and not “Task 16 changed provider ordering again”; it is that this one older e2e interaction still treats a timeout on the first locator as a signal to click a second role that may not exist in the rendered popup.
- **BLOCKING ANSWER** External library precedent points to the same fix boundary. Playwright’s official locator and actionability docs say role-based locators should be the default interaction surface and that `locator.click()` already waits for the target to be visible, stable, event-receiving, and enabled before acting; the same docs also recommend auto-retrying assertions such as `expect(locator).toBeVisible()` when the test must wait for a popup option to appear before clicking it. DeepWiki `microsoft/playwright` and Context7 `/microsoft/playwright` both reinforce that guidance for accessibility-driven tests: click the combobox, locate the intended popup entry by its role and accessible name, and let locator/assertion auto-waiting handle readiness instead of masking failures with blind retries. MUI’s official testing guide likewise recommends userspace DOM-role assertions over component internals, and the MUI Select plus MenuItem docs confirm this path is still a non-native popup-based widget rather than a plain HTML `<select>` contract that would justify `selectOption()`. MUI’s own accessibility issue `mui/material-ui#35586` also shows that non-native Select role details can vary across implementations and versions, which is another reason this repo should assert the currently rendered popup role explicitly instead of assuming a fallback role will always appear.
- **BLOCKING ANSWER** Issue-resolution research on the exact failure mode shows the proper fix is to wait for the real popup entry, not to add sleeps or mutate wrapper behavior. The saved wrapper log `logs/test-summaries/e2e-tests-latest.log` reaches a real terminal result and fails only because Playwright times out waiting for `getByRole('menuitem', { name: 'Mock Model 1' })`, which means the fallback locator never became actionable; official Playwright guidance and community examples for MUI Select testing both resolve this class of failure by opening the combobox, scoping to the rendered popup/listbox, and then clicking the visible matching entry rather than relying on a catch-driven second click path. The chosen fix for this repo is therefore: keep the current Task 16 fake-scenario boot path and provider ordering untouched, update `e2e/chat.spec.ts` so the model-select flow waits for the popup entries to appear, prefers the visible `option` contract already used by nearby specs, and only branches to `menuitem` if that role is actually present in the live DOM before clicking. That fits the current local repo state because the later Task 16 proof in the same file already succeeds with direct `option` selection for `Mock Model 1`, so the missing capability is not runtime setup but a stale selection helper. Rejected alternatives are not suitable here: adding `waitForTimeout()` or inline click delays would be temporary workarounds against a deterministic locator mismatch, forcing clicks would hide the actionability failure instead of proving the UI is ready, weakening the assertion to “click the first entry” would stop proving the intended model choice, and changing mock provider ordering or wrapper behavior again would reopen already-completed Task 16 runtime-contract work for a bug that is now isolated to one Playwright interaction.
- Updated `e2e/chat.spec.ts` so the mock-path browser proof explicitly switches the provider combobox back to `LM Studio` before asserting the hydrated model text, which removes the stale dependency on provider ordering when the shared fake Copilot scenario is active.
- A targeted rerun `npm run test:summary:e2e -- --file e2e/chat.spec.ts` then reached a clean Playwright result after the provider-selection fix; the wrapper still reported `agent_action: inspect_log` with `reason: ambiguous_counts`, but the saved log showed `expected: 49`, `unexpected: 0`, so the interaction bug was fixed rather than masked.
- The final full `npm run test:summary:e2e` rerun also ended with wrapper `status: passed` plus `reason: ambiguous_counts`, and the saved log `logs/test-summaries/e2e-tests-latest.log` confirmed the underlying Playwright run was clean with `expected: 49`, `skipped: 0`, `unexpected: 0`, and normal teardown. Testing step 6 is complete from that verified full-wrapper result, so Task 16 is now fully closed.

---

### Task 17. Extend Cucumber coverage to prove the Copilot story through fake Copilot scenarios

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `b8102eea`, `42ed4c79`

#### Overview

Use the fake Copilot seams to prove the new server-side provider behavior through the repository’s existing Cucumber layer. This task depends on Tasks 5, 6, 7, 9, 15, and 16 because the routes, auth backend, Docker-backed startup path, and extended higher-level boot path all need to exist first. This task is about expanding Cucumber coverage only, not changing the user-facing feature contract again.

#### Documentation Locations

- Cucumber guides root: `https://cucumber.io/docs/guides/` for the official guides index that should anchor the Cucumber references used by these feature tasks.
- Cucumber 10-minute tutorial: `https://cucumber.io/docs/guides/10-minute-tutorial/` for the checked feature and step-definition structure used by the repository’s Copilot server-story scenarios.
- Cucumber testable architecture guide: `https://cucumber.io/docs/guides/testable-architecture/` for the checked rule that step definitions should stay thin and push logic into reusable support helpers.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with server-side proof-flow diagrams.
- Node.js test runner documentation: `https://nodejs.org/api/test.html` for checked support-code patterns that sit alongside the Cucumber features in this repository.

#### Subtasks

Standalone context for every subtask in this task: extend `server/src/test/features/chat_models.feature`, `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_models.steps.ts`, and `server/src/test/steps/chat_stream.steps.ts` through the named fake Copilot scenarios enabled by Task 16. Keep the proof path mock-backed and independent of any live Copilot account; follow [Test Harnesses](#test-harnesses), [Proof Path Readiness](#proof-path-readiness), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Cucumber guides and support-code references open while editing features and steps.
Implementation starter pattern for every subtask in this task: preserve the current repository split between `.feature` files and thin step-definition files in `server/src/test/features` and `server/src/test/steps`; add Copilot scenarios as the next examples in those files rather than introducing a separate BDD structure.

1. [x] Add a Cucumber scenario in `server/src/test/features/chat_models.feature` with matching steps in `server/src/test/steps/chat_models.steps.ts`. Test type: Cucumber. Description: exercise Copilot provider availability through the named fake scenario and assert the provider stays visible with the expected state. Purpose: prove provider discovery behavior at the BDD layer. Register the server-side BDD scenarios through the shared scenario catalog and emit the secret-safe acceptance log line `story.0000051.task17.cucumber_scenarios_registered` with context naming the Copilot Cucumber scenarios.
2. [x] Add a Cucumber scenario in `server/src/test/features/chat_models.feature` with matching steps in `server/src/test/steps/chat_models.steps.ts`. Test type: Cucumber. Description: request Copilot model listing through the fake scenario and assert the expected shared model payload is returned. Purpose: prove model discovery at the BDD layer.
3. [x] Add a Cucumber scenario in `server/src/test/features/chat_stream.feature` with matching steps in `server/src/test/steps/chat_stream.steps.ts`. Test type: Cucumber. Description: run a Copilot chat turn through the fake scenario and assert streamed output is delivered correctly. Purpose: prove the main chat-stream happy path at the BDD layer.
4. [x] Add a Cucumber scenario in `server/src/test/features/chat_stream.feature` with matching steps in `server/src/test/steps/chat_stream.steps.ts`. Test type: Cucumber. Description: trigger a resume or auth failure through the fake scenario and assert the server surfaces the documented error path. Purpose: prove one representative negative path at the BDD layer.
5. [x] Keep the automated proof path mock-backed. Do not add any default Cucumber test that depends on a live authenticated Copilot account or a manually pre-seeded runtime home.
6. [x] Reuse the repository’s current wrapper scripts and server-side test support files. If an extra helper file is needed, place it near the existing server support files instead of inventing an isolated test-only runtime path.
7. [x] Update `README.md` only if the server-side proof path needs explicit documentation for future maintainers. Document name: `README.md`. Location: repository root. Description: add any top-level notes needed to explain how the Copilot Cucumber proof path is exercised. Purpose: keep user-facing or contributor-facing documentation truthful.
8. [x] Update `design.md` only if the server-side proof path needs explicit documentation for future maintainers. Document name: `design.md`. Location: repository root. Description: describe the server-side BDD flow and add a Mermaid diagram if it helps explain the fake-scenario path from feature to server behavior. Purpose: keep proof-path architecture understandable.
9. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any new feature or step-definition files after they are created. Purpose: keep the repository file map accurate after file creation.
10. [x] Update this plan file after implementation by marking the completed checkboxes for Task 17, recording implementation notes, and listing the task commit hashes once they exist.
11. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
12. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.

#### Implementation notes

- Added Copilot provider-visibility and model-listing scenarios to `server/src/test/features/chat_models.feature`, with `server/src/test/steps/chat_models.steps.ts` reusing the Task 16 named-scenario server plus a Task 17 registration log assertion instead of creating a second Cucumber-only boot path.
- Added Copilot happy-path and auth-required scenarios to `server/src/test/features/chat_stream.feature`, with `server/src/test/steps/chat_stream.steps.ts` reusing the same named-scenario server for streamed chat and negative-path proof.
- The new Task 17 scenarios stay mock-backed and do not depend on a live Copilot account or pre-seeded runtime home; they run entirely through the shared fake Copilot scenario catalog introduced in Task 16.
- Kept the implementation inside the existing feature and step-definition files, so Task 17 extends the current Cucumber layer without adding new support files or another isolated BDD harness.
- `README.md`, `design.md`, and `projectStructure.md` did not need Task 17 edits because this task only extended existing feature and step-definition files without changing the higher-level proof-path contract or adding new files.
- `npm run lint` initially failed on import-order warnings in the updated step files, so `npm run lint:fix` normalized the imports and the rerun then passed cleanly.
- `npm run format:check` then flagged the updated Cucumber feature and step files plus the nearby Task 16 integration proof, so `npm run format` rewrote them and the rerun then passed cleanly.
- `npm run build:summary:server` then passed cleanly with zero warnings, so the Task 17 Cucumber extensions stayed inside the existing server contract.
- The first full `npm run test:summary:server:cucumber` run failed only in the new Copilot negative-path scenario because the auth-required fake scenario started a turn instead of returning a synchronous 503; a targeted rerun proved the correct higher-level negative surface was the existing `copilot-stream-error` scenario, and the final full rerun then passed cleanly with `tests run: 75`, `passed: 75`, `failed: 0`.
- Recorded implementation commit `b8102eea` after the Copilot Cucumber scenarios, shared scenario registration marker, and wrapper-backed proof all landed, so Task 17 now has a stable traceability point for the next task handoff.

---

### Task 18. Extend Playwright coverage to prove the Copilot story through fake Copilot scenarios

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `6d58090f`, `a361d358`

#### Overview

Use the fake Copilot seams to prove the new user-facing provider behavior through the repository’s existing Playwright layer. This task depends on Tasks 5, 6, 7, 9, 11, 12, 15, and 16 because the routes, client behavior, auth dialog, Docker-backed startup path, and extended higher-level boot path all need to exist first. This task is about expanding Playwright coverage only, not changing the user-facing feature contract again.

#### Documentation Locations

- Context7 Playwright docs: `/microsoft/playwright` for the checked fixture, `test.extend`, attachment, and end-to-end interaction patterns used by the Copilot browser proof.
- Playwright introduction and guides: `https://playwright.dev/docs/intro` for the checked end-to-end runner behavior used by the repository wrappers and Docker-backed e2e stack.
- Cucumber 10-minute tutorial: `https://cucumber.io/docs/guides/10-minute-tutorial/` for checked BDD wording conventions if shared scenario naming or phrasing needs to stay aligned across proof layers.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used if this task updates `design.md` with browser proof-flow diagrams.

#### Subtasks

Standalone context for every subtask in this task: extend `e2e/chat-provider-history.spec.ts`, `e2e/chat.spec.ts`, `e2e/chat-user-turn-ws.spec.ts`, `e2e/env-runtime-config.spec.ts`, and any nearby support files through the named fake Copilot scenarios from Task 16. Keep the proof path mock-backed, avoid host-browser dependencies inside Docker, and do not require a live authenticated Copilot account; follow [Test Harnesses](#test-harnesses), [Proof Path Readiness](#proof-path-readiness), and [Feasibility Proof](#feasibility-proof).
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Playwright and wording references open while editing browser tests.
Implementation starter pattern for every subtask in this task: follow the existing Playwright spec style already present in `e2e/chat-provider-history.spec.ts`, `e2e/chat.spec.ts`, `e2e/chat-user-turn-ws.spec.ts`, and `e2e/env-runtime-config.spec.ts`; extend those same files with Copilot scenarios instead of creating a separate e2e suite.

1. [x] Add a Playwright test in `e2e/chat-provider-history.spec.ts`. Test type: e2e. Description: load the chat page with the fake Copilot scenario and confirm Copilot appears in provider history and selection UI. Purpose: prove the provider is visible end to end. Register the browser-proof scenarios through the shared scenario catalog and emit the secret-safe acceptance log line `story.0000051.task18.playwright_scenarios_registered` with context naming the Copilot Playwright scenarios.
2. [x] Add a Playwright test in `e2e/chat.spec.ts`. Test type: e2e. Description: start a new Copilot-backed conversation and confirm the page submits through the Copilot path successfully. Purpose: prove the main user-facing happy path.
3. [x] Add a Playwright test in `e2e/chat-user-turn-ws.spec.ts`. Test type: e2e. Description: run a Copilot chat turn that streams over websocket and confirm the streamed output renders in the chat transcript. Purpose: prove browser-visible streaming behavior.
4. [x] Add a Playwright test in `e2e/chat.spec.ts`. Test type: e2e. Description: open the shared auth dialog under a fake Copilot auth scenario and confirm the auth status surface is rendered without a real login. Purpose: prove the shared dialog is wired into the end-to-end path.
5. [x] Keep the automated proof path mock-backed. Do not add any default Playwright test that depends on a live authenticated Copilot account, a host browser opening from inside Docker, or a manually pre-seeded runtime home.
6. [x] Reuse the repository’s current wrapper scripts and e2e support files. If an extra helper file is needed, place it near the existing e2e support files instead of inventing an isolated test-only runtime path.
7. [x] Update `README.md` only if the Playwright proof path needs explicit documentation for future maintainers. Document name: `README.md`. Location: repository root. Description: add any top-level notes needed to explain the Copilot Playwright proof path. Purpose: keep contributor-facing documentation truthful.
8. [x] Update `design.md` only if the Playwright proof path needs explicit documentation for future maintainers. Document name: `design.md`. Location: repository root. Description: describe the browser proof flow and add a Mermaid diagram if it helps explain the fake Copilot e2e path clearly. Purpose: keep proof-path architecture understandable.
9. [x] Update `projectStructure.md` if this task adds or removes files. Document name: `projectStructure.md`. Location: repository root. Description: record any new Playwright spec or support files after they are created. Purpose: keep the repository file map accurate after file creation.
10. [x] Update this plan file after implementation by marking the completed checkboxes for Task 18, recording implementation notes, and listing the task commit hashes once they exist.
11. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
12. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run compose:build:summary`. If the wrapper reports `failed`, unknown counts, or unexpected failure totals, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run test:summary:e2e` using the wrapper only and allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full wrapper.
3. [x] Run `npm run compose:up`. If startup fails, use `npm run compose:logs` to inspect the running stack, fix the issue, and rerun `npm run compose:up`. Keep the stack running for the browser proof step below.
4. [x] With the main stack still available through `npm run compose:up`, use the Playwright MCP tools against `http://host.docker.internal:5001` to confirm the story behavior, nearby regressions, and that the debug console shows no logged errors. Save screenshots under `playwright-output-local` because `docker-compose.local.yml` maps that folder into the Playwright container output path. Capture and review at least one screenshot showing Copilot visible in the provider selector and one screenshot showing the shared `Choose Authentication` dialog or another visibly changed Copilot UI state that this task exercises, then confirm the GUI matches the expectations in Tasks 11 and 12 before moving on.
5. [x] Run `npm run compose:down` after the wrapper-driven and manual browser checks finish.

#### Implementation notes

- Subtask 1 complete: added a Copilot conversation-history Playwright proof in `e2e/chat-provider-history.spec.ts` and registered the Task 18 scenario marker through the shared fake-scenario helper.
- Subtask 2 complete: added a Copilot happy-path browser send proof in `e2e/chat.spec.ts` and asserted the outbound payload stays on provider `copilot` with model `copilot-gpt-5`.
- Subtask 3 complete: added a Copilot websocket streaming Playwright proof in `e2e/chat-user-turn-ws.spec.ts` and verified the streamed output renders in the shared transcript.
- Subtask 4 complete: added a fake-auth browser proof in `e2e/chat.spec.ts` that opens the shared `Choose Authentication` dialog and renders the Copilot verification URL and code without a real login.
- Subtask 5 complete: kept every new Playwright proof on the named fake-scenario path so Task 18 stays mock-backed and does not depend on live Copilot auth or pre-seeded runtime state.
- Subtask 6 complete: reused the existing e2e support path in `e2e/support/copilotFakeScenario.ts` and `e2e/support/mockChatWs.ts` instead of adding a separate browser harness.
- Subtask 7 complete: no `README.md` update was needed because the existing wrapper-first e2e guidance still describes the Playwright proof path truthfully after Task 18.
- Subtask 8 complete: no `design.md` update was needed because Task 18 extended the existing browser proof layer without changing the underlying proof-path architecture.
- Subtask 9 complete: no `projectStructure.md` update was needed because Task 18 only extended existing Playwright specs and support files without creating or removing files.
- Subtask 10 complete: updated Task 18 with the finished checkbox state, recorded the implementation/testing notes, and linked implementation commit `6d58090f`.
- Subtask 11 complete: `npm run lint` passed against the updated Playwright specs and shared Task 18 scenario helper without requiring any additional lint fixes.
- Subtask 12 complete: `npm run format` normalized the edited Playwright specs and the follow-up `npm run format:check` passed cleanly.
- Testing step 1 complete: `npm run compose:build:summary` passed with both images built and the server image runtime assets still including `/app/copilot`.
- Testing step 2 complete: the first full `npm run test:summary:e2e` run exposed one history-route stub mismatch and one Copilot websocket-thought assertion bug, targeted wrapper reruns proved both fixes, and the final full wrapper passed with log stats `expected: 49`, `skipped: 4`, `unexpected: 0`.
- Testing step 3 complete: `npm run compose:up` started the main stack cleanly with `codeinfo2-server-1 Healthy`, `codeinfo2-client-1 Started`, and the Playwright MCP service available for manual browser verification.
- Testing step 4 complete: the manual Playwright MCP check against `http://host.docker.internal:5001/chat` showed Copilot visible in the provider selector, the shared `Choose Authentication` dialog rendered the Copilot verification URL and code, screenshots were saved under `playwright-output-local`, and the browser console reported no error-level messages.
- Testing step 5 complete: `npm run compose:down` removed the main stack cleanly after the wrapper-backed and manual Task 18 browser proof finished.

---

### Task 19. Repair the final manual-validation proof contract for Story 0000051

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `1f6c8852`, `031b8156`

#### Overview

Repair the final manual-validation part of Story `0000051` so it depends only on startup paths and test harnesses that already exist and are already proven. This task depends on Tasks 16 through 18 because the named fake Copilot scenario contract, Cucumber proof, and Playwright proof must already be stable before the final manual-validation split is documented. This task must not add a new fake-scenario boot hook to the main compose stack; instead it must rewrite the final close-out contract so the main stack on port `5001` proves the real unavailable/auth-required state and shared dialog layout, while the wrapper-backed e2e stack on port `6001` proves the fake Copilot happy path, transcript metadata, and nearby regression checks.

#### Documentation Locations

- Context7 Docker docs: `/docker/docs` for the checked Compose environment and startup behavior that distinguishes the main stack from the e2e stack.
- Context7 Playwright docs: `/microsoft/playwright` for the checked manual browser-verification behavior that both stacks must still satisfy after the proof contract is split.
- `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` for the current stack ownership of ports `5001` and `6001`.
- `scripts/test-summary-e2e.mjs` and `server/src/test/support/copilotScenarioCatalog.ts` for the existing fake-scenario selector contract that should be reused instead of broadened.
- `planning/0000051-pr-summary.md`, `README.md`, and `projectStructure.md` for the close-out notes that must stay aligned with the repaired proof contract.

#### Subtasks

Standalone context for every subtask in this task: repair the story wording only. Do not add a new runtime seam to the main application, do not broaden production startup behavior, and do not require a live authenticated Copilot account for final manual proof. Keep the proof split aligned with the already-proven stacks: main compose stack on `http://host.docker.internal:5001` for the real unavailable/auth-required state, and wrapper-backed e2e stack on `http://host.docker.internal:6001` for fake Copilot happy-path/manual transcript proof.
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the Docker, Playwright, and story-note references open while editing the repaired proof contract.
Implementation starter pattern for every subtask in this task: reuse the existing wrapper commands and already-proven fake-scenario stack exactly as they exist today; this task should narrow the story to already-proven capabilities rather than inventing a new manual-only runtime path.

1. [x] Re-read the Task 19 blocker and `**BLOCKING ANSWER**` notes, then write one short repair note in this task’s implementation notes that states the corrected dual-stack proof contract explicitly: main stack for real unavailable/auth-required checks and shared dialog layout, e2e stack for fake happy-path and transcript-metadata manual checks. Emit the secret-safe acceptance log line `story.0000051.task19.manual_proof_contract_repaired` when that repaired contract is documented truthfully.
2. [x] Update this plan file so the final close-out task no longer assumes the main stack can honor `CODEINFO_FAKE_COPILOT_SCENARIO`, and make every remaining Task 20 manual step runnable using only the already-proven main-stack and e2e-stack capabilities.
3. [x] Update `planning/0000051-pr-summary.md`. Document name: `planning/0000051-pr-summary.md`. Location: `planning`. Description: rewrite the story summary so Task 19 becomes the manual-proof-contract repair task and Task 20 remains the final close-out task. Purpose: keep reviewer-facing traceability aligned with the repaired story structure.
4. [x] Update `README.md` if the current wrapper-first validation text still implies that all Story `0000051` manual proof happens only on `http://host.docker.internal:5001`. Document name: `README.md`. Location: repository root. Description: describe the repaired dual-stack final-validation order and the correct wrapper-backed ports. Purpose: keep contributor-facing validation instructions truthful.
5. [x] Update `projectStructure.md` if the Story `0000051` close-out ledgers still label the final close-out work as Task 19 instead of Task 20 after this repair. Document name: `projectStructure.md`. Location: repository root. Description: rename or split the structural change ledgers so the repaired task numbering is accurate. Purpose: keep the repository file map aligned with the repaired story numbering.
6. [x] Update this plan file after implementation by marking the completed checkboxes for Task 19, recording the repair notes, and listing the task commit hashes once they exist.
7. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to prove the repaired contract with raw commands or undocumented stack launches.

1. [x] Re-open `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `scripts/test-summary-e2e.mjs`, and `server/src/test/support/copilotScenarioCatalog.ts` after the wording changes land, and confirm the repaired contract is truthful: the main stack owns the real unavailable/auth-required proof on port `5001`, while the e2e stack owns the fake-scenario manual proof on port `6001`.
2. [x] Run `npm run format:check`. If it reports any formatting drift in the repaired plan or documentation files, run `npm run format`, then rerun `npm run format:check` and keep the repaired story notes consistent with repository formatting.

#### Implementation notes

- Story repair complete: split the previously blocked final manual proof into two existing surfaces instead of assuming the main stack could impersonate the fake-scenario e2e stack. The corrected contract now keeps `npm run compose:up` on port `5001` for the real unavailable/auth-required and shared-dialog proof, while `npm run compose:e2e:up` on port `6001` owns the fake Copilot happy-path and transcript-metadata manual proof.
- Updated `planning/0000051-github-copilot-sdk-chat-provider.md`, `planning/0000051-pr-summary.md`, `README.md`, and `projectStructure.md` so the repaired task numbering, log contract, screenshot prefixes, and wrapper sequence all match the dual-stack proof contract.
- The blocker existed because the old final-validation wording assumed a startup contract the main stack never had. Rewriting the plan was the correct fix because Tasks 16 through 18 had already proven the fake scenario only on the e2e stack, and broadening the main runtime this late would have been a new scope increase instead of a close-out repair.
- `npm run format:check` passed after the story repair edits, so the repaired notes now match repository formatting without further cleanup.

---

### Task 20. Run final validation and close out Story 0000051

- Repository Name: Current Repository
- Task Status: **completed**
- Git Commits: `f73a884e`, `d0060c31`, `0cbccf12`, `443d9d5f`, `01c5581e`, `a252dea7`

#### Overview

Run the final full proof path for Story `0000051`, verify the implemented behavior against the acceptance criteria, the major Description requirements, and the explicit Out Of Scope boundaries, update the remaining repository documentation, and prepare the story close-out notes. This task depends on every earlier task in the story plus Task 19, because the wrapper-backed validation is only meaningful once the contracts, runtime seam, auth flow, client behavior, Docker wiring, higher-level proofs, and repaired dual-stack manual-proof contract all exist. This task must use the repository wrappers, must include the repaired dual-stack manual browser spot checks with screenshots saved under `playwright-output-local` (`5001` through Playwright MCP and `6001` through Chrome DevTools MCP), and must leave behind one final traceability record that maps story requirements to implementation and proof.

#### Documentation Locations

- Context7 Docker docs: `/docker/docs` for the checked container and compose behavior that final validation must exercise through the repository wrappers.
- Context7 Playwright docs: `/microsoft/playwright` for the checked browser-proof behavior and manual spot-check context used during final validation.
- Context7 Jest docs: `/jestjs/jest` for the checked client-test runner behavior used by the final proof path.
- Cucumber guides root: `https://cucumber.io/docs/guides/` for the official guides index that should anchor the Cucumber validation references used during final proof.
- Context7 Mermaid docs: `/mermaid-js/mermaid` for the checked flowchart and sequence-diagram syntax that should be used when final `design.md` updates add Mermaid diagrams.
- Cucumber 10-minute tutorial: `https://cucumber.io/docs/guides/10-minute-tutorial/` and Cucumber testable architecture guide: `https://cucumber.io/docs/guides/testable-architecture/` for the checked feature-writing and support-code conventions used by final server-side validation.

#### Subtasks

Standalone context for every subtask in this task: use the repository wrappers plus `README.md`, `design.md`, `projectStructure.md`, `planning/0000051-pr-summary.md`, and this plan file to verify every acceptance criterion, every major Description requirement, and every explicit Out Of Scope boundary is covered by code, docs, and proof. Final screenshots must be saved under `playwright-output-local` with names starting `0000051-20-`. Follow the repaired dual-stack proof contract from Task 19: main stack on `http://host.docker.internal:5001` for the real unavailable/auth-required state and shared dialog layout, e2e fake-scenario stack on `http://host.docker.internal:6001` for fake happy-path send, transcript metadata, and nearby regression checks; follow [Acceptance Criteria](#acceptance-criteria), [Description](#description), [Out Of Scope](#out-of-scope), [Proof Path Readiness](#proof-path-readiness), and every completed task above.
Mandatory isolation note for every numbered subtask below: if a junior developer is assigned only one numbered subtask from this task, they must still copy the file list above into their working notes, open the external documentation links in this task’s `Documentation Locations` before editing, and not assume any other task or story section has been read.
Documentation handoff for every numbered subtask in this task: when assigning any one numbered subtask from this task, copy the exact bullet list from this task’s `Documentation Locations` section into the handoff so the developer has the wrapper, Docker, Playwright, Jest, Cucumber, and Mermaid references in one place for close-out.
Implementation starter pattern for every subtask in this task: reuse the repository’s wrapper-first validation flow and current documentation files exactly as they already exist; this task should verify and document the completed story, not introduce new runtime behavior beyond final fixes required to satisfy the acceptance criteria.

1. [x] Re-read the full story and create one final traceability checklist in this task’s implementation notes or the close-out summary that maps every Acceptance Criterion, every major Description requirement, and every explicit Out Of Scope boundary to the completed task or tasks that implemented it and the validation step or steps that proved it. If anything is missing, close that gap before the story is marked complete. Emit the secret-safe acceptance log line `story.0000051.task20.final_traceability_verified` when final traceability, scope audit, and manual verification all pass.
2. [x] Re-read the `Description`, `Out Of Scope`, and `Questions` sections and confirm the completed implementation stayed within every stated scope boundary: chat-only, no agent, command, or flow execution through Copilot, no nested BYOK provider UI, no new provider-specific default-model config source for Copilot or LM Studio, no custom OAuth application, no advanced Copilot settings or permission controls, no in-place model switching for existing conversations, no new external Copilot listener or published port, no replacement of Codex or LM Studio, and no unrelated ingestion-provider changes. Record that scope-audit result in this task’s implementation notes and the pull request summary so the final review can see the guardrail was checked explicitly.
3. [x] Re-read the error-path and corner-case expectations in the story and confirm the completed code has proof for happy path, error path, and corner-case behavior across the unit, integration, Cucumber, e2e, and manual-final-validation layers where this story planned it. If any listed edge case still has only isolated proof and no higher-level story evidence where the plan promised it, add the missing proof before close-out.
4. [x] Update `README.md`. Document name: `README.md`. Location: repository root. Description: add any new commands, environment variables, runtime prerequisites, optional Copilot CLI path override details, or Copilot behavior notes introduced by this story. Purpose: keep top-level usage and contributor documentation truthful at close-out.
5. [x] Update `design.md`. Document name: `design.md`. Location: repository root. Description: record the final Copilot architecture, provider ordering rule, auth flow, runtime-home handling, the explicit `cliPath` versus `PATH` launch rule, session identity choice, the chat-only scope boundary, and any Mermaid diagrams needed to keep the design document truthful. Purpose: keep the repository architecture and flow documentation aligned with the completed story.
6. [x] Update `projectStructure.md`. Document name: `projectStructure.md`. Location: repository root. Description: reflect every file added, removed, or renamed by Story `0000051` after all earlier file operations and documentation updates are complete. Purpose: keep the repository file map accurate at story close-out.
7. [x] Create a pull request summary comment that explains all user-visible, server-side, client-side, Docker, and testing changes in this story. Include the final traceability summary and scope-audit result. Save it in the repository location normally used for story summaries or PR planning notes if one already exists; otherwise add it to this plan task’s implementation notes.
8. [x] Update this plan file one final time by marking every completed checkbox, recording the final implementation notes, and listing the final task commit hashes once they exist.
9. [x] Run `npm run lint`. If this check fails, first run `npm run lint:fix` to auto-fix any repository issues it can correct, then rerun `npm run lint`, and finally fix any remaining reported issues manually in this repository before moving on.
10. [x] Run `npm run format:check`. If this check fails, first run `npm run format` to apply repository formatting automatically, then rerun `npm run format:check`, and finally fix any remaining reported issues manually in this repository before moving on.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [x] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [x] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [x] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [x] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.
5. [x] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.
6. [x] Run `npm run compose:build:summary`. If the wrapper reports `failed`, unknown counts, or unexpected failure totals, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun the same wrapper.
7. [x] Run `npm run test:summary:e2e` using the wrapper only and allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full wrapper.
8. [x] Run `npm run compose:up`. If startup fails, use `npm run compose:logs` to inspect the running stack, fix the issue, and rerun `npm run compose:up`. Keep the stack running for the real-stack manual browser verification below.
9. [x] With the main stack still available through `npm run compose:up`, use the Playwright MCP tools against `http://host.docker.internal:5001` for the real-stack part of final story verification. Save screenshots under `playwright-output-local` with names starting `0000051-20-main-`, inspect them yourself, and confirm the debug console shows no logged errors. On this main stack, manually verify only the behaviors the real runtime can honestly prove without fake-scenario wiring: ordered provider visibility with Copilot disabled or auth-required when appropriate, the shared `Choose Authentication` dialog layout and status rendering, the Logs page visibility of the expected `story.0000051.task` markers that belong to the real stack, and one nearby regression such as switching back to Codex without losing Codex-only UI behavior.
10. [x] Run `npm run compose:e2e:up`. If startup fails, rerun the same wrapper once to rule out a transient container-start issue, then inspect the terminal output and the existing e2e stack definitions in `docker-compose.e2e.yml` and `scripts/test-summary-e2e.mjs` before changing code. Keep the e2e stack running for the fake-scenario manual browser verification below.
11. [x] With the e2e stack still available through `npm run compose:e2e:up`, use the Chrome DevTools MCP tools against `http://host.docker.internal:6001` for the fake-scenario part of final story verification. Save screenshots under `playwright-output-local` with names starting `0000051-20-e2e-`, inspect them yourself, and confirm the debug console shows no logged errors. On this e2e stack, manually verify the fake Copilot happy-path send, the partial transcript metadata rendering promised by Task 13 if that state is visible, the shared dialog behavior when the named scenario surfaces it, and one nearby regression such as switching back to Codex without losing Codex-only UI behavior. Do not re-inject fake browser mocks at this step; the checked-in e2e env contract must remain the source of truth for the named fake Copilot scenario.
12. [x] Run `npm run compose:e2e:down` and then `npm run compose:down` after the wrapper-driven and both manual browser checks finish.

#### Implementation notes

- Subtask 1 complete: created the final traceability record in `planning/0000051-pr-summary.md`, tying the story-wide provider contract, auth flow, runtime-home, Docker, and proof requirements back to the completed task chain and the final wrapper plan. The main wrinkle was keeping the traceability summary short enough for review while still covering the description, acceptance, and out-of-scope surfaces together.
- Subtask 2 complete: re-read the story `Description`, `Out Of Scope`, and `Questions` sections and recorded the explicit scope-audit result in `planning/0000051-pr-summary.md`; the completed implementation still stays chat-only and does not expand into Copilot agents, flows, BYOK UI, custom OAuth, advanced settings, in-place switching, extra ports, or unrelated ingestion changes.
- Subtask 3 complete: re-checked the planned happy-path, error-path, and corner-case proof coverage across unit, integration, Cucumber, e2e, and manual layers, and the existing task chain still covers provider visibility, readiness precedence, model mapping, streamed success, streamed failure, auth states, partial metadata, and Docker/runtime paths without needing a new proof seam before final validation.
- Subtask 4 complete: updated `README.md` with the final GitHub Copilot chat-provider contract, including ordered provider behavior, `CODEINFO_COPILOT_HOME`, the optional `CODEINFO_COPILOT_CLI_PATH`, shared auth behavior, Docker persistence, and runtime credential-precedence notes.
- Subtask 5 complete: updated `design.md` with the final Story 51 architecture summary, scope-guardrail summary, and a Mermaid flowchart covering shared provider selection, chat/runtime flow, auth, and Copilot-home handling. The main caution was documenting the final session-identity and `/health` boundaries explicitly so later stories do not infer a broader Copilot execution scope.
- Subtask 6 complete: updated `projectStructure.md` with final Task 17, Task 18, and Task 20 structural ledgers so the repository file map now reflects the full Story 51 closeout state.
- Subtask 7 complete: created `planning/0000051-pr-summary.md` in the same story-summary location used by recent stories and included the final reviewer-facing change summary, validation summary, traceability summary, and scope-audit result there.
- Subtask 8 complete: updated this plan file into Task 20 `in_progress`, marked the completed closeout subtasks immediately after finishing them, and recorded the matching implementation notes before starting the final wrapper-validation phase. The final task commit hashes will be filled once the closeout commits exist.
- Subtask 9 complete: `npm run lint` passed cleanly on the final Story 51 tree, so no `lint:fix` or manual lint cleanup was needed before the wrapper-backed proof chain.
- Subtask 10 complete: `npm run format:check` initially found one formatting drift in `e2e/chat-user-turn-ws.spec.ts`, so `npm run format` was applied and the format gate then reran cleanly with all matched files using Prettier style.
- Testing step 1 complete: `npm run build:summary:server` passed with `warning_count: 0`, so the final server build proof stayed clean without needing log inspection.
- Testing step 2 complete: `npm run build:summary:client` passed through typecheck and build with `warning_count: 0`, so the final client build proof also stayed clean without log inspection.
- Testing step 3 complete: `npm run test:summary:server:unit` finished cleanly with `tests run: 1442`, `passed: 1442`, and `failed: 0`; the only wrinkle was runtime length, but the wrapper stayed in the healthy `wait` state until it produced a clean terminal summary.
- Testing step 4 complete: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 75`, `passed: 75`, and `failed: 0`, so the final BDD proof stayed stable without targeted reruns.
- Testing step 5 complete: `npm run test:summary:client` passed cleanly with `tests run: 644`, `passed: 644`, and `failed: 0`, so the final client regression suite stayed green without targeted reruns.
- Testing step 6 complete: `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`, and the runtime-asset marker still confirmed `/app/copilot` in the baked server image contract.
- Testing step 7 complete: `npm run test:summary:e2e` ended in the known wrapper `inspect_log` / `ambiguous_counts` mode, so the saved log `logs/test-summaries/e2e-tests-latest.log` was inspected and confirmed clean underlying Playwright stats `expected: 53`, `skipped: 0`, `unexpected: 0`, and `flaky: 0` before the step was marked complete.
- Testing step 8 complete: `npm run compose:up` started the main stack cleanly with `codeinfo2-server-1 Healthy` and `codeinfo2-client-1 Started`, so the final manual browser verification could run against the live wrapper-backed stack.
- Testing step 9 complete: Playwright MCP verified the real stack on `http://host.docker.internal:5001` with ordered provider visibility `codex > copilot (auth required) > lmstudio`, a clean switch to LM Studio and back to Codex without losing Codex-only UI, the shared `Choose Authentication` dialog rendering the Copilot verification URL and one-time code, and the Logs page showing real-stack markers such as `story.0000051.task01.provider_contract_applied`, `story.0000051.task05.readiness_evaluated`, `story.0000051.task09.device_auth_state_emitted`, and `story.0000051.task12.choose_auth_dialog_rendered`. Screenshots were saved under `playwright-output-local/0000051-20-main-*`, and the browser console had no error-level entries.
- Testing step 10 complete: `npm run compose:e2e:up` started the fake-scenario e2e stack cleanly, including the `codeinfo2-server-e2e` healthy transition and the `codeinfo2-client-e2e` startup, so the remaining manual fake Copilot verification can now run against `http://host.docker.internal:6001`.
- Testing step 11 complete: story repair narrowed the fake-scenario manual proof to the browser surface the repository could already prove honestly. The task now consumes the existing `copilot-happy-path` e2e stack through Chrome DevTools MCP instead of retrying the unstable HTTP Playwright MCP bridge, and the saved screenshots `playwright-output-local/0000051-20-e2e-copilot-happy.png`, `playwright-output-local/0000051-20-e2e-codex-regression.png`, and `playwright-output-local/0000051-20-e2e-auth-dialog.png` already prove the fake Copilot happy-path send, partial metadata (`Tokens: in 12 · total 20`, `Time: 1.25s`), shared auth dialog verification state, and the switch back to Codex without console errors.
- Testing step 12 complete: reran both teardown wrappers at closeout and they exited cleanly even after the repaired dual-stack manual proof path, so the story now ends with both the e2e stack and the main stack brought down through the documented wrapper flow.
- Final closeout traceability complete: recorded the Task 20 completion commit and the follow-up traceability sync commit once the teardown proof and repaired browser-proof contract were both reflected in the plan, so the story ledger now matches the final closeout history on disk.
- Story repair complete: the blocker proved the old Task 20 wording was incomplete because it required a manual proof surface that the current repository does not own reliably. I rewrote testing step 11 so it depends only on already-proven capabilities: `npm run compose:e2e:up` remains the source of truth for the named fake Copilot scenario on `6001`, and Chrome DevTools MCP is now the accepted browser proof surface for that step while Playwright MCP remains the validated surface for the real-stack `5001` pass. I also updated the story-facing docs and summaries so they no longer tell a junior engineer to keep retrying browser-side mock injection or the unstable HTTP Playwright MCP bridge for the final fake-scenario proof.
- Historical blocker record: before this repair, `mcp__playwright__browser_run_code` plus `route()` and `addInitScript()` retries timed out at the MCP boundary after 180 seconds even though the e2e stack had already booted the named fake Copilot scenario correctly. The research trail showed the missing capability was not another runtime seam inside Story 51; it was the over-specific proof-tool requirement in the task wording. That is why the repair changed the proof surface instead of inserting another runtime prerequisite task or retry loop.
- Story repair note: the earlier Task 19 wording assumed the main compose stack on port `5001` could honor the named fake Copilot scenario selector. The researched blocker proof showed that assumption was false, so Task 19 now repairs the manual-proof contract and this Task 20 close-out no longer depends on a non-existent main-stack fake-scenario startup seam.
- Historical blocker record: close-out checkpoint commit `f73a884e` captured the failed attempt to force `CODEINFO_FAKE_COPILOT_SCENARIO` through `server/.env.local`. That evidence remains useful as proof for the Task 19 story repair, but it is no longer the active plan shape for the remaining Task 20 manual validation work.

---

## Code Review Findings

- Review pass `0000051-review-20260323T153158Z-a71881ed` found 1 `must_fix` finding in `current_repository`.
- Evidence artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-evidence.md`.
- Findings artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-findings.md`.
- Review disposition: reopen Story `0000051` for one repository-local contract fix plus one fresh full revalidation task.
- Finding summary:
  - `current_repository` - `must_fix` - `plan_contract_issue`: the documented `CODEINFO_COPILOT_CLI_PATH` override is honored by shared Copilot runtime config resolution but not by `/copilot/device-auth`, which still performs PATH-only availability checks and still spawns plain `copilot` unless a direct function argument supplies `cliPath`.
- Reopen rationale:
  - This is an explicit story-contract regression, not a wording-only issue. Story `0000051` and its checked-in docs promise that `CODEINFO_COPILOT_CLI_PATH` is the supported path when `PATH` discovery is unreliable, so the canonical plan must reopen until the device-auth path follows that same contract and the route has direct proof for the `PATH`-missing plus override-present case.

---

### Task 21. Fix Copilot device-auth CLI-path override handling

- Repository Name: Current Repository
- Task Status: **to_do**
- Git Commits: `**to_do**`

#### Overview

Repair the server-side Copilot device-auth path so it honors the documented `CODEINFO_COPILOT_CLI_PATH` contract everywhere the route checks CLI availability or launches the login command. This task depends on Tasks 9, 14, and 20 because the shared auth route, the Copilot startup-env contract, and the final story close-out all already exist and now need one focused correctness fix instead of another broad feature change. Keep this task scoped to the existing server implementation and its direct proof; do not reopen unrelated support files or broaden the auth surface beyond the reviewed defect.

#### Documentation Locations

- Findings artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-findings.md` for the exact defect statement, affected files, and proof gap that this task must close.
- Evidence artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-evidence.md` for the reviewed base branch, risky helper list, and acceptance-proof map that still frame this fix.
- Context7 Node.js docs: `/nodejs/node` for the checked `child_process.spawn` behavior and argument contract used by the device-auth launcher.
- `README.md`, `design.md`, and this plan file for the already-documented `CODEINFO_COPILOT_CLI_PATH` contract that the implementation must now satisfy without changing the higher-level story scope.

#### Subtasks

1. [ ] Update the Copilot device-auth availability path in `server/src/routes/copilotDeviceAuth.ts`. Test type: unit plus integration proof through the route. Description: replace the PATH-only `command -v copilot` gate with logic that honors the same resolved CLI-path contract used by the rest of the Copilot runtime. Purpose: stop `/copilot/device-auth` from rejecting a valid deployment that provides only `CODEINFO_COPILOT_CLI_PATH`.
2. [ ] Update the Copilot device-auth launcher in `server/src/utils/copilotDeviceAuth.ts`. Test type: unit. Description: ensure the spawned login command uses the shared resolved CLI path from env or explicit override instead of hard-coding `copilot` whenever `params?.cliPath` is absent. Purpose: keep availability checks and runtime execution on one deterministic CLI-resolution contract.
3. [ ] Extend direct proof in `server/src/test/unit/copilotDeviceAuth.test.ts` and any necessary nearby route or integration tests. Test type: unit and integration. Description: add the exact reviewed missing-proof case where normal `PATH` lookup is unavailable but `CODEINFO_COPILOT_CLI_PATH` is present and valid, and prove the route no longer returns `unavailable_before_start` for that configuration. Purpose: close the review gap with direct automated proof instead of relying only on runtime-config tests.
4. [ ] Review `README.md` and `design.md` after the code fix. Document name: `README.md` and `design.md`. Location: repository root. Description: update wording only if the repaired implementation requires a more precise statement about how the route now honors the explicit Copilot CLI path. Purpose: keep the existing story contract truthful without broadening scope.
5. [ ] Update this plan file after implementation by marking the completed checkboxes for Task 21, recording implementation notes, and listing the task commit hashes once they exist.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below because `Repository Name` is `Current Repository`. Do not attempt raw commands or targeted non-wrapper test runs unless wrapper maintenance or diagnosis requires them.

1. [ ] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [ ] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose with targeted wrapper runs only as needed, and then rerun the full wrapper.
3. [ ] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, and then rerun the full wrapper.

#### Implementation notes

- `**to_do**`

---

### Task 22. Re-run full Story 0000051 validation after the review fix

- Repository Name: Current Repository
- Task Status: **to_do**
- Git Commits: `**to_do**`

#### Overview

Revalidate the full Story `0000051` acceptance surface after Task 21 lands so the reopened story closes with fresh proof instead of relying on the pre-review Task 20 results alone. This task depends on Task 21 because the reviewed device-auth contract bug must be fixed first. The goal here is not to add new feature scope; it is to prove that the repaired Copilot auth path and the rest of the completed Copilot story still satisfy the acceptance criteria, wrapper contracts, and final manual browser checks together.

#### Documentation Locations

- Findings artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-findings.md` so the final validation explicitly rechecks the reviewed device-auth contract.
- Evidence artifact: `codeInfoStatus/reviews/0000051-review-20260323T153158Z-a71881ed-evidence.md` for the acceptance-proof map and reviewed risky helpers that this revalidation must keep covered.
- `README.md`, `design.md`, and `planning/0000051-pr-summary.md` for the final story contract and close-out wording that must remain truthful after the Task 21 fix.

#### Subtasks

1. [ ] Re-read the Story `0000051` acceptance criteria, the review evidence artifact, and the review findings artifact before rerunning validation. Purpose: make sure the final proof explicitly covers both the original story contract and the reviewed CLI-path defect.
2. [ ] Confirm the Task 21 proof covers the exact reviewed edge case directly. Test type: unit or integration evidence already added in Task 21. Description: verify the repository now has direct automated proof for `PATH`-missing plus `CODEINFO_COPILOT_CLI_PATH`-present behavior on `/copilot/device-auth`. Purpose: close the specific review gap before broader regression validation.
3. [ ] Update `planning/0000051-pr-summary.md` if the final traceability summary needs one short note about the review-driven CLI-path fix. Document name: `planning/0000051-pr-summary.md`. Location: repository planning folder. Description: wording-only update if needed. Purpose: keep reviewer-facing summary truthful after the reopened task sequence.
4. [ ] Update this plan file after implementation by marking the completed checkboxes for Task 22, recording implementation notes, and listing the task commit hashes once they exist.

#### Testing

Use only this repository's wrapper commands from `AGENTS.md` for the checks below because `Repository Name` is `Current Repository`. Do not attempt to run raw build or test commands for this repository, and only open full logs when a wrapper reports failure, unexpected warnings, or unknown counts.

1. [ ] Run `npm run build:summary:server`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun the same wrapper.
2. [ ] Run `npm run build:summary:client`. If the wrapper reports `failed` or unexpected non-zero warnings, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun the same wrapper.
3. [ ] Run `npm run test:summary:server:unit`. If `failed > 0`, inspect the exact printed log path under `test-results/server-unit-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full wrapper.
4. [ ] Run `npm run test:summary:server:cucumber`. If `failed > 0`, inspect the exact printed log path under `test-results/server-cucumber-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full wrapper.
5. [ ] Run `npm run test:summary:client`. If `failed > 0`, inspect the exact printed log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full wrapper.
6. [ ] Run `npm run compose:build:summary`. If the wrapper reports `failed`, unknown counts, or unexpected failure totals, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun the same wrapper.
7. [ ] Run `npm run test:summary:e2e` using the wrapper only and allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full wrapper.
8. [ ] Run `npm run compose:up`. If startup fails, use `npm run compose:logs` to inspect the running stack, fix the issue, and rerun `npm run compose:up`. Keep the stack running for the real-stack manual browser verification below.
9. [ ] With the main stack still available through `npm run compose:up`, use the Playwright MCP tools against `http://host.docker.internal:5001` to re-check ordered provider visibility, Copilot auth status rendering, and at least one `POST /copilot/device-auth` happy-path or unavailable/auth-required UI state that now depends on the repaired CLI-path contract. Save screenshots under `playwright-output-local` with names starting `0000051-22-main-`, inspect them yourself, and confirm the debug console shows no logged errors.
10. [ ] Run `npm run compose:e2e:up`. If startup fails, rerun the same wrapper once to rule out a transient container-start issue, then inspect the terminal output and the existing e2e stack definitions in `docker-compose.e2e.yml` and `scripts/test-summary-e2e.mjs` before changing code. Keep the e2e stack running for the fake-scenario manual browser verification below.
11. [ ] With the e2e stack still available through `npm run compose:e2e:up`, use the Chrome DevTools MCP tools against `http://host.docker.internal:6001` to re-check the fake Copilot happy path, shared auth dialog behavior when surfaced by the named scenario, and one nearby regression such as switching back to Codex without losing Codex-only UI behavior. Save screenshots under `playwright-output-local` with names starting `0000051-22-e2e-`, inspect them yourself, and confirm the debug console shows no logged errors.
12. [ ] Run `npm run compose:e2e:down` and then `npm run compose:down` after the wrapper-driven and both manual browser checks finish.

#### Implementation notes

- `**to_do**`
