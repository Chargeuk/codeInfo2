# Story 0000056 PR Summary

## What Changed

Story 56 makes Copilot a first-class chat provider under the same provider-local defaults and provider-neutral Agent Flags contract now shared by Codex, Copilot, and LM Studio. The finished implementation removes the old Codex-only chat page architecture, keeps `CODEINFO_CHAT_DEFAULT_PROVIDER` as the single top-level selector, moves default-model ownership into provider-local `chat/config.toml` files, and extends the same provider-selection rules into the normal chat route and MCP `codebase_question`.

The story also closes the biggest Copilot parity gaps that still existed after Story 51. Copilot now has repo-owned chat defaults in `copilot/chat/config.toml`, repository-managed tool parity on the shared chat runtime, resilient auth-home bootstrap that tolerates Copilot-managed JSONC artifacts, and a truthful provider-neutral `toolAccess` Agent Flag instead of inheriting Codex-shaped UI or payload behavior.

## Major Story Steps

- Tasks 1 through 6 established the shared provider-local defaults layer by seeding and reading `codex/chat/config.toml`, `copilot/chat/config.toml`, and `lmstudio/chat/config.toml` through one normalized server contract instead of through a shared default-model env var.
- Tasks 5 and 6 extended the shared server discovery and validation seams so `/chat/providers`, `/chat/models`, request validation, and MCP provider selection all consume the same provider-first defaults and availability contract.
- Task 7 finished the user-facing rewrite: the browser chat page now renders `AgentFlagsPanel`, keeps one `agentFlagsDraft`, sends nested `agentFlags`, preserves same-conversation flag edits, and still treats provider/model changes as next-send new-conversation boundaries.
- The later Task 7 proof-authoring passes migrated the old Codex-only client suites, support helpers, and browser proofs onto the provider-neutral panel and nested payload contract, then closed the final websocket-harness seam for same-conversation reasoning edits.
- Task 8 is the final story closeout layer: it syncs the operator-facing docs, updates the structural ledger, creates this reviewer summary, and leaves the broad wrapper-based validation surface ready for the later audit step.

## Traceability And Scope Audit

- Provider-local defaults are now owned by:
  - `server/src/config/chatDefaults.ts`
  - `server/src/routes/chatDiscovery.ts`
  - `server/src/routes/chatModels.ts`
  - `server/src/routes/chat.ts`
  - `server/src/mcp2/tools/codebaseQuestion.ts`
- Provider-neutral Agent Flags are now owned by:
  - `common/src/lmstudio.ts`
  - `client/src/components/chat/AgentFlagsPanel.tsx`
  - `client/src/hooks/useChatModel.ts`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/pages/ChatPage.tsx`
- Copilot parity repairs are now owned by:
  - `server/src/chat/copilotModelSupport.ts`
  - `server/src/chat/copilotTools.ts`
  - `server/src/config/copilotSeedBootstrap.ts`
  - `server/src/config/copilotConfig.ts`
  - `server/src/routes/copilotDeviceAuth.ts`
  - `server/src/providers/copilotReadiness.ts`
- Proof ownership is spread intentionally across:
  - server unit and integration suites for defaults, readiness, model mapping, Copilot lifecycle, and MCP parity
  - the rewritten Task 7 client suites for provider-neutral Agent Flags rendering and payload shaping
  - the browser-backed e2e path for provider selection, visible Agent Flags behavior, and conversation-state rules

- Explicit out-of-scope boundaries were preserved:
  - no Copilot agent, command, or flow execution
  - no provider-specific BYOK routing UI
  - no manual-only proof inside automated tasks
  - no new LM Studio runtime home beyond the app-managed defaults folder
  - no provider-specific in-place model switching for existing conversations
  - no granular Copilot approval UI beyond the first-pass permissive runtime handling

## Validation Summary

- Task 7 automated proof is complete:
  - `npm run build:summary:client`
  - `npm run test:summary:client`
  - `npm run test:summary:e2e`
  - `npm run lint`
  - `npm run format:check`
- Task 7 manual validation notes are also recorded in the story plan and confirm the visible Codex, Copilot, and restored-conversation scenarios on a freshly restarted normal stack.
- Task 8 keeps the broader story-wide closeout validation intentionally separate and still pending:
  - server and client build wrappers together
  - compose build summary
  - server unit and cucumber wrappers
  - full client and e2e wrapper reruns at story-close scope
  - normal human stack smoke via `compose:up` + `curl`
  - final story-wide lint and format gates

## Highest-Risk Compatibility Changes

- The default-model contract is no longer “pick provider here, pick model somewhere else.” Future work must preserve `CODEINFO_CHAT_DEFAULT_PROVIDER` as the top-level selector and keep provider-local `chat/config.toml` as the default-model source of truth.
- The provider-neutral `agentFlags` request shape is now the normal chat contract. Future client or server work must not reintroduce top-level Codex-only flag families as the main path.
- `server/src/routes/chatDiscovery.ts` is now the shared provider-model-Agent-Flags discovery seam. Any later route work that forks model data and Agent Flag descriptors into unrelated payload families will regress the page and MCP parity this story established.
- Copilot auth-home compatibility is now tolerant of Copilot-managed JSONC artifacts and repo-owned plaintext-token seeding rules. Future Copilot auth work must preserve that resilience instead of assuming one strict JSON artifact or one stale settings location.
