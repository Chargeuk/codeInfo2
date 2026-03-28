# Story 0000056 – Users can use Copilot as a first-class chat provider with shared Agent Flags and defaults

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

The product already has three chat providers in some form, but they do not feel equally supported from a user perspective. Codex currently has the strongest integration because it has repo-owned chat defaults, Codex-specific chat controls in the UI, and better alignment between the normal chat page and the MCP chat interface. GitHub Copilot support exists, but it is still a thinner integration. The page can select Copilot as a provider, yet Copilot does not currently receive the same tool wiring, the same default-config story, or the same provider-specific UI treatment that Codex receives.

This story closes that gap by making Copilot a first-class chat provider in the same product surfaces where Codex already feels strong, while also cleaning up the chat-provider architecture so it is no longer overly Codex-shaped. The user should be able to choose Copilot as the default chat provider, have the default chat model come from a provider-specific chat config file seeded by the app into the repo-local provider folder, use tools through the chat page and the chat MCP interface, and see a provider-neutral `Agent Flags` panel that shows only the options the selected provider actually supports.

The key design decision for this story is that the default-provider selector remains a single environment variable, but the default model no longer comes from a second shared environment variable. The environment variable `CODEINFO_CHAT_DEFAULT_PROVIDER` should remain the single top-level default selector. Once that provider is chosen, the server should load the selected provider's repo-owned chat config file and read the default model from there. This removes the need for `CODEINFO_CHAT_DEFAULT_MODEL` and avoids a confusing split where the provider comes from one place and the actual model comes from somewhere else.

The chosen config layout is intentionally symmetrical at the application layer:

- `codex/chat/config.toml` remains the repo-owned Codex chat-defaults file;
- `copilot/chat/config.toml` is added as a repo-owned Copilot chat-defaults file;
- `lmstudio/chat/config.toml` is added as a repo-owned LM Studio chat-defaults file.

These files are product-owned chat-default contracts seeded by the application into repo-local provider folders. They are not claims that all three providers natively read the same file shape themselves. Codex already has its own native runtime config under `codex/config.toml`. Copilot keeps its own auth and runtime home under `copilot/`. LM Studio keeps its own provider-specific runtime behavior. This story is about one consistent product-level defaults layer that the server reads and translates into each provider runtime, not about forcing every provider to adopt Codex's native on-disk contract.

That distinction matters most for Copilot. The user has chosen that Copilot auth and runtime state must stay under the existing `copilot/` home contract rather than moving into `copilot/chat/`. The new `copilot/chat/config.toml` file should therefore be treated as a repo-owned chat-defaults file only. It must not become Copilot's real runtime `configDir`, because doing that would risk separating chat defaults from the auth and state that the SDK and CLI already expect to live in the Copilot home.

The user has also now chosen that these provider folders should be seeded automatically rather than depending on a manually checked-in file for each provider. That means the local bootstrap path that already creates required repo-local folders for Codex and Copilot should be extended to create the LM Studio chat-defaults folder as well. The repo's gitignore rules should also keep the repo-local provider folders out of Git, including the new `lmstudio/` folder, so runtime defaults and local provider state do not create accidental source-control noise.

The same principle applies to tool support. Research and repo evidence show that Copilot can support tools through the SDK session layer, but the current repository does not actually wire that path up in normal chat execution. This story should therefore make app-managed tool parity the primary mechanism. In practice that means the server should construct Copilot tools from the repository's own trusted tool layer and pass them into Copilot session creation, rather than depending on provider-native MCP file discovery as the main product contract. Native provider-specific MCP config may still exist, but it is not the primary parity mechanism for this story.

The chat-page user experience also needs to become provider-neutral. Today the page has a `Codex flags` panel, uses Codex-specific defaults, and sends a `codexFlags` payload only for Codex. That architecture is too narrow now that the product supports Codex, Copilot, and LM Studio. This story should replace the Codex-only control path with a provider-neutral `Agent Flags` contract. The selected provider should advertise which flags or provider-specific options are supported, what their defaults are, and whether they are editable. The client should then render only those controls. This means Codex may still show the richest set of editable controls, while Copilot or LM Studio may show fewer. That is acceptable. The important rule is that the UI must not invent fake controls for providers that do not truly support them.

