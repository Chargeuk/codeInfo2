# Story 0000064 - Users can configure OpenAI-compatible endpoints that require keys

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Story 59 added support for external OpenAI-compatible `/v1` endpoints in the Codex and Copilot chat and agent runtime paths, but it deliberately stopped at unauthenticated endpoints. That made the first version suitable for local gateways, LAN-hosted services, and other providers that expose `/v1/models` plus request execution without requiring a bearer token. It does not yet support providers such as OpenRouter that require a key for model discovery and request execution.

The user now wants the repository-owned endpoint contract to grow just enough to support providers that require keys while staying simple to read and configure. The agreed contract is that each endpoint entry gains a human label, and a second environment variable supplies raw keys keyed by the normalized form of that label. The exact GUI label should stay the same as the configured label text, but both the endpoint list and the key list should normalize the label in the same way for matching.

The new endpoint list format is:

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS=OpenRouter,https://openrouter.ai/api/v1|responses,completions;Local Gateway,http://host.docker.internal:1234/v1|responses,completions`

The new raw-key format is:

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS=openrouter,sk-or-v1-...;local-gateway,optional-or-blank`

The normalization rule is repository-owned and deterministic. For matching purposes, labels must be trimmed, converted to lowercase, and normalized into one predictable lookup key so the same human label written in two slightly different styles still resolves the same configured key. The exact display label is still preserved separately for GUI use and warnings.

This story must keep the Story 59 endpoint identity model intact. The normalized endpoint URL remains the real `endpointId` for runtime selection, persistence, fallback, and resume behavior. The label is not the real endpoint identity. It exists for display and for key lookup only. This avoids reopening the endpoint identity, duplicate-model, and persistence work that Story 59 already established.

This story must also stay honest about the runtime env surfaces in this repository. The supported server runtime config is loaded from `server/.env` and `server/.env.local`, not from the repo-root `.env.local`. The currently available OpenRouter secret lives in the repo-root `.env.local`, so part of this story is to move or copy that value into the correct server-owned variable rather than broadening startup env loading to consume a new root-level secret file contract.

From the user's point of view, the end result should be simple:

- the GUI shows external endpoint models under a friendly label such as `OpenRouter`;
- authenticated providers work in both Codex and Copilot when a matching key is configured;
- unauthenticated local endpoints continue to work without requiring a key;
- missing-key or wrong-key failures appear as clear endpoint-specific warnings instead of vague endpoint-breakage messages.

### Acceptance Criteria

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` supports entries in the format `<Label>,<full /v1 URL>|<capability[,capability...]>`.
- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` supports entries in the format `<label>,<raw key>` separated by semicolons.
- Both environment variables normalize labels with the same repository-owned rule before matching.
- The exact configured label from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` remains available for GUI display and user-facing warnings.
- The normalized endpoint URL remains the true `endpointId` for runtime selection, persistence, resume, and fallback behavior.
- Duplicate normalized labels in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` fail clearly.
- Duplicate normalized labels in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` fail clearly.
- Duplicate normalized endpoint URLs in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` still follow the established Story 59 duplicate-owner behavior unless the label contract requires a stronger validation outcome for the same entry.
- External model discovery sends `Authorization: Bearer <key>` when a matching endpoint key exists and sends no auth header when no key is configured.
- Authenticated endpoints that require a key can populate `/chat/providers` and `/chat/models` successfully when a correct key is configured.
- Authenticated endpoints that require a key surface a clear endpoint-specific warning or disabled reason when the key is missing or rejected.
- The Codex runtime path can execute against a key-protected external OpenAI-compatible endpoint without writing raw secrets into tracked repository files.
- The Copilot runtime path can execute against a key-protected external OpenAI-compatible endpoint without writing raw secrets into tracked repository files.
- Existing unauthenticated external endpoints continue to work without requiring keys.
- `server/.env.local` is updated to the new labeled endpoint syntax and includes an `OpenRouter` entry.
- `server/.env.local` includes the `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` entry required for OpenRouter, using the already-available root `.env.local` secret as the source of truth during implementation.
- Documentation explains that the server runtime loads `server/.env` plus `server/.env.local`, not the repo-root `.env.local`, for this contract.

### Out Of Scope

- Replacing the Story 59 endpoint identity model with a label-based runtime identity.
- Supporting multiple different keys for the same normalized endpoint URL at the same time.
- Building a key-management UI, secret vault integration, or encrypted secret storage layer.
- Teaching the server startup contract to read arbitrary new root-level env files instead of the documented `server/.env` and `server/.env.local` flow.
- Broadening the external-endpoint model-selection surface beyond the Codex and Copilot paths already introduced in Story 59.
- Adding provider-specific custom auth schemes beyond bearer-key support needed for OpenAI-compatible endpoints in this story.

### Additional Repositories

- No Additional Repositories

### Questions

None. The endpoint-label and raw-key contract is now fixed for this story.

## Decisions

1. Label contract
   - The question being addressed: Should endpoint auth lookup use a second synthetic id or the configured endpoint label?
   - Why the question matters: The user wants the simplest possible config shape and does not want unnecessary indirection.
   - What the answer is: Use the configured endpoint label as the human-facing display text and use a normalized form of that same label as the auth lookup key.
   - Where the answer came from: User direction during planning for this story.
   - Why it is the best answer: It keeps the contract short and readable while still making matching deterministic.
2. Runtime identity contract
   - The question being addressed: Should the label become the real endpoint identity once keys exist?
   - Why the question matters: Story 59 already uses the normalized URL as the runtime, persistence, and resume identity.
   - What the answer is: No. Keep the normalized URL as the true `endpointId`; use the label only for display and key lookup.
   - Where the answer came from: Existing Story 59 behavior and the user direction to add key support without reopening the completed unauthenticated-provider contract.
   - Why it is the best answer: It preserves the existing runtime and persistence model and avoids reopening the endpoint-identity repair work.
3. Server env surface
   - The question being addressed: Should the server start reading the repo-root `.env.local` for this story because the OpenRouter key is currently stored there?
   - Why the question matters: The implementation needs one clear runtime source for endpoint secrets.
   - What the answer is: No. Keep the existing server env contract and copy or move the OpenRouter key into `server/.env.local` as part of the story.
   - Where the answer came from: Repository startup-env behavior and README guidance.
   - Why it is the best answer: It keeps the server runtime contract stable and avoids broadening env-loading behavior just to accommodate one already-available local secret.

## Implementation Ideas

- Extend the external-endpoint parser so one endpoint entry produces:
  - exact display label;
  - normalized auth-label key;
  - normalized URL-backed `endpointId`;
  - capabilities.
- Add a second parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` that:
  - parses semicolon-separated entries;
  - normalizes labels with the same logic as the endpoint parser;
  - rejects blank labels;
  - rejects duplicate normalized labels;
  - preserves raw secret values without trimming away meaningful content except surrounding whitespace.
