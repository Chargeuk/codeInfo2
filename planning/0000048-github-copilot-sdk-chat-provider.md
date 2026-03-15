# Story 0000048 – GitHub Copilot SDK Chat Provider

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

Research also identified two important scope controls for this first Copilot story.

First, the Copilot SDK itself has its own nested concept of a `provider` for BYOK backends such as OpenAI-compatible APIs, Azure, Anthropic, or local servers. That is separate from this product's top-level chat-provider selection. This story is about adding GitHub Copilot as a top-level chat provider in this product, not about exposing the SDK's own BYOK provider-routing features to end users.

Second, the Copilot SDK can expose a broader agentic surface than the current chat page necessarily needs, including permission prompts and built-in tool categories such as shell, write, read, url, and MCP. This story should stay conservative. The first Copilot chat integration should not silently open a wider tool and filesystem execution surface than the existing chat UX and policy already expect.

The user also wants Copilot home-directory handling to mirror the existing Codex home contract as closely as possible. Today the repository already uses `CODEINFO_CODEX_HOME` to point at a repo-local or container-local Codex home, with `server/.env` using a relative development value and Docker Compose overriding that to an in-container path. Research indicates that the Copilot SDK and Copilot CLI can support a parallel arrangement:

- a product-level environment variable `CODEINFO_COPILOT_HOME` should be introduced;
- development configuration should point it at a repo-local `../copilot` path in `server/.env`;
- container execution should override it to `/app/copilot` in the same way Codex uses `/app/codex`;
- server startup and Copilot session creation should resolve that value and pass it through to the Copilot runtime using `COPILOT_HOME` and the SDK `configDir` so the behaviour is deterministic.

This is intentionally about config and state location, not about changing the project working directory. The Copilot home should be treated like a runtime home, while Copilot's working directory for chat should still point at the actual codebase location the model is meant to operate on.

Authentication also needs to be described carefully for this story. The existing product already has a shared Codex authentication popup and a backend route that shells out to `codex login --device-auth`, parses the returned verification URL and user code, and displays that output in the UI. Follow-up Copilot SDK and Copilot CLI research now shows a documented GitHub OAuth device-flow path for Copilot as well, using `copilot login` and the interactive `/login` command. The documented flow gives the user a one-time code and the GitHub device-login URL so the user can complete authentication in a normal browser.

That makes a Copilot auth flow possible even when this product is running inside Docker images that cannot launch a browser themselves. The container only needs to start the Copilot login command and surface the verification URL and code in the UI. The user can then open the GitHub device-login page in their own browser outside the container, enter the code, and finish authentication there.

For this story, the chosen auth direction is therefore the closest practical analogue to the existing Codex flow:

- add a Copilot auth action in the shared authentication modal alongside the current Codex action;
- back that action with a Copilot-specific backend route that runs the documented Copilot device-login flow and returns the verification details needed by the user;
- keep the implementation explicitly GitHub Copilot auth, not BYOK token/provider routing;
- persist Copilot auth/config state under `CODEINFO_COPILOT_HOME` so successful authentication survives container restarts and can be reused by later chat requests;
- treat plaintext config persistence under that mounted Copilot home as an acceptable first implementation when the container environment does not provide a usable keychain.

This story still does not need a brand new custom GitHub OAuth application or a general-purpose token-management UI. However, it does now include a minimal in-app Copilot device-auth experience and the shared `Choose Authentication` modal changes because those are both documented-compatible and compatible with the containerized runtime constraint.

### Acceptance Criteria