Changing Agent Flags should keep the user in the same conversation rather than automatically starting a fresh conversation. This matches the current Codex behavior in the chat page, where provider and model changes create a new conversation for the next send but flag changes do not. For this story, provider-neutral Agent Flags should preserve that existing interaction model: a flag change affects later sends in the current conversation instead of resetting the visible transcript.

This story also extends the same parity principle to the MCP chat interface. The current `codebase_question` MCP tool still hardcodes provider support to Codex and LM Studio. Users want Copilot to feel equally usable when chat is driven through the MCP surface, not only when it is driven through the browser page. This story therefore includes provider-contract work so Copilot can be selected through the chat MCP interface anywhere that the current chat provider contract is meant to be shared.

Another important contract decision is that fallback behavior remains provider-first. If `CODEINFO_CHAT_DEFAULT_PROVIDER` points to a provider that is unavailable or misconfigured, the server should fall back to the next available provider using that fallback provider's own `chat/config.toml` default model. This story should not preserve a hidden hardcoded or env-driven default-model back door once provider-local config files become the source of truth. If a provider-specific chat config file is missing, unreadable, or invalid, that should be treated as a provider misconfiguration that can trigger warning logs and provider fallback rather than silently selecting a surprising model from somewhere else.

The remaining config decision is also now fixed. Each provider's `chat/config.toml` should store both the default model and that provider's default Agent Flags where the repository actually supports them. This makes the provider-local chat config the single source of truth for supported chat defaults instead of repeating the current Codex split where some defaults come from `codex/chat/config.toml`, some come from env vars, and some are still hardcoded. This story therefore includes a small Codex cleanup as well as new Copilot and LM Studio config seeding.

Provider-local chat config changes should be reflected by the next relevant request rather than only after a restart. This matches the current Codex precedent, where defaults are reread through normal request-time resolution instead of a separate file watcher. In practice, that means a user who edits `chat/config.toml` should see the new default behavior on the next matching chat or model/default lookup request without needing a server restart, while the story stays out of scope for background live-watch hot reload.

This story is intentionally focused on normal chat and chat-MCP parity. It should not expand into every other agentic execution surface in one go. General agent runs, flows, and command execution already have their own provider and tooling assumptions and should only be touched where they are required for the chat MCP parity contract being targeted here.

Overall, when this story is complete:

- a user can choose Copilot as the default chat provider through the existing provider-default env path;
- the actual default Copilot model comes from `copilot/chat/config.toml`;
- the chat page shows `Agent Flags` rather than `Codex flags`;
- each provider shows only its supported options;
- Copilot can use tools through the normal chat page and the shared chat MCP interface;
- provider-local chat defaults feel consistent across Codex, Copilot, and LM Studio;
- Copilot auth and runtime state remain safely rooted in `copilot/`;
- valid provider-local chat config files are seeded automatically for Codex, Copilot, and LM Studio in gitignored repo-local folders.

### Acceptance Criteria

