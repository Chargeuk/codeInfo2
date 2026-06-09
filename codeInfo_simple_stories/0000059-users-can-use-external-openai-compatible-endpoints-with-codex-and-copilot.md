# Users can use external OpenAI-compatible endpoints with Codex and Copilot

# Acceptance

1. Chat users can choose compatible models from external OpenAI-compatible `/v1` endpoints while staying inside the existing `Codex` and `Copilot` chat flows.
2. Support or configuration owners can pin `Codex` or `Copilot` chat defaults to an external endpoint by setting `codeinfo_openai_endpoint` together with `model`.
3. Support or configuration owners can run agents through external `Codex` or `Copilot` endpoints by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model`.
4. Users still see a config-pinned endpoint in chat even when that endpoint is not listed in the shared endpoint environment variable.
5. New runs keep the intended fallback behavior: try the pinned endpoint first, repair within the same provider when possible, and only fall back more broadly when the same-provider path cannot run.
6. Pinned or resumed conversations and executions do not silently drift to a different provider or endpoint when their saved endpoint later becomes unavailable.
7. Older saved conversations still open normally, while newer endpoint-backed conversations keep endpoint identity separate from the raw model id.
8. Final hardening keeps newer conversation metadata from being overwritten by stale writers, makes exhausted metadata retries explicit to callers, and closes the story with full automated revalidation on the checked-in runtime path.

# Description

This story lets the existing `Codex` and `Copilot` chat and agent surfaces use external OpenAI-compatible endpoints without introducing a brand-new top-level provider. It adds endpoint parsing, model discovery, runtime translation, persistence, fallback and resume protections, runtime-proof support, and final review hardening so the feature can ship with reliable server, client, browser, and checked-in compose proof.

# Tasks

1. [codeInfo2] - Upgrade Codex and Copilot SDK baselines before story work
- Update the Codex and Copilot package versions plus the repo-owned version guard.
- Reconfirm the existing harness proof before endpoint work begins.

2. [codeInfo2] - Parse and normalize external endpoint config inputs
- Add the shared parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and `codeinfo_openai_endpoint`.
- Normalize malformed, blank, and duplicate entries consistently.

3. [codeInfo2] - Add shared external endpoint model discovery
- Build the server helper that probes normalized endpoints through `/v1/models`.
- Add shared proof support for ordering, partial failures, and one-probe-per-endpoint behavior.

4. [codeInfo2] - Surface external endpoint models in the chat picker
- Extend the chat discovery contract and chat page state for endpoint-backed `Codex` and `Copilot` models.
- Preserve duplicate-model labels, config-pinned endpoints, and create-versus-reuse picker identity.

5. [codeInfo2] - Translate endpoint selections into runtime config and persistence
- Carry endpoint identity separately from the raw model id through chat payloads and saved conversation state.
- Translate `codeinfo_openai_endpoint` into repo-owned Codex and Copilot runtime settings on the server.

6. [codeInfo2] - Extend fallback, repair, and fail-in-place behavior for endpoint-backed runs
- Add same-endpoint repair, same-provider native fallback, and cross-provider fallback ordering for new runs.
- Preserve fail-in-place behavior for pinned or resumed chat, agent, and flow executions.

7. [codeInfo2] - Restore Docker-backed proof runtime access
- Restore one supported Docker access path so the checked-in proof stack works again.
- Keep this runtime prerequisite separate from product behavior.

8. [codeInfo2] - Capture branch-only runtime seam changes in the story plan
- Record the runtime seam changes needed to prove the story on the checked-in stack.
- Keep the story documentation aligned with the actual proof runtime contract.

9. [codeInfo2] - Restore resume endpoint authority and flow ownership guards
- Tighten direct-agent and flow-owned resume paths so saved endpoint identity stays authoritative.
- Add focused server proof for saved-endpoint precedence and stale flow replay rejection.

10. [codeInfo2] - Complete mobile endpoint Playwright coverage for the chat surface
- Extend the mobile chat browser proof for restored history, fresh reset, and endpoint-backed sends.
- Prove that restored mobile state does not leak stale endpoint identity into the next submission.

11. [codeInfo2] - Final story validation, documentation, and close-out
- Finish README, traceability, and reviewer-facing close-out material for the endpoint contract.
- Re-run the broad story proof bundle across server, client, browser, and checked-in runtime validation.

12. [codeInfo2] - Repair `/chat` conflict authority and fresh-state persistence
- Move the real `/chat` conflict decision ahead of provider bootstrap.
- Merge late conversation metadata writes without replaying stale endpoint or working-folder values.

13. [codeInfo2] - Restore endpoint identity on the `/chat/models` default-selection path
- Keep `/chat/providers`, `/chat/models`, client bootstrap state, and `/chat` submission aligned for endpoint identity.
- Clear stale reuse-mode endpoint state before fresh-draft submission.

14. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260607T101345Z-9dfe9788`
- Re-run the wrapper-first proof for the serious review findings and inline-resolved minor fixes for that cycle.
- Own the final broad regression and checked-in runtime closeout proof for that review block.