- Resolve one merged startup structure that lets downstream callers answer:
  - what the display label is;
  - what the normalized auth lookup label is;
  - what the normalized URL-backed endpoint identity is;
  - whether a raw key exists for that endpoint.
- Update external model discovery so `GET /v1/models` uses bearer auth when a key exists.
- Update the Codex translation layer to include auth in the generated custom provider shape using a repository-owned non-tracked runtime path.
- Update the Copilot translation layer to include `apiKey` when a key exists for the chosen endpoint.
- Keep missing-key and invalid-key behavior compatible with Story 59 fallback rules:
  - new runs may fall back according to the existing same-endpoint / same-provider / cross-provider logic;
  - resumed or pinned runs still fail in place instead of silently drifting.
- Update `server/.env.local` to the new labeled endpoint syntax and add `OpenRouter,https://openrouter.ai/api/v1|responses,completions`.
- Add `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` to `server/.env.local`, sourcing the OpenRouter raw key from the repo-root `.env.local` during implementation only.

## Feasibility Proof Pass

### 1. Parser, startup env, and config migration

- Already existing capabilities:
  - `server/src/config/openaiCompatEndpoints.ts` already parses and validates explicit `/v1` endpoints plus `responses` / `completions`.
  - `server/src/config/startupEnv.ts` already owns startup env loading and the `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` contract.
  - `server/.env.local` already contains the current unauthenticated endpoint list.