- `CODEINFO_CHAT_DEFAULT_PROVIDER` remains the single top-level environment variable used to choose the preferred default chat provider.
- `CODEINFO_CHAT_DEFAULT_MODEL` is removed from the active chat-default contract for this repository.
- The default chat model for Codex is read from `codex/chat/config.toml`.
- The default chat model for Copilot is read from `copilot/chat/config.toml`.
- The default chat model for LM Studio is read from `lmstudio/chat/config.toml`.
- The provider-local `chat/config.toml` files are treated as repo-owned product defaults seeded by the application, not as proof that every provider natively consumes the same file format itself.
- Each provider's `chat/config.toml` stores both the default model and that provider's default Agent Flags where that provider actually supports them.
- The story includes the small Codex cleanup needed so supported Codex chat defaults are owned by provider-local chat config rather than remaining split across config, env, and hardcoded values.
- Copilot auth and runtime state remain rooted in the existing `copilot/` home contract rather than being moved into `copilot/chat/`.
- `copilot/chat/config.toml` is not used as Copilot's runtime `configDir`.
- If the configured default provider is unavailable, the server falls back to the next available provider using that fallback provider's own provider-local default model.
- If a provider-local chat config file is missing, unreadable, or invalid, the server treats that provider as misconfigured for default-model resolution and logs or reports that condition clearly enough for operators to understand why fallback happened.
- The application seeds valid `chat/config.toml` files for Codex, Copilot, and LM Studio rather than requiring users to create those files by hand before chat works correctly.
- The local bootstrap path that creates required repo-local provider folders is extended to create the LM Studio chat-defaults folder.
- The repo `.gitignore` rules keep the repo-local provider folders out of Git, including the LM Studio provider folder introduced by this story.
- Changes to provider-local `chat/config.toml` files are picked up on the next relevant request rather than only after a server restart.
- This story does not require a background file watcher or immediate live propagation for provider-local config edits.
- The chat page no longer depends on a Codex-only `Codex flags` concept as its primary provider-options architecture.
- The chat page exposes a provider-neutral `Agent Flags` surface.
- The `Agent Flags` surface is driven by provider capability metadata from the server rather than by hardcoded `provider === 'codex'` checks in the client.
- The provider-capability contract includes enough metadata for the client to render supported options, defaults, and editability without inferring them from provider names.
- Codex continues to expose its currently supported chat options through the provider-neutral `Agent Flags` contract.
- Copilot exposes only the options that are truly supported by the repository's Copilot integration and the installed SDK path used here.
- LM Studio exposes only the options that are truly supported by the repository's LM Studio integration.
- This story does not require Copilot or LM Studio to expose the same number of editable flags as Codex.
- Changing Agent Flags does not automatically start a new conversation.
- A change to Agent Flags affects later sends in the current conversation rather than clearing the transcript or forcing a fresh draft.
- The client no longer sends provider-specific chat options through a `codexFlags`-only request shape as the primary chat-page contract.
- The shared chat request contract becomes provider-neutral enough to carry provider-specific agent options without preserving Codex-only naming as the main abstraction.
- Server-side chat validation continues to reject provider-specific options that are not valid for the selected provider.
- Normal chat execution can create Copilot sessions with repository-managed tools wired in through the existing Copilot session seam.
- Copilot tool wiring uses the repository's own app-managed tool construction path as the primary parity mechanism for this story.
- Copilot tool parity does not depend on native provider-side MCP config discovery being present or enabled.
- The chat page can use Copilot with tools available through the same product-managed tool layer that underpins the supported chat-tool experience elsewhere in the repository.
- The chat MCP interface supports Copilot anywhere the current shared chat-provider contract is expected to accept a provider choice, including the current `codebase_question` path.
- MCP chat requests using Copilot follow the same provider-resolution and validation rules as the normal chat page rather than using a second special-case provider contract.
- The public chat MCP request contract stays limited to provider and model selection in this story and does not add Agent Flags.
- Shared provider and model contracts returned by the server are updated so the client can render provider-neutral defaults and capability data without depending on Codex-only payload fields as the main mechanism.
- Any remaining Codex-specific response fields that still need to exist for compatibility must no longer be the primary way the client decides which provider controls to render.
- Existing Codex behavior remains working after the provider-neutral refactor, including current Codex defaults, model capability handling, and tool-aware chat behavior.
- Existing LM Studio behavior remains working after the provider-neutral refactor, including provider discovery, model loading, and normal chat execution.
- Existing Copilot provider availability, model loading, and conversation execution remain working while gaining the stronger defaults and tool parity described here.
- The documentation and seeded provider config comments explain that `CODEINFO_CHAT_DEFAULT_PROVIDER` chooses the provider and each provider's `chat/config.toml` chooses that provider's default chat model.
- Tests are updated to cover provider-local model defaults, provider fallback using per-provider config files, provider-neutral Agent Flags rendering, Copilot tool wiring, provider-neutral request validation, and Copilot support in the chat MCP interface.

### Out Of Scope