- The chat provider model in the server supports a third provider id named `copilot` without breaking existing `codex` and `lmstudio` behavior.
- The shared chat-default and runtime-provider-selection path no longer assumes exactly two providers.
- The chat provider selection flow can choose or fall back across three providers in a deterministic way.
- `GET /chat/providers` can report Copilot availability with a clear reason when the Copilot SDK or Copilot CLI is unavailable, unauthenticated, or otherwise unusable.
- `GET /chat/models?provider=copilot` returns Copilot model entries mapped into the existing chat-model response shape.
- Copilot model entries preserve useful reasoning metadata when the SDK exposes it.
- `POST /chat` accepts `provider: "copilot"` and can execute a chat turn through the Copilot SDK.
- Copilot chat responses stream back into the existing chat event bridge so the current chat page can render live output without needing a brand new transport.
- Copilot chat turns persist into conversations and turns using provider value `copilot`.
- The Copilot chat path reuses the existing conversation identity so a conversation can continue coherently across multiple Copilot turns.
- Copilot session continuity is deterministic for chat in this story. A follow-up request in the same chat conversation resumes the correct Copilot session rather than creating unrelated context silently.
- The initial Copilot chat story does not add support for running agents, commands, or flows through the Copilot SDK.
- The initial Copilot chat story does not introduce new Copilot-specific controls in the page beyond provider selection, model selection, and existing transcript behaviour unless a small status or warning surface is needed for usability.
- The initial Copilot chat story does not expose the Copilot SDK's nested BYOK provider configuration to product users.
- The Copilot integration supports a product-level environment variable `CODEINFO_COPILOT_HOME` that is resolved and applied in the same style as `CODEINFO_CODEX_HOME`.
- Development defaults use `CODEINFO_COPILOT_HOME=../copilot` in `server/.env`, and container execution overrides that to `/app/copilot` in the same way Codex uses `/app/codex`.
- The Copilot home location is used for Copilot config and state, while the chat working directory remains the actual repository or mounted project directory rather than the Copilot home folder.
- The product can report Copilot authentication readiness and unauthenticated reasons before and after the Copilot device-auth flow runs.
- This story includes the shared `Choose Authentication` modal update, with both `Codex Auth` and `Copilot Auth` actions exposed in the UI.
- The `Copilot Auth` action starts a Copilot-specific backend device-auth route rather than reusing the Codex route.
- The Copilot auth flow works when the product is running in Docker without a browser in the container, because the UI shows the GitHub device-login URL and one-time code for the user to complete in an external browser.
- Successful Copilot authentication persists under the resolved `CODEINFO_COPILOT_HOME` location so later provider checks and chat requests can reuse it.
- If the container environment does not provide a usable keychain, the first implementation may persist Copilot auth/config state using the documented fallback under the mounted `CODEINFO_COPILOT_HOME` path.
- If Copilot is unavailable or unauthenticated, the provider list and/or chat execution path reports a clear reason instead of failing silently.
- Existing Codex-only request flags remain Codex-only in this story and are either ignored with warnings or left unavailable for Copilot rather than being reinterpreted incorrectly.
- Existing LM Studio and Codex chat flows continue to work after the Copilot provider is added.
- The new provider is covered by unit and integration tests for provider discovery, model listing, validation, fallback behavior, and streamed chat execution.

### Out Of Scope

- Running agents through the Copilot SDK.
- Running commands or flows through the Copilot SDK.
- Reworking the existing agent or flow services to become multi-provider in this story.
- Exposing the Copilot SDK's nested BYOK provider-routing configuration in the product UI or REST payloads.
- Building a general provider-agnostic settings framework for every possible future model runtime.
- Adding a custom GitHub OAuth application flow or general-purpose token-management UI for Copilot in this story.
- Replacing the documented Copilot device-login flow with a bespoke auth mechanism when the documented flow is sufficient.
- Broadening the chat page to expose Copilot-specific advanced settings such as hooks, custom agents, infinite sessions, or custom MCP-server editing.
- Quietly enabling a broader built-in Copilot tool surface than this product already intends to support.
- Replacing the existing Codex or LM Studio integrations.
- Changing ingestion providers or other non-chat provider systems in this story.

### Questions

- No Further Questions

### Decisions

