# Story 0000059 PR Summary

- Plan: `planning/0000059-users-can-use-external-openai-compatible-endpoints-with-codex-and-copilot.md`
- Repository scope: current repository only
- Manual proof bundle: `codeInfoStatus/manual-proof/0000059/`

## Final Summary

1. Story 0000059 ships external OpenAI-compatible endpoint support across the parser, discovery, picker identity, runtime translation, persistence, and fallback layers. The final contract keeps `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` as the discovery source, requires explicit `/v1` endpoints, preserves endpoint identity separately from raw model ids, and keeps endpoint-backed selection scoped to chat while leaving the LM Studio and Agents-page contracts unchanged.
2. The major behavior changes are endpoint-aware model discovery and picker bootstrap, `selectedEndpointId` and persisted `flags.endpointId` handling, endpoint-aware runtime config translation for Codex/Copilot/agents, and fallback/fail-in-place behavior that distinguishes same-endpoint repair, same-provider native fallback, and cross-provider fallback.
3. The durable documentation now reflects the shipped contract in `README.md` and `projectStructure.md`, and the story-owned proof surfaces were expanded in the server Cucumber suites, client/browser tests, and the new endpoint helper and support fixtures that back those scenarios.
4. Reviewers should focus on the parser/discovery helpers in `server/src/config/openaiCompatEndpoints.ts` and `server/src/chat/openaiCompatModelDiscovery.ts`, the picker and persistence seams in `client/src/components/chat/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `server/src/routes/chat.ts`, and the endpoint-aware fallback contract in `server/src/config/chatDefaults.ts` plus the story-specific feature, integration, and e2e tests.

## Proof Notes

- Automated proof and manual proof are recorded in the story plan and retained proof bundle as they are completed during close-out.
- The supported manual-proof surface remains the checked-in main stack plus any separately running external OpenAI-compatible `/v1` endpoint configured through `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