- Replacing provider-specific native runtime configs with one universal provider runtime format.
- Moving Copilot auth or runtime state out of `copilot/` and into `copilot/chat/`.
- Making Copilot's native CLI or SDK config discovery the primary product mechanism for tool parity.
- Exposing every possible native Copilot CLI or SDK option in the chat page.
- Inventing fake Copilot or LM Studio flags purely for UI symmetry with Codex.
- Requiring users to hand-create provider-local chat config folders or files before the supported chat providers can work with their seeded defaults.
- Requiring a full restart before provider-local `chat/config.toml` changes can affect later requests.
- Adding a background file-watch hot reload system for provider-local chat config changes.
- Broad refactors of non-chat agent execution surfaces unless a change is directly required for the shared chat MCP provider contract.
- Reworking flow execution, command execution, or agent execution to use the same provider-default architecture in this story unless they are explicitly part of the chat MCP path being updated.
- Adding new provider types beyond Codex, Copilot, and LM Studio.
- Redesigning authentication UX beyond what is needed to keep existing provider auth flows coherent with the stronger chat-provider contract.
- Introducing a second environment variable for default chat model selection after provider-local chat config becomes the source of truth.
- Preserving hidden hardcoded model selection as a silent fallback once provider-local chat config is required for default-model resolution.
- Adding Agent Flags to the public chat MCP request contract in this story.
- Automatically starting a new conversation just because Agent Flags changed.
- Requiring Copilot and LM Studio to expose exactly the same editable controls that Codex exposes.
- Rebuilding unrelated chat transcript presentation outside the work needed to support provider-neutral flags, defaults, and tool parity.

### Additional Repositories

- No Additional Repositories

### Questions

1. Should Copilot and LM Studio start with no extra editable Agent Flags, or should this story define their first flags now?
   - Why this is important: This decides whether the new `Agent Flags` surface is mostly a provider-neutral shell around existing Codex controls at first, or whether this story must also define concrete first-wave Copilot and LM Studio flags.
   - Best Answer: Start with no extra editable Agent Flags for Copilot and LM Studio in this story unless we can name a small, clearly supported set right now. Repo precedent already says the first Copilot story should allow tools and permissions by default without adding Copilot permission controls to the chat UI, and LM Studio currently has no comparable flag surface at all. That means the safer first step is a provider-neutral `Agent Flags` contract that can honestly show “no extra editable flags” for those providers instead of inventing controls that the current repository and SDK seams have not defined well yet.
   - Where this answer came from: Repo evidence from [planning/0000051-github-copilot-sdk-chat-provider.md](/home/d_a_s/code/codeInfo2/planning/0000051-github-copilot-sdk-chat-provider.md), [server/src/chat/interfaces/ChatInterfaceCopilot.ts](/home/d_a_s/code/codeInfo2/server/src/chat/interfaces/ChatInterfaceCopilot.ts), [server/src/routes/chatValidators.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chatValidators.ts), and [client/src/components/chat/CodexFlagsPanel.tsx](/home/d_a_s/code/codeInfo2/client/src/components/chat/CodexFlagsPanel.tsx); external evidence from DeepWiki guidance showing that the Copilot SDK can support per-session tool filtering and MCP configuration, which confirms that exposing those as user-facing flags is a product choice rather than an already-settled requirement.
2. Should the new `lmstudio/` folder hold only the seeded chat config, or should it also hold LM Studio runtime state?
   - Why this is important: This decides whether `lmstudio/` is just an app-managed defaults folder like the story currently implies, or whether it becomes a broader provider-state home with extra persistence meaning.
   - Best Answer: The new `lmstudio/` folder should hold only the seeded chat config in this story, not LM Studio runtime state. Current repo precedent does not define an LM Studio runtime-home concept comparable to `copilot/`, so using `lmstudio/` only for app-managed chat defaults keeps scope smaller and avoids inventing a new persistence contract that this story does not otherwise need.
   - Where this answer came from: Repo evidence from [server/src/routes/lmstudio.ts](/home/d_a_s/code/codeInfo2/server/src/routes/lmstudio.ts), [server/src/lmstudio/clientPool.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/clientPool.ts), [server/src/lmstudio/tools.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/tools.ts), [scripts/docker-compose-with-env.sh](/home/d_a_s/code/codeInfo2/scripts/docker-compose-with-env.sh), and [planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md](/home/d_a_s/code/codeInfo2/planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md); external evidence was not needed because the ambiguity is about this repository's own folder contract rather than an external SDK requirement.

## Decisions

