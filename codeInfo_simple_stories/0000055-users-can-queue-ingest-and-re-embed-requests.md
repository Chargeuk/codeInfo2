# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit ingest and re-embed requests while another ingest run is active, and the system remembers that work instead of rejecting it as busy.
2. Users can see queued repository work in the ingest repository list, including a clear waiting position when work has not started yet.
3. Users and automation receive both a durable `requestId` for queued work and a `runId` once execution actually starts.
4. Users are protected from unsafe queue recovery; cleanup-blocked work stays visible and prevents newer queued work from starting too early.
5. Users and automation receive clear retryable queue errors when Mongo-backed queue persistence is unavailable.
6. Business users can rely on the final reviewed contract: queue state, repo-list identity, OpenAPI documentation, artifact hygiene, destructive actions, and blocking automation behavior stay aligned.

# Description

This story makes ingest and re-embed work durable, visible, and predictable when the server is already busy. Instead of forcing users or automation to retry later, the system records queued work, shows where it is in line, and starts it safely when earlier work finishes. The final tasked plan also closes review findings around mounted re-embed paths, queue response state, waiting-row rewrite safety, destructive remove payloads, support-artifact hygiene, cleanup-blocked visibility, malformed request validation, repo-list identity, startup replay safety, and proof quality before the story is closed again.

# Tasks

1. [codeInfo2] - Add durable queue storage and canonical queue admission.

- Create the Mongo-backed request queue and normalize ingest or re-embed requests before dedupe.
- Prove queue persistence, duplicate handling, and queue-unavailable behavior through server tests.

2. [codeInfo2] - Add queue runtime lifecycle and startup recovery.

- Keep waiting, running, and cleanup-blocked queue states small and explicit.
- Prove cleanup-before-next ordering, startup recovery, cancellation, and cleanup-blocked retry behavior.

3. [codeInfo2] - Replace queueable REST, MCP, command, and flow contracts.

- Return queue-aware response fields and preserve blocking automation behavior through shared service paths.
- Prove REST, MCP, command, and flow callers receive the correct queued, running, and unavailable results.

4. [codeInfo2] - Show queued work in the shared repository list and ingest UI.

- Update the shared repo-list payload, client normalization, and table behavior so queued rows and queue positions are visible.
- Prove queued visibility through client tests, server contract tests, and e2e coverage.

5. [codeInfo2] - Repair test baselines and proof harnesses exposed during queue implementation.

- Restore trustworthy server-unit, Cucumber, client, e2e, Compose, lint, and format wrapper proof as blockers are found.
- Keep unrelated harness or baseline repairs isolated so queue feature proof remains honest.

6. [codeInfo2] - Close earlier review-created queue contract repairs.

- Harden deferred validation, canonical row identity, queue diagnostics, stale-state cleanup, and OpenAPI contracts from previous review passes.
- Revalidate each review-created block with repository-supported wrapper proof and durable summary updates.

7. [codeInfo2] - Treat cleanup-blocked as a client terminal queue state.

- Update client terminal-state consumers so `cleanup-blocked` refreshes roots, preserves the error state, and removes stale cancellation affordances.
- Add client proof for live cleanup-blocked updates, active-run rendering, and stale action payload exclusion.

8. [codeInfo2] - Make blocking re-embed waits use a long safety guard.

- Update the shared re-embed service so normal queue delay does not trip the old short wait timeout.
- Prove the production default, injected timeout tests, and MCP, command, and flow propagation paths.

9. [codeInfo2] - Reject malformed start-ingest body fields before queue admission.

- Validate `name`, `description`, `dryRun`, and unexpected body keys before any queue document is created.
- Prove malformed bodies are rejected, valid queue responses remain intact, and OpenAPI/Cucumber contracts match.

10. [codeInfo2] - Realign repo-list runtime, OpenAPI, and queue overlay identity.

- Align runtime repo-list fields, OpenAPI schemas, MCP/tool consumers, and client normalization around one canonical identity.
- Prove fresh running model metadata, mismatched-path isolation, documented fields, and stale selected-row exclusion.

11. [codeInfo2] - Persist a replay barrier before non-idempotent finalization side effects.

- Persist `nonReplayableAt` before finalization side effects that must not be repeated after restart.
- Prove barrier ordering, fail-closed barrier writes, startup recovery, and cleanup/delete-before-next behavior.

12. [codeInfo2] - Make BDD queue-start proof distinguish attempts from accepted starts.

- Record attempted queue processor execution separately from validation-passed started paths in the Cucumber helper.
- Prove no-attempt, attempted-but-rejected, and unfinished replay scenarios with clear feature wording.

13. [codeInfo2] - Deduplicate queue-state literals in the queue schema index.

- Replace duplicated live-state literals with a named queue-state contract for the partial index.
- Prove the live-target index still covers exactly `waiting`, `running`, and `cleanup-blocked`.

14. [codeInfo2] - Preserve mounted execution paths for queued re-embed.

- Keep queue identity separate from the mounted filesystem path used when queued work finally runs.
- Prove REST, MCP, command, and flow callers use the repaired queued re-embed contract.

15. [codeInfo2] - Restore queue-state response and live-state contracts.

- Add the non-waiting `running` queue state to immediate ingest and re-embed responses.
- Reuse the shared live-state set for repository-list overlays and prove OpenAPI, server, and client consumers stay aligned.

16. [codeInfo2] - Guard waiting queue rewrites with the observed row.

- Require waiting duplicate rewrites to match the specific queue row that was observed.
- Prove stale duplicate intent cannot overwrite a newer waiting row.

17. [codeInfo2] - Keep destructive remove actions on root-path payloads.

- Separate re-embed identity from the root path used by row and bulk Remove.
- Prove stale selected rows stay local-only and bulk Remove refreshes once after the batch.

18. [codeInfo2] - Clean review-exposed runtime artifact hygiene.

- Redact provider account metadata from retained manual proof and scan sibling artifacts for the same risk.
- Move generated screenshots out of tracked payload paths and keep future automated screenshots in ignored storage.

19. [codeInfo2] - Revalidate Story 55 after the latest review-created findings block.

- Refresh the durable PR summary so findings `F1` through `F7` map to the repaired implementation and proof homes.
- Run the supported server, client, e2e, Compose smoke, lint, and format wrappers before closing the story again.