15. [codeInfo2] - Reinstate Codex and Copilot readiness gating before endpoint-backed execution
- Restore the shared readiness gate so healthy endpoints cannot bypass degraded provider readiness.
- Prove the repaired ready-versus-blocked execution boundary on the targeted server surfaces.

16. [codeInfo2] - Repair native-default versus endpoint selection identity drift across discovery and submission
- Keep discovery, route payloads, client bootstrap state, and `/chat` submission aligned so native defaults cannot carry stale endpoint identity.
- Preserve duplicate-id endpoint behavior while excluding stale mixed create-versus-reuse endpoint state.

17. [codeInfo2] - Add a durable post-completion replay barrier for fresh flow retry ownership
- Add the bounded replay barrier that returns the earlier result for the same logical retry after ambiguous completion.
- Preserve in-flight dedupe and contradictory-payload rejection while proving the post-completion ordering boundary.

18. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260608T182732Z-e960c572`
- Re-run the broad wrapper-first regression proof for that review-created findings block.
- Own the final server, client, browser, script-guard, and checked-in runtime validation for that cycle.

19. [codeInfo2] - Make `/chat` completed replay results durable across restart boundaries
- Update the `/chat` replay route, inflight registry, and persisted turn metadata so the same `inflightId` can reuse a completed result after cache loss.
- Prove the durable replay path, contradiction rejection, partial-state handling, and late-completed ordering on the targeted server proof files.

20. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260609T050126Z-8ccf6dc6`
- Re-run the final broad proof for that review-created findings block across server, client, browser-visible chat, checked-in runtime smoke, lint, and format validation.
- Re-cover the inline-resolved minor fixes and the new durable `/chat` replay behavior on the repaired story head.

21. [codeInfo2] - Make fresh flow `retryOwnershipId` replay durable across restart boundaries
- Add a durable replay marker and reader for fresh-flow retry ownership without widening the existing flow contract.
- Prove durable replay after cache loss together with contradiction, ordering, partial-state, and cleanup-owner boundaries on the targeted server proof files.

22. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260609T120631Z-47ba57d5`
- Re-run the broad final regression proof for that review-created findings block across server, client, browser-visible chat, checked-in runtime smoke, lint, and format validation.
- Re-cover the fresh-flow retry replay repair and any later inline-resolved minor fixes on the final story head.

23. [codeInfo2] - Prevent intervening writes from reapplying stale conversation flags
- Repair the shared conversation metadata write seam so stale reads cannot overwrite newer `endpointId`, `threadId`, `workingFolder`, or flow-owned flags.
- Add focused proof for the exact older-reader/newer-writer/later-stale-writer contradiction case on the persistence test surface.

24. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260609T173931Z-de51b749`
- Re-run the final broad regression proof for the latest review-created findings block across server, client, browser-visible chat, checked-in runtime smoke, lint, and format validation.
- Re-cover the stale-metadata overwrite repair and keep the final manual-proof handoff aligned to the checked-in main stack.

25. [codeInfo2] - Preserve caller metadata intent when `updateConversationMeta()` exhausts optimistic retries
- Repair the shared metadata helper so failed retry exhaustion no longer returns a success-shaped result when the write never lands.
- Add focused server proof for the exhausted-retry path, the preserved winning state, and any direct caller seam that must surface the new outcome.

26. [codeInfo2] - Final revalidation for review cycle `0000059-rc-20260609T214316Z-d1783561`
- Re-run the full broad regression proof for the current review-created findings block across server, client, browser-visible chat, checked-in runtime smoke, lint, and format validation.
- Keep this cycle as the one final revalidation owner for the latest metadata retry hardening and its checked-in runtime closeout proof.
