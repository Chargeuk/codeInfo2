# Users can use external OpenAI-compatible endpoints with Codex and Copilot

# Acceptance

1. Users can see compatible external OpenAI-compatible endpoint models inside the existing `Codex` and `Copilot` chat pickers without adding a new top-level provider.
2. Users can set the default `Codex` or `Copilot` chat model from a local or remote `/v1` endpoint by configuring `codeinfo_openai_endpoint` together with `model`.
3. Users can configure an agent to run through a `Codex` or `Copilot` external endpoint by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model`.
4. Users can keep a config-pinned endpoint visible in chat even when it is not listed in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
5. Users can rely on duplicate endpoint definitions collapsing to one active endpoint with a warning instead of breaking configuration.
6. Users can keep older saved conversations working while newer endpoint-backed conversations store the raw model id and endpoint identity separately.
7. Users can rely on new runs trying same-endpoint repair and same-provider fallback before broader provider fallback, while pinned or resumed runs fail in place instead of silently moving to a different endpoint or provider.
8. Users keep the current `LM Studio` and `Agents` page behavior for this story; the external model picker change applies only to `Codex` and `Copilot` chat.
9. The final shipped story includes the review hardening needed for `/chat` conflict timing, persisted metadata freshness, endpoint-aware default selection, and final wrapper-backed revalidation.

# Description

This story extends the current `Codex` and `Copilot` experience so teams can point chat and agent flows at external OpenAI-compatible `/v1` endpoints without learning provider-native wiring. It adds a simple repository-owned configuration contract, discovers compatible external models for chat, preserves endpoint identity through saved and resumed work, keeps fallback behavior predictable, records the runtime seams needed for supported proof, and closes the late review issues needed to ship the feature with honest automated validation.

# Tasks

1. [codeInfo2] - Upgrade Codex and Copilot SDK baselines before story work
- Update the Codex and Copilot package versions and the repo-owned version guard.
- Re-check the existing harness proof so endpoint work starts from a current baseline.

2. [codeInfo2] - Parse and normalize external endpoint config inputs
- Add the shared parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and `codeinfo_openai_endpoint`.
- Extend validation so malformed, blank, and duplicate endpoint entries are handled consistently.

3. [codeInfo2] - Add shared external endpoint model discovery
- Build the server helper that calls each normalized endpoint’s `/v1/models` API and merges the results.
- Add the fake endpoint support used by discovery, timeout, and malformed-payload proof.

4. [codeInfo2] - Surface external endpoint models in the chat picker
- Extend the chat discovery contract and chat page state so `Codex` and `Copilot` can show endpoint-backed models.
- Preserve duplicate-model labeling, config-pinned endpoints, and create-versus-reuse picker identity.

5. [codeInfo2] - Translate endpoint selections into runtime config and persistence
- Carry `endpointId` separately from the raw `model` through chat payloads, conversation state, and resume behavior.
- Translate `codeinfo_openai_endpoint` into repo-owned Codex and Copilot runtime settings on the server.

6. [codeInfo2] - Extend fallback, repair, and fail-in-place behavior for endpoint-backed runs
- Add same-endpoint repair, same-provider native fallback, and cross-provider fallback ordering for new runs.
- Preserve fail-in-place behavior for pinned or resumed chat, agent, and flow executions.

7. [codeInfo2] - Restore Docker-backed proof runtime access
- Restore one supported Docker access path so the repository’s wrapper-backed Compose proof can run normally again.
- Keep this runtime prerequisite separate from product behavior so later validation can reuse the normal proof path honestly.

8. [codeInfo2] - Capture branch-only runtime seam changes in the story plan
- Record the runtime seam changes that were required to prove the story on the checked-in stack.
- Keep the story documentation aligned with the actual runtime contract used for proof.

9. [codeInfo2] - Restore resume endpoint authority and flow ownership guards
- Tighten the direct-agent resume branch and the flow-owned resume reader so saved endpoint identity stays authoritative on resumed work.
- Add focused server proof for saved-endpoint precedence and stale flow replay rejection before child-conversation mutation.

10. [codeInfo2] - Complete mobile endpoint Playwright coverage for the chat surface
- Extend the mobile chat browser proof for restored history, fresh-conversation reset, and endpoint-backed send behavior on the supported mobile seams.
- Prove the restored-history-then-fresh mobile path does not leak stale endpoint state into the next `/chat` submission.

11. [codeInfo2] - Final story validation, documentation, and close-out
- Finish the README, structural traceability, and reviewer summary for the external-endpoint contract.
- Re-run the broad story proof bundle across server, client, browser, and checked-in runtime validation.

12. [codeInfo2] - Repair `/chat` conflict authority and fresh-state persistence
- Move the real `/chat` conflict decision ahead of provider bootstrap so active runs always return `RUN_IN_PROGRESS` first.
- Merge late conversation metadata writes without replaying stale `endpointId` or `workingFolder` values over fresher saved state.

13. [codeInfo2] - Restore endpoint identity on the `/chat/models` default-selection path
- Carry authoritative endpoint-aware default-selection identity from `/chat/providers` and `/chat/models` through the shared model shape.
- Restore the right duplicate-id endpoint choice on the client and clear stale reuse-mode identity before fresh-draft submission.

14. [codeInfo2] - Final revalidation for the current review cycle
- Re-run the wrapper-first review-cycle proof for the serious review findings and the inline-resolved minor fixes on the story head.
- Own the final broad regression and checked-in runtime closeout proof across server, client, browser, script guard, and main-stack smoke validation for this cycle.

15. [codeInfo2] - Reinstate Codex and Copilot readiness gating before endpoint-backed execution
- Restore the shared readiness gate so a healthy external endpoint cannot bypass missing or degraded provider readiness on `/chat`, direct-agent, or flow-owned execution.
- Keep the approved fail-closed provider behavior intact while proving the repaired ready-versus-blocked execution boundary on the targeted server surfaces.

16. [codeInfo2] - Repair native-default versus endpoint selection identity drift across discovery and submission
- Keep server discovery, route payloads, client bootstrap state, and `/chat` submission aligned so a native default never carries a stale endpoint identity.
- Preserve duplicate-id endpoint-backed selection behavior while clearing or excluding stale mixed create-versus-reuse endpoint state on the client.

17. [codeInfo2] - Add a durable post-completion replay barrier for fresh flow retry ownership
- Add the bounded replay barrier that returns the earlier result when the same logical retry re-enters after ambiguous completion.
- Preserve the existing in-flight dedupe and contradictory-payload rejection behavior while proving the post-completion ordering boundary directly.

18. [codeInfo2] - Final revalidation for the latest review cycle
- Re-run the broad wrapper-first regression proof for the latest serious review findings and the inline-resolved minor fixes on the repaired story head.
- Own the final server, client, browser, script-guard, and checked-in main-stack smoke validation for the latest review-created findings block.
