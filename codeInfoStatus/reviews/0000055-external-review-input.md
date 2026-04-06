client/src/components/ingest/RootsTable.tsx
@@ -31,6 +32,7 @@ export type RootsTableProps = {
isLoading: boolean;
error?: string;
disabled?: boolean;
Copilot AI
25 minutes ago
disabled is still part of RootsTableProps and is destructured, but the updated interaction gating logic appears to rely on busy/hasActiveRun/queue state and no longer uses disabled. If callers still pass disabled to block interactions (previous behavior), this prop should be consistently applied (e.g., to selection, buttons, and bulk actions) or removed from the API to avoid a misleading/unused prop.

Suggested change
disabled?: boolean;
Copilot uses AI. Check for mistakes.
@Chargeuk Reply...
client/src/components/ingest/RootsTable.tsx
client/src/components/ingest/RootsTable.tsx
Comment on lines +171 to +186
const data = (await res.json()) as {
queued?: boolean;
requestId?: string;
runId?: string;
queuePosition?: number | null;
};
if (data?.runId) {
onRunStarted?.(data.runId);
}
setStatus(path, { status: 'success', message: 'Re-embed started' });
setStatus(path, {
status: 'success',
message:
data?.queued === true
? `Queued${typeof data.queuePosition === 'number' ? ` (#${data.queuePosition})` : ''}`
: 'Re-embed started',
});
Copilot AI
25 minutes ago
doReembed() treats any 2xx response as success even if the payload is missing required acceptance fields. In particular, if neither queued === true nor a non-empty runId is present, the UI will show success ('Re-embed started') even though the server didn't confirm execution or queue admission. Consider validating the response similarly to IngestForm (e.g., require a requestId, and require either queued === true or a non-empty runId), otherwise surface an error so the user doesn’t get a false-positive success state.

Copilot uses AI. Check for mistakes.
@Chargeuk Reply...
client/src/hooks/useIngestRoots.ts
Comment on lines 24 to +28
export type IngestRoot = {
runId: string;
requestId?: string | null;
runId?: string | null;
queuePosition?: number | null;
queueState?: IngestQueueState | null;
Copilot AI
25 minutes ago
The new fields are modeled as both optional (?) and nullable (| null). This makes downstream handling more complex because consumers must consider three states (undefined/null/value). If the intent is “field always present but maybe null,” prefer requestId: string | null etc; if the intent is “field may be omitted,” prefer requestId?: string etc. Picking one approach will simplify UI logic and reduce ambiguous semantics.

Copilot uses AI. Check for mistakes.
@Chargeuk Reply...
client/src/test/chatPage.flags.websearch.payload.test.tsx
const resetSwitch = await screen.findByTestId('web-search-switch');
await waitFor(() => expect(resetSwitch).toBeChecked());
});
}, 10000);
Copilot AI
25 minutes ago
This increases the entire test timeout to 10s. If the underlying issue is intermittent async UI readiness, it’s usually clearer to increase the timeout on the specific waitFor(...) / findBy... call that needs it (or fix the missing await/flush) rather than extending the full test window, which can hide real hangs and slows failure feedback.

Copilot uses AI. Check for mistakes.

server/src/ingest/reingestService.ts
Comment on lines +415 to +419
canonicalTargetPath: resolvedRunPath,
operation: 'reembed',
sourceSurface: 'reingest_repository',
requestPayload: {
path: resolvedRunPath,
@chatgpt-codex-connector
chatgpt-codex-connector bot
19 minutes ago
P1 Badge Preserve canonical root when queueing reembed requests

Using resolvedRunPath for both canonicalTargetPath and queued path remaps legacy roots (for example, /data/... to the codex workdir path) before re-embed execution. processRun then keys delta lookup and cleanup by exact root (listIngestFilesByRoot(root), deleteVectors({ where: { root } }), deleteRoots({ where: { root } })), so existing records under the original root are missed; this can trigger a fresh ingest under a new root key while stale vectors/metadata remain under the old key. Keep the persisted root identity for re-embed bookkeeping (or explicitly clean both aliases) to avoid duplicate/corrupted ingest state.

Useful? React with 👍 / 👎.

@Chargeuk Reply...
server/src/routes/ingestRoots.ts
path: sourceId,
const lock = payload.lock ?? null;
logLockResolverState(requestId, 'ingest/roots', lock);
const roots: RootEntry[] = payload.repos.map((repo) => {
@chatgpt-codex-connector
chatgpt-codex-connector bot
19 minutes ago
P2 Badge Reintroduce path-level deduping in ingest roots response

The route now serializes payload.repos directly, but that source can contain multiple metadata rows for the same repository path because each ingest run writes a new root entry. Without a path-level dedupe step, /ingest/roots can return duplicate rows for one repo after repeated ingests, and queue/active overlays only update one of those entries, leaving stale/conflicting state in the UI for actions keyed by path.

Useful? React with 👍 / 👎.