1. The chat MCP interface should stay provider/model-defaults-only in this story.
   - The question being addressed: In the chat MCP interface, should requests use only provider and model defaults, or should they also accept Agent Flags?
   - Why the question matters: This determines whether Copilot MCP parity means shared defaults and provider support, or whether the story also has to expand the public MCP request contract with a second flags surface.
   - What the answer is: Keep the chat MCP request contract limited to provider and model selection in this story, and do not add Agent Flags to the public MCP input shape yet. Copilot parity in MCP should come from provider support, shared default resolution, and server-managed tool wiring rather than from exposing every chat-page control through MCP.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/mcp2/tools/codebaseQuestion.ts](/home/d_a_s/code/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/home/d_a_s/code/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), and [planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md](/home/d_a_s/code/codeInfo2/planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md), plus external evidence from DeepWiki and GitHub Copilot documentation showing that Copilot can support per-session tools and MCP configuration even when the product keeps its public MCP request contract small.
   - Why it is the best answer: It keeps the story focused, preserves a simple MCP contract, avoids adding a second provider-flags API surface before the provider-neutral chat-page contract is settled, and still delivers the user-facing parity goal that Copilot can be selected and run through the shared chat MCP path.
2. Agent Flag changes should stay in the current conversation.
   - The question being addressed: If a user changes Agent Flags, should the next message stay in the same conversation, or start a new conversation?
   - Why the question matters: This decides whether changing tools or runtime posture resets the visible transcript or simply affects later sends inside the current thread.
   - What the answer is: Keep Agent Flag changes in the same conversation. A flag change should affect later sends in the current conversation rather than automatically starting a fresh draft.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [client/src/pages/ChatPage.tsx](/home/d_a_s/code/codeInfo2/client/src/pages/ChatPage.tsx), [client/src/hooks/useChatStream.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useChatStream.ts), and [client/src/test/chatPage.newConversation.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/chatPage.newConversation.test.tsx), which show that provider and model changes trigger next-send new-conversation behavior while existing flag changes do not.
   - Why it is the best answer: It preserves the current user experience, avoids surprising transcript resets when the user only changes runtime controls, and keeps the provider-neutral Agent Flags refactor aligned with existing chat-page behavior instead of introducing a second conversation-reset rule.
3. Provider-local chat config should store supported default Agent Flags as well as the default model, and the app should seed valid provider folders and config files.
   - The question being addressed: Should each provider's `chat/config.toml` store only the default model, or also that provider's default Agent Flags?
   - Why the question matters: This determines whether provider-local chat defaults become the true single source of truth or whether the repository keeps the current split between config files, env vars, and hardcoded defaults.
   - What the answer is: Each provider's `chat/config.toml` should store both the default model and that provider's default Agent Flags where that provider actually supports them. The application should seed valid provider-local chat config files for Codex, Copilot, and LM Studio, and the local bootstrap shell path should create the LM Studio folder as part of that setup. The repo's gitignore rules should keep those repo-local provider folders out of Git, including the new `lmstudio/` folder.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/config/chatDefaults.ts](/home/d_a_s/code/codeInfo2/server/src/config/chatDefaults.ts), [server/src/codex/capabilityResolver.ts](/home/d_a_s/code/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/config/runtimeConfig.ts](/home/d_a_s/code/codeInfo2/server/src/config/runtimeConfig.ts), [scripts/docker-compose-with-env.sh](/home/d_a_s/code/codeInfo2/scripts/docker-compose-with-env.sh), and [.gitignore](/home/d_a_s/code/codeInfo2/.gitignore); external evidence from the official Codex config docs and DeepWiki guidance on per-session Copilot configuration, which show that chat defaults can legitimately include more than model selection even when the product chooses to store them in its own provider-local config layer.
   - Why it is the best answer: It removes the current Codex inconsistency, makes provider-local defaults genuinely complete, avoids manual setup steps for users, and keeps runtime/provider folders predictable and out of source control noise.
4. Provider-local config changes should be picked up on the next request.
   - The question being addressed: Should changes to `chat/config.toml` take effect on the next request, or only after restart?
   - Why the question matters: This sets user expectations for how quickly provider-local config edits affect later chat behavior.
   - What the answer is: Pick up `chat/config.toml` changes on the next relevant request rather than only after restart. This story does not require a background watcher; request-time reread is enough.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/home/d_a_s/code/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), [server/src/config/runtimeConfig.ts](/home/d_a_s/code/codeInfo2/server/src/config/runtimeConfig.ts), and [server/src/config/chatDefaults.ts](/home/d_a_s/code/codeInfo2/server/src/config/chatDefaults.ts), which already establish request-time reread precedent for Codex chat defaults.
   - Why it is the best answer: It matches current repo behavior, gives quick operator feedback, and avoids expanding this story into a separate hot-reload watcher project.

