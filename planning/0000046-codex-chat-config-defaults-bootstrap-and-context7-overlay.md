# Story 0000046 – Codex Chat Config Defaults Bootstrap And Context7 Overlay

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Codex runtime defaults in the product are currently spread across more than one place. Some behavior already comes from `codex/chat/config.toml`, some model-list behavior still comes from environment variables, and bootstrap logic for missing config files still relies on templates that do not fully match the currently desired defaults. That makes the web chat page, the MCP chat interface, startup bootstrap behavior, and configuration editing harder to reason about than they should be.

Users want one predictable outcome:

- if they set the model in `codex/chat/config.toml`, that model should always appear as an available chat model and should always be the default chat model unless a request explicitly overrides it;
- if they edit `codex/chat/config.toml`, the next request for models or defaults should reflect the file as it exists on disk at that moment;
- if the required config files do not exist yet, the server should generate them from one canonical in-code template instead of depending on external template files that may not exist on another system.

There is also a related environment-key problem for Context7. Current template content contains a Context7 API key argument in config data. The user wants Context7 to be driven by a new environment variable named `CODEINFO_CONTEXT7_API_KEY`. When runtime config is read, any Context7 MCP args that are missing an API key should be overlaid in memory with that env value. The user has explicitly chosen an in-memory overlay, not repeated on-disk config rewriting.

For this story, a placeholder key value of `REPLACE_WITH_CONTEXT7_API_KEY` is treated as “no usable key configured.” If `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, runtime config should overlay that value in memory. If `CODEINFO_CONTEXT7_API_KEY` is missing or empty, runtime config should fall back to the no-key form `args = ['-y', '@upstash/context7-mcp']`, which still works with the provider’s limited unauthenticated allowance.

This story therefore unifies four closely related behaviors:

- model-list resolution;
- default-model resolution;
- deterministic bootstrap of missing `codex/config.toml` and `codex/chat/config.toml`;
- runtime Context7 API-key overlay.

The scope of this story is runtime-config correctness and consistency. It is not about changing prompt behavior, tool guidance, or workflow step execution.

### Acceptance Criteria

- The server treats the model in `codex/chat/config.toml` as a first-class available Codex chat model even when it is not present in `Codex_model_list`.
- When the server resolves the Codex model list, it uses:
  - the environment model list;
  - unioned with the current model value from `codex/chat/config.toml`;
  - with duplicates removed deterministically.
- The model defined in `codex/chat/config.toml` is always the default Codex chat model unless the request explicitly overrides it.
- Default model precedence is:
  - explicit request override;
  - `codex/chat/config.toml`;
  - environment fallback;
  - hardcoded fallback.
- The server rereads `codex/chat/config.toml` from disk each time model availability or default-model selection is requested.
- The web chat model list reflects the current `codex/chat/config.toml` model on each request.
- MCP chat/default-model selection reflects the current `codex/chat/config.toml` model on each request.
- `CHAT_DEFAULT_MODEL` remains a fallback only and no longer overrides a valid model value in `codex/chat/config.toml`.
- If `codex/chat/config.toml` does not exist, the server creates it from one canonical in-code chat-config template.
- If `codex/config.toml` does not exist, the server creates it from one canonical in-code base-config template.
- The canonical in-code templates are the source of truth for first-time file creation and do not depend on runtime access to files such as `codex/chat/config copy.toml`, `codex/config.toml`, or `config.toml.example`.
- Missing-file bootstrap does not overwrite existing user-edited config files.
- Runtime config loading applies `CODEINFO_CONTEXT7_API_KEY` as an in-memory overlay for Context7 MCP args when a Context7 server definition exists and no API key argument is already present.
- Runtime config loading treats `--api-key REPLACE_WITH_CONTEXT7_API_KEY` as equivalent to no usable key being present.
- If a Context7 definition contains the placeholder key and `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, runtime config overlays that env key in memory.
- If a Context7 definition contains the placeholder key and `CODEINFO_CONTEXT7_API_KEY` is missing or empty, runtime config uses the no-key argument form `args = ['-y', '@upstash/context7-mcp']`.
- Runtime config loading does not rewrite config files on disk just to apply `CODEINFO_CONTEXT7_API_KEY`.
- The Context7 overlay applies consistently to the relevant config-reading paths used by chat and agent runtime config loading.
- The resulting runtime config still preserves unrelated MCP-server args and unrelated config values.
- This story removes dependence on checked-in Context7 key material in canonical default templates.
- Public REST and MCP payload shapes remain unchanged for this story.

### Out Of Scope

- Changing agent prompts, MCP tool descriptions, or repository guidance text.
- Adding new workflow step types or command/flow execution behavior.
- Changing auth propagation behavior for agent homes.
- Rewriting user-edited config files on each request to inject environment values.
- Introducing provider-selection behavior changes beyond the default-model and model-list correctness described in this story.
- Building a general-purpose config migration framework.

### Questions

None. The placeholder-key handling and empty-env fallback behavior are now fixed for this story.

## Implementation Ideas

- Consolidate model-list and default-model behavior so the same runtime read path is used by web chat routes and MCP chat tooling.
- Extend the current Codex capability resolution so the model list is based on `env list UNION chat-config model`.
- Keep request override precedence unchanged while lowering `CHAT_DEFAULT_MODEL` to fallback-only status behind `codex/chat/config.toml`.
- Replace reliance on external runtime template files with one canonical in-code base template and one canonical in-code chat template.
- Update bootstrap helpers in `server/src/config/runtimeConfig.ts` and `server/src/config/codexConfig.ts` so first-run creation is deterministic and non-destructive.
- Apply the Context7 API-key overlay during runtime config read/normalization, not during repeated writes.
- Detect existing real `--api-key` args before overlaying anything so explicit user-provided keys still win.
- Treat `REPLACE_WITH_CONTEXT7_API_KEY` as a placeholder, not as a real configured key.
- When the placeholder is present and `CODEINFO_CONTEXT7_API_KEY` is empty, strip the placeholder key args and fall back to the unauthenticated `['-y', '@upstash/context7-mcp']` argument form.
- Add tests for:
  - model list includes chat-config model when env list omits it;
  - chat-config model is default in web and MCP surfaces;
  - reread-from-disk behavior after file edits;
  - missing chat config bootstraps from the in-code template;
  - missing base config bootstraps from the in-code template;
  - Context7 args receive in-memory env overlay only when needed.