- Missing prerequisite capabilities:
  - The parser does not yet accept labels.
  - There is no parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS`.
  - There is no normalized-label matching layer between endpoints and keys.
- Assumptions currently invalid:
  - The current contract assumes one endpoint entry contains only URL plus capability metadata.
  - The current startup env inventory does not yet expose a second raw-key env variable.
- Feasibility and sequencing note:
  - This work is straightforward if the parser and env-resolution layer become the single source of truth before any discovery or runtime path tries to use bearer auth.

### 2. Authenticated discovery and runtime translation

- Already existing capabilities:
  - `server/src/chat/openaiCompatModelDiscovery.ts` already owns `/v1/models` discovery, dedupe, timeout behavior, and endpoint-local warning generation.
  - `server/src/config/codexConfig.ts` already translates one endpoint into a Codex custom provider.
  - `server/src/chat/interfaces/ChatInterfaceCopilot.ts` already translates one endpoint into a Copilot custom OpenAI provider.
- Missing prerequisite capabilities:
  - Discovery does not yet send auth headers.
  - Codex translation does not yet include auth-bearing provider metadata.
  - Copilot translation does not yet include `apiKey`.
- Assumptions currently invalid:
  - The current code assumes external endpoint discovery can be performed anonymously.
  - The current runtime translation assumes endpoint URL plus wire API are sufficient for execution.
- Feasibility and sequencing note:
  - Both Codex and Copilot already support custom OpenAI-compatible providers, so the main work is repository-owned auth plumbing rather than a new architecture.

### 3. Runtime behavior, warnings, and regression safety

- Already existing capabilities:
  - Story 59 already introduced endpoint-aware fallback, same-endpoint repair, provider-aware resume identity, and separate `endpointId` persistence.
  - Chat provider and model discovery already feed the GUI through repository-owned route shapes.
- Missing prerequisite capabilities:
  - The current warning and disabled-reason paths do not distinguish between anonymous endpoint failure and auth-specific endpoint failure.
  - The existing test endpoint server does not yet simulate bearer-protected discovery.
- Assumptions currently invalid:
  - The current proofs mostly assume authenticated and unauthenticated endpoints behave the same once the URL is reachable.
- Feasibility and sequencing note:
  - Once the parser and auth-bearing discovery/runtime seams exist, the remaining work is regression proof and message-quality cleanup.

## Message Contracts And Storage Shapes

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` becomes an optional server env input using the grammar:
  - `<Label>,<full http-or-https /v1 base URL>|<capability[,capability...]>`
  - semicolon-separated for multiple entries.
- `Label` rules:
  - required;
  - cannot be blank after trim;
  - exact text is preserved for display;
  - a normalized lookup key is derived from the same label using one shared normalization function.
- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` becomes an optional server env input using the grammar:
  - `<Label>,<raw key>`
  - semicolon-separated for multiple entries.
- Key-entry label rules:
  - required;
  - normalized with the same function used by `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`;
  - duplicate normalized labels are invalid.
- Key value rules:
  - required for entries that appear in the keys list;
  - cannot be blank after trim;
  - preserved as raw secret content and never written into tracked repository files or user-facing logs.
- Identity rules:
  - normalized endpoint URL remains `endpointId`;
  - exact label is display-only;
  - normalized label is lookup-only.
- Discovery rules:
  - when an endpoint has a matched key, `/v1/models` discovery sends `Authorization: Bearer <key>`;
  - when no key exists, discovery sends no auth header;
  - missing-key or rejected-key outcomes produce endpoint-specific warnings.

## Test Harnesses

- Existing harnesses to extend:
  - `server/src/test/support/externalOpenAiCompatServer.ts` for `/v1/models` responses.
  - `server/src/test/unit/env-loading.test.ts` for startup env parsing and override precedence.
  - `server/src/test/unit/openaiCompatEndpoints.test.ts` for endpoint parser contract coverage.
  - `server/src/test/unit/config.chatDefaults.test.ts` for endpoint-aware fallback and warning behavior.
  - `server/src/test/integration/chat-codex.test.ts` and `server/src/test/integration/chat-copilot-fallback.test.ts` for real route-owned behavior.
- Missing prerequisite test capability:
  - the external endpoint test server needs bearer-auth modes so it can reject missing or wrong tokens and accept correct ones.

## Edge Cases And Failure Modes

- Duplicate normalized labels in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` must fail clearly.
- Duplicate normalized labels in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` must fail clearly.
- A label present in the key list but absent from the endpoint list should produce a clear startup warning or validation error according to the final parser decision; the implementation must choose one deterministic owner.
- A labeled endpoint without a key must remain valid when the endpoint does not require auth.
- A labeled endpoint without a key must become unavailable with a clear reason when the endpoint requires auth and the request receives 401 or 403.
- Auth failures must not leak raw keys into logs, thrown errors, test snapshots, or user-facing warnings.
- Renaming a label changes the normalized auth lookup key, so documentation and warnings must make that coupling explicit.
- Two labels that normalize to the same lookup key must be treated as duplicates even if the original spelling differs.
- Persisted conversations must not store raw keys.

### Task 1. Extend the endpoint and key parsing contract

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__to_do__`
- Git Commits:

#### Overview

This task updates the repository-owned env contract so labeled external endpoints and raw-key mappings can be parsed, normalized, and validated in one deterministic owner. It also updates the startup env inventory and local server env config so the repository’s actual runtime seam matches the new contract.

#### Task Exit Criteria

- The server has one shared parser and normalization layer for labeled endpoints and labeled raw keys.
- `server/.env.local` uses the new labeled endpoint syntax and contains the OpenRouter endpoint plus the matching raw-key entry.

#### Documentation Locations

- OpenRouter quickstart and model-discovery docs. Use them to keep the `/api/v1` and bearer-token expectations accurate.
- Current repository README sections describing `server/.env.local` as the supported host-only server override surface.

#### Subtasks

1. [ ] Read this story’s Description, Acceptance Criteria, Message Contracts And Storage Shapes, and Edge Cases And Failure Modes, then inspect `server/src/config/openaiCompatEndpoints.ts`, `server/src/config/startupEnv.ts`, `server/.env`, `server/.env.local`, and the repo-root `.env.local` so the new parser work starts from the real current contract and the real current local-secret location.
2. [ ] Update `server/src/config/openaiCompatEndpoints.ts` so endpoint entries require `<Label>,<full /v1 URL>|<capability[,capability...]>`, preserve the exact label for display, derive one normalized auth-label key, keep the normalized URL as `endpointId`, and reject duplicate normalized labels as well as malformed entries.
3. [ ] Add the repository-owned parser and resolution logic for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` in the same config owner layer or a clearly paired config module, using the exact same label-normalization function as the endpoint parser and rejecting duplicate normalized labels or blank keys.
4. [ ] Update `server/src/config/startupEnv.ts` so it inventories `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS`, resolves labeled endpoints plus raw keys together, and keeps the existing `server/.env` then `server/.env.local` load order intact without teaching startup to read the repo-root `.env.local`.
5. [ ] Update `server/.env.local` so the current unauthenticated endpoint list becomes labeled entries, add `OpenRouter,https://openrouter.ai/api/v1|responses,completions`, and add the new `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` entry using the existing OpenRouter secret from the repo-root `.env.local` as the implementation-time source.
6. [ ] Add or update parser and env-loading proof in `server/src/test/unit/openaiCompatEndpoints.test.ts` and `server/src/test/unit/env-loading.test.ts`, including duplicate normalized labels, label normalization collisions, blank labels, blank keys, and the new `server/.env.local`-owned runtime contract.
7. [ ] Update `README.md` so it documents the new labeled endpoint grammar, the new raw-key variable, the shared normalization rule, and the fact that server runtime secrets belong in `server/.env.local` rather than the repo-root `.env.local`.
8. [ ] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
9. [ ] Run the exact repository-supported prettier or format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using `npm run format` before manual cleanup when possible.

#### Testing

1. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/unit/openaiCompatEndpoints.test.ts` to prove the labeled endpoint and raw-key parser contract.
2. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/unit/env-loading.test.ts` to prove the startup env loading and labeled key resolution contract.
3. [ ] Run `npm run lint` for the final Task 1 surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [ ] Run `npm run format:check` for the final Task 1 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation Notes

- None yet.