## Implementation Ideas

- Introduce one shared provider-chat-default loader that can resolve `model` and any provider-specific chat-default fields from `<provider>/chat/config.toml`.
- Keep Codex using the existing repo-owned `codex/chat/config.toml` contract, but move the higher-level chat-default resolution path away from Codex-only naming and clean up the remaining split defaults.
- Add repo-owned `copilot/chat/config.toml` and `lmstudio/chat/config.toml` bootstrap or validation paths so all three providers participate in the same product-level defaults contract.
- Remove `CODEINFO_CHAT_DEFAULT_MODEL` from runtime chat-default resolution, docs, and tests so the provider-local config files become the single source of truth for default model selection.
- Move supported Codex chat defaults fully into the provider-local chat config path so the story does not preserve the current split where some Codex defaults still come from env or hardcoded values.
- Update provider fallback resolution so it first picks an execution provider and then loads that provider's own default model from its config file.
- Treat missing or invalid provider-local chat config as a provider-default misconfiguration, not as a reason to silently reach for a hardcoded fallback model on the same provider.
- Keep provider-local config resolution request-driven so edits are reflected on the next relevant request without requiring restart-time-only behavior or a background watcher.
- Seed valid provider-local chat config files for Codex, Copilot, and LM Studio rather than depending on manual user setup.
- Extend [scripts/docker-compose-with-env.sh](/home/d_a_s/code/codeInfo2/scripts/docker-compose-with-env.sh) or the equivalent local bootstrap path so it creates the LM Studio provider folder alongside the existing Codex and Copilot repo-local folders.
- Update [.gitignore](/home/d_a_s/code/codeInfo2/.gitignore) so the LM Studio provider folder stays out of source control with the existing Codex and Copilot runtime folders.
- Replace Codex-only response concepts such as `codexDefaults` as the main client-driving mechanism with a provider-neutral capability or defaults payload that can describe supported agent options for all providers.
- Rename the client `CodexFlagsPanel` into a provider-neutral `AgentFlagsPanel` and render its controls from server-provided capability metadata.
- Replace the current `codexFlags` send path with a provider-neutral request shape such as `agentFlags`, while still validating provider-specific fields on the server.
- Preserve the current interaction model where changing Agent Flags updates later sends in the same conversation instead of triggering a next-send new-conversation reset.
- Keep the rule that unsupported provider-specific options are rejected or ignored deterministically by validation rather than being passed through silently.
- Wire Copilot tool support through the existing `toolsFactory` seam in the Copilot chat interface and through the shared chat factory so normal chat sessions receive repository-managed tools.
- Reuse the repository's existing trusted tool-building path as much as possible so Copilot and Codex tool behavior stay aligned at the product layer even if their native runtimes differ underneath.
- Extend the chat MCP provider contract, including the `codebase_question` path, so `provider: 'copilot'` is accepted and resolved through the same provider-default logic as normal chat.
- Keep the MCP request input focused on provider and model in this story; let provider-local defaults and server-managed tooling supply the rest of the Copilot parity behavior.
- Keep Copilot's runtime home and auth state under the current `copilot/` resolution path, and ensure any new Copilot chat-default file is read separately from the runtime `configDir`.
- Update shared server and client contracts so provider capability metadata can describe fields such as labels, option types, supported values, defaults, and whether a field is editable.
- Keep the provider-capability contract honest: if Copilot has fewer editable chat options than Codex in the installed SDK path, surface fewer options rather than creating fake controls.
- Update docs and seeded provider config comments so operators understand the new rule: choose the default provider with `CODEINFO_CHAT_DEFAULT_PROVIDER`, then set each provider's default model in that provider's own `chat/config.toml`.
- Add unit and integration coverage for provider-local config resolution, fallback across providers, missing-config handling, Agent Flags payload validation, Copilot tool registration, and Copilot execution through the chat MCP interface.