1. Question: Should this story add Copilot support everywhere the product runs models, or only in the chat surface? Why it matters: the repository contains both chat-provider wiring and separate Codex-oriented agent and flow execution paths, and the amount of work changes significantly depending on scope. Decision: this story is chat-only. Agent, command, and flow support remain future work. Source and why this is best: direct repository inspection showed chat already has a provider factory and provider selection path, while agent and flow services still hardcode `provider: 'codex'` in many places. This is the smallest useful slice and avoids turning one provider addition into a repo-wide execution refactor.
2. Question: What top-level provider id should be used for this story, given that the Copilot SDK itself also uses the term `provider` for nested BYOK configuration? Why it matters: reusing ambiguous names would make route payloads, internal types, and future settings harder to reason about. Decision: the product-level provider id for this story is `copilot`, and the SDK's own nested provider configuration remains out of scope. Source and why this is best: the existing chat-provider ids are short transport/runtime identifiers such as `codex` and `lmstudio`, and repository research showed the Copilot SDK's `provider` object means something different. Keeping `copilot` as the app-level provider avoids naming collisions and keeps the story focused on GitHub Copilot-backed chat.
3. Question: How should Copilot chat session continuity be mapped onto the repository's existing chat conversation model? Why it matters: the Copilot SDK is session-based rather than stateless, so this story needs one deterministic rule for creating and resuming context across turns. Decision: Copilot chat should map one product chat conversation to one Copilot SDK session, using the existing conversation identity as the stable session identity or as the source of truth for a stored Copilot session id. Source and why this is best: the repository already uses stable conversation ids for persistence, and the Copilot SDK supports named session creation and resumption. This is the most natural fit because it preserves conversation continuity without inventing a second competing chat identity.
4. Question: Should the first Copilot chat story expose the Copilot runtime's broader built-in tool and permission surface, or should it stay conservative? Why it matters: the SDK requires a permission handler and can enable shell, write, read, url, MCP, and custom-tool permissions, which could broaden execution behaviour beyond the current chat expectations. Decision: stay conservative in this story. The first Copilot chat slice should use a controlled tool surface that matches current product expectations rather than turning on a wide built-in agentic capability set by default. Source and why this is best: repository research showed the current chat page has no Copilot-style permission UI, while the Copilot SDK requires an explicit permission strategy. A narrow first slice reduces safety and UX risk while still delivering provider support.
5. Question: Should this story include a Copilot login experience inside the product, or should it stop at readiness/status reporting only? Why it matters: Codex already has a device-auth experience in the repository, and the user wants Copilot auth to work in Docker without depending on a browser inside the container. Decision: include a minimal in-app Copilot device-auth flow in this story. The implementation should use the documented Copilot CLI device-login path, surface the verification URL and code in the UI, and let the user finish the GitHub OAuth step in their own browser outside the container. Source and why this is best: the Copilot SDK auth docs and Copilot CLI auth docs document `copilot login` and `/login` as GitHub OAuth device flow, which matches the container constraint well and keeps the UX close to the existing Codex popup without needing a separate custom OAuth application.
6. Question: Should Copilot home-directory handling be introduced as a new product-specific environment variable in the same style as `CODEINFO_CODEX_HOME`, and if so what values should be used? Why it matters: the repository already uses a repo-local and container-local Codex home convention, and the user wants Copilot to behave the same way for configuration and persistent state. Decision: introduce `CODEINFO_COPILOT_HOME` and mirror the Codex pattern. Use `CODEINFO_COPILOT_HOME=../copilot` in `server/.env` for development, and override to `/app/copilot` in container execution. Resolve that value in server code, pass it through to the Copilot runtime as `COPILOT_HOME`, and also apply it as SDK `configDir` for deterministic state location. Source and why this is best: direct repository inspection showed `CODEINFO_CODEX_HOME` already uses this exact split between repo-local and in-container values, while Copilot SDK research showed support for overriding the default configuration directory and Copilot CLI research showed support for `COPILOT_HOME`. This is the closest clean analogue to the existing Codex contract while still keeping Copilot's working directory separate from its config home.
7. Question: Can the existing Codex device-auth popup be adapted into a shared authentication popup with both `Codex Auth` and `Copilot Auth` actions? Why it matters: the current repository already has shared popup UI for Codex auth, and the user wants a Copilot login path that feels similar while still working inside Docker. Decision: yes, and the shared popup update is part of this story rather than a follow-up. The shared popup UI should be adapted so `Codex Auth` keeps using the current route and `Copilot Auth` starts a Copilot-specific device-auth route that returns the verification URL and code from the documented Copilot login flow. The browser step still happens outside the container on the user's own machine. Source and why this is best: repository inspection showed the existing dialog is already reusable UI, and Copilot auth research now shows a documented GitHub device-login flow that can be surfaced the same way even when the runtime is containerized.
8. Question: What should happen if the container environment does not provide a usable system keychain for Copilot credential storage? Why it matters: desktop-style keychain assumptions often break in Docker, but the user still wants the Copilot login to persist and be reusable. Decision: the first implementation may intentionally rely on the documented Copilot fallback of persisting auth/config state under the mounted `CODEINFO_COPILOT_HOME` path when no keychain is available. Source and why this is best: the user explicitly approved this tradeoff, and it gives the story a deterministic container-compatible persistence path without blocking on extra keychain infrastructure.

## Implementation Ideas