### Task 2. Add bearer-auth support to external discovery and runtime translation

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__to_do__`
- Git Commits:

#### Overview

This task threads matched raw keys into the two places that actually need them: `/v1/models` discovery and the Codex/Copilot runtime translation layers. It keeps Story 59’s endpoint identity, fallback, and fail-in-place behavior intact while extending the external-provider path to work with key-protected endpoints such as OpenRouter.

#### Task Exit Criteria

- `/v1/models` discovery uses bearer auth when a matched key exists.
- Both Codex and Copilot can execute against a key-protected external OpenAI-compatible endpoint using the repository-owned config contract.

#### Documentation Locations

- OpenAI Codex custom provider documentation, especially custom provider auth fields such as `env_key` or auth-bearing provider metadata.
- GitHub Copilot SDK BYOK documentation, especially `provider: { type: "openai", baseUrl, apiKey, wireApi }`.
- OpenRouter quickstart and model-list docs for the exact bearer-token expectation.

#### Subtasks

1. [ ] Read the relevant story sections plus `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/config/codexConfig.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/config/chatDefaults.ts`, and `server/src/routes/chat.ts` so the auth-bearing changes stay inside the existing Story 59 runtime and fallback seams.
2. [ ] Update `server/src/chat/openaiCompatModelDiscovery.ts` so discovery resolves the matched raw key for each labeled endpoint, sends `Authorization: Bearer <key>` only when present, and converts missing-key or rejected-key outcomes into clear endpoint-scoped warnings without leaking the secret.
3. [ ] Update `server/src/config/codexConfig.ts` and any required runtime-config owners so Codex custom provider translation includes the auth-bearing metadata needed for key-protected OpenAI-compatible providers without writing raw secrets into tracked files or persisted conversation state.
4. [ ] Update `server/src/chat/interfaces/ChatInterfaceCopilot.ts` and any adjacent runtime owners so Copilot custom provider translation includes `apiKey` when a matched key exists for the selected endpoint.
5. [ ] Update `server/src/config/chatDefaults.ts` and any route-owned warning surfaces needed so auth failures produce clear endpoint-specific unavailable reasons while preserving Story 59’s same-endpoint repair, same-provider fallback, and resumed fail-in-place rules.
6. [ ] Extend `server/src/test/support/externalOpenAiCompatServer.ts` so it can simulate missing-token rejection, wrong-token rejection, and correct-token success for `/v1/models` and runtime-owned auth paths.
7. [ ] Add or update proof in the relevant server unit and integration owners, including `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`, and `server/src/test/integration/chat-copilot-resume.test.ts`, so authenticated endpoint discovery and execution are covered on real route and runtime seams.
8. [ ] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
9. [ ] Run the exact repository-supported prettier or format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using `npm run format` before manual cleanup when possible.

#### Testing

1. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/unit/config.chatDefaults.test.ts` to prove authenticated discovery warnings and fallback behavior.
2. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/integration/chat-codex.test.ts` to prove the Codex route and runtime can use an authenticated external endpoint.
3. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-fallback.test.ts` to prove the Copilot route and runtime can use an authenticated external endpoint.
4. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-resume.test.ts` to prove resume and fail-in-place semantics stay correct on authenticated endpoints.
5. [ ] Run `npm run lint` for the final Task 2 surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
6. [ ] Run `npm run format:check` for the final Task 2 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation Notes

- None yet.

### Task 3. Preserve GUI clarity and user-facing endpoint behavior

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`
- Task Status: `__to_do__`
- Git Commits:

#### Overview

This task keeps the client and route payload surfaces understandable once labels and auth-aware warnings exist. It ensures the GUI continues to show friendly endpoint labels while the backend keeps using the normalized URL as the real runtime identity.

#### Task Exit Criteria

- The GUI can show the configured label for external endpoint-backed models and warnings.
- Client and server payloads stay aligned with the Story 59 endpoint identity contract.

#### Documentation Locations

- Existing Story 59 route and picker documentation in the repository plan files.
- Any relevant client-side MUI docs only if UI component behavior needs clarification.

#### Subtasks

1. [ ] Read the relevant story sections plus `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `common/src/lmstudio.ts`, `client/src/hooks/useChatModel.ts`, and any chat-page owners that currently display or interpret endpoint-backed model metadata.
2. [ ] Update the server/shared response shapes as needed so the exact configured endpoint label is available for display without replacing the normalized URL-backed `endpointId` contract already used for runtime and persistence.
3. [ ] Update the client selection and display logic so external endpoint-backed models and warnings use the friendly configured label while the actual selection and request payload still rely on provider, raw model id, and `endpointId`.
4. [ ] Add or update proof in the relevant client and route owners, including the Story 59 endpoint-backed model-selection tests and any shared response-shape tests, so label display, endpoint identity, and auth-warning visibility are all covered honestly.
5. [ ] Update `README.md` or other relevant repository docs again if the final response shape or GUI wording needs a user-facing explanation beyond the Task 1 contract update.
6. [ ] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
7. [ ] Run the exact repository-supported prettier or format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using `npm run format` before manual cleanup when possible.

#### Testing

1. [ ] Run `npm run build:summary:client` to confirm any shared response-shape or client-selection changes still typecheck and build cleanly.
2. [ ] Run `npm run test:summary:client` to prove the client selection and display contract for labeled authenticated endpoints.
3. [ ] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature` to prove the route-owned `/chat/models` and `/chat/providers` surface still behaves correctly with labeled endpoints.
4. [ ] Run `npm run lint` for the final Task 3 surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [ ] Run `npm run format:check` for the final Task 3 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation Notes

- None yet.

### Task 4. Final story validation and close-out

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`, `Task 2`, `Task 3`
- Task Status: `__to_do__`
- Git Commits:
- Notes: This final validation task proves the complete authenticated-endpoint story rather than only isolated parser or runtime seams.

#### Overview

This task revalidates the final repository behavior after the parser, discovery, runtime, and GUI changes land. It must prove authenticated providers such as OpenRouter can be configured cleanly while unauthenticated providers still work and the Story 59 endpoint identity rules remain intact.

#### Task Exit Criteria

- Every Acceptance Criterion is implemented and proved.
- Final documentation and local config examples match the final validated authenticated-endpoint contract.

#### Documentation Locations

- OpenRouter quickstart and model-list docs for the final auth contract check.
- Codex and Copilot SDK docs for the final runtime translation check.

#### Subtasks

1. [ ] Re-open this story plan, `AGENTS.md`, the final endpoint parser and startup-env owners, the final discovery/runtime translation owners, the final shared response-shape owners, and the updated local env/docs files so the close-out pass verifies the actual final contract rather than the original intent only.
2. [ ] Refresh or rename any proof owners whose titles still imply unauthenticated-only behavior, so the final story head states authenticated-endpoint claims explicitly where needed.
3. [ ] Verify `server/.env.local` still contains the labeled local endpoints plus the `OpenRouter` endpoint and the required `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` entry, and verify the repo-root `.env.local` is no longer treated as a required server runtime dependency for this story.
4. [ ] Summarize in this plan’s `Implementation Notes` which proof homes own parser validation, authenticated discovery, authenticated Codex runtime, authenticated Copilot runtime, client label display, and regression coverage for unauthenticated endpoints.
5. [ ] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
6. [ ] Run the exact repository-supported prettier or format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using `npm run format` before manual cleanup when possible.

#### Testing

1. [ ] Run `npm run build:summary:server` to confirm the final authenticated-endpoint server surface builds cleanly.
2. [ ] Run `npm run build:summary:client` to confirm the final shared response-shape and GUI surface builds cleanly.
3. [ ] Run `npm run test:summary:server:unit` to prove the final parser, discovery, runtime, persistence, and regression server surface.
4. [ ] Run `npm run test:summary:server:cucumber` to prove the final feature-owned route contract for endpoint-backed discovery and selection.
5. [ ] Run `npm run test:summary:client` to prove the final client model-selection and warning surface.
6. [ ] Run `npm run lint` for the final story surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
7. [ ] Run `npm run format:check` for the final story surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

If a later human or manual-testing-agent follow-up is needed, use the checked-in main stack rather than the local development stack. Start with `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`.

Prepare `server/.env.local` with the final labeled endpoint entries and the final `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` value before the runtime starts. Do not depend on the repo-root `.env.local` at runtime; use it only as the implementation-time source for the already-available OpenRouter secret if that secret still has not been copied into `server/.env.local`.

The most useful manual proof is:

- verify the GUI shows the friendly `OpenRouter` label under the Codex and Copilot model-selection paths when the configured key is valid;
- verify missing-key or wrong-key scenarios show a clear endpoint-specific warning without leaking the raw key;
- verify one unauthenticated local endpoint still remains usable without any key configured.

Store any task-level screenshots, logs, or notes under `codeInfoTmp/manual-testing/0000064/4/` and do not commit them.

#### Implementation Notes

- None yet.