- `Dependency and lifecycle`: add `@github/copilot-sdk` to the server workspace and introduce a small Copilot-client lifecycle module rather than constructing a fresh client per request. The SDK manages a CLI connection and model cache, so a shared server-side client or registry is likely a better fit than repeated one-off construction.
- `Copilot home resolution`: add a small config helper similar to the existing Codex home resolution flow so the server has one canonical way to resolve `CODEINFO_COPILOT_HOME`, default it sensibly, and derive the Copilot config/state location from it.
- `Provider detection/status`: create a dedicated server utility for Copilot readiness checks, similar in spirit to the existing Codex detection flow but tailored to the Copilot SDK contract. It should answer questions such as: can the client start, what does `getStatus()` report, what does `getAuthStatus()` report, and what reason string should the REST layer surface when Copilot is unavailable.
- `Env wiring`: when the shared Copilot client is created, pass the resolved home through the spawned Copilot CLI environment as `COPILOT_HOME`. When sessions are created or resumed, also pass the resolved home as `configDir` so the SDK and CLI agree on config/state location.
- `Auth UX`: adapt the existing shared authentication modal so it can show both `Codex Auth` and `Copilot Auth`. Keep the current Codex action mapped to the existing route, and add a Copilot action that starts the documented Copilot device-login flow and displays the GitHub verification URL and one-time code to the user.
- `Copilot device auth`: add a Copilot-specific backend utility and route that shells out to `copilot login`, captures the device-flow output, and returns the verification details the UI needs. The implementation should explicitly support the Docker constraint by assuming the user completes the browser step outside the container.
- `Copilot auth persistence`: keep Copilot auth/config state under the resolved `CODEINFO_COPILOT_HOME` path so the login can be reused across restarts. If the container environment does not provide a usable keychain, the implementation may intentionally rely on the documented Copilot fallback behavior for persisted config/state under that mounted home rather than assuming desktop keychain support.
- `Copilot auth status`: use SDK and CLI-supported readiness checks after login to determine whether Copilot is authenticated and usable, and surface clear reason text when it is not.
- `Provider selection types`: update `server/src/config/chatDefaults.ts` so `ChatDefaultProvider` includes `copilot`, `VALID_PROVIDERS` includes `copilot`, and the runtime fallback path no longer uses a two-provider `alternateProvider()` assumption. The new selection logic should work off an ordered list or comparable deterministic strategy rather than a binary toggle.
- `Validation`: update `server/src/routes/chatValidators.ts` so `provider: "copilot"` is valid. Keep Codex-only flags as Codex-only in this story. If those flags are sent with Copilot, they should be ignored with warnings rather than misapplied.
- `Factory`: register a new `ChatInterfaceCopilot` in `server/src/chat/factory.ts`.
- `Execution adapter`: implement `server/src/chat/interfaces/ChatInterfaceCopilot.ts` that:
  - acquires the shared Copilot client;
  - creates or resumes a Copilot session for the current chat conversation;
  - supplies the required permission handler;
  - subscribes to Copilot session events;
  - translates Copilot events into the repository's `ChatInterface` event model;
  - emits final, token, analysis, tool, complete, and error events in the shapes the rest of the chat pipeline already expects.
- `Session identity`: either use the repository conversation id directly as the Copilot session id or store a derived Copilot session id in conversation metadata/flags. The implementation should choose one deterministic rule and test it thoroughly.
- `Model listing`: extend `server/src/routes/chatModels.ts` with a `copilot` branch that calls `client.listModels()` and maps `ModelInfo` into the existing `ChatModelsResponse` structure. Preserve reasoning metadata when present.
- `Provider listing`: extend `server/src/routes/chatProviders.ts` so the provider list can include Copilot with an availability flag, reason text, and deterministic ordering within the now-three-provider list.
- `Chat route`: extend `server/src/routes/chat.ts` so runtime provider selection, fallback handling, and execution all understand Copilot. The Codex-only runtime-config load path should remain Codex-specific rather than becoming a hidden dependency for Copilot.
- `Client model hook`: extend `client/src/hooks/useChatModel.ts` so provider bootstrap, provider fallback, and model loading all handle three providers cleanly. The current logic already treats Codex specially; this story should preserve Codex-specific defaults without forcing Copilot into the LM Studio shape.
- `Client page`: update `client/src/pages/ChatPage.tsx` so Copilot can be selected and used without surfacing irrelevant Codex-only controls. The page should still behave predictably when switching between Codex, LM Studio, and Copilot.
- `Environment defaults and compose wiring`: update `server/.env`, `docker-compose.yml`, `docker-compose.local.yml`, and any related runtime defaults so `CODEINFO_COPILOT_HOME` follows the same repo-local versus in-container pattern as `CODEINFO_CODEX_HOME`. Start with the minimum required volume mapping for `./copilot:/app/copilot`, and only add extra host-home mirror mounts if implementation testing shows they are necessary.
- `Safe tool surface`: prefer wiring Copilot to the existing repository MCP/tool surface in a controlled way rather than enabling every built-in Copilot CLI tool by default. Research showed the Copilot SDK supports session-level MCP server config, which may be the cleanest fit for parity with the current tooling model.
- `Naming clarity`: keep the product-level provider id `copilot` separate from any internal type or variable names that refer to the Copilot SDK's own nested BYOK `provider` config. Avoid overloaded terminology in server types and comments.
- `Likely tests`:
  - `server/src/test/unit/chatDefaults...` coverage for three-provider defaulting and fallback;
  - `server/src/test/unit/chatValidators...` coverage for `copilot` acceptance and Codex-flag warnings;
  - `server/src/test/unit/chat factory/interface` coverage for Copilot event mapping;
  - `server/src/test/integration/chat...` coverage for `provider: "copilot"` streaming and persistence;
  - client tests for provider selection and model loading when Copilot is present.
- `Implementation constraint`: do not use this story to refactor agents or flows to become provider-agnostic. The later agent-support plan can build on the chat integration patterns proven here.
