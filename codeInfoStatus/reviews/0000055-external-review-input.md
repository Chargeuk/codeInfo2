client/src/components/ingest/RootsTable.tsx
Comment on lines 34 to +35
  disabled?: boolean;
  hasActiveRun?: boolean;
Copilot AI
1 hour ago
disabled is still part of RootsTableProps and is destructured in the component, but it isn’t referenced anywhere in the updated implementation. If noUnusedLocals/linting is enabled, this can fail builds; even if not, it’s misleading API surface. Either remove disabled from the props type/destructuring (and update callers), or wire it into the button/checkbox disabling logic consistently.

Suggested change
  disabled?: boolean;
  hasActiveRun?: boolean;
Copilot uses AI. Check for mistakes.
@Chargeuk	Reply...
client/src/components/ingest/RootsTable.tsx
              const message = actionState[root.path]?.message;
              const rowDisabled = busy || state === 'loading';
              const removeDisabled =
                rowDisabled || hasActiveRun || blocksUserRemove(root);
Copilot AI
1 hour ago
removeDisabled doesn’t consider root.status === 'ingesting'. That makes it possible for an actively ingesting row (e.g., status: 'ingesting' with no queueState due to older payloads or partial data) to still show an enabled “Remove” button when hasActiveRun is false. Given you already treat status === 'ingesting' as selection-blocking, remove should be gated too (e.g., include root.status === 'ingesting' in removeDisabled or broaden blocksUserRemove).

Suggested change
                rowDisabled || hasActiveRun || blocksUserRemove(root);
                rowDisabled ||
                hasActiveRun ||
                root.status === 'ingesting' ||
                blocksUserRemove(root);
Copilot uses AI. Check for mistakes.
@Chargeuk	Reply...
client/src/hooks/useIngestRoots.ts
Comment on lines +168 to +179
    requestId: typeof entry.requestId === 'string' ? entry.requestId : null,
    runId: typeof entry.runId === 'string' ? entry.runId : null,
    queuePosition:
      typeof entry.queuePosition === 'number' && entry.queuePosition > 0
        ? entry.queuePosition
        : null,
    queueState:
      entry.queueState === 'waiting' ||
      entry.queueState === 'running' ||
      entry.queueState === 'cleanup-blocked'
        ? entry.queueState
        : null,
Copilot AI
1 hour ago
The new fields are typed as optional and nullable, but normalizeRoot always sets them and uses null as the “absent” value. That leads to a confusing contract for consumers (undefined vs null), especially now that UI logic branches on truthiness. Recommendation: standardize on one representation—either make these fields non-optional and always string | null / number | null, or keep them optional and use undefined for “not present” during normalization.

Copilot uses AI. Check for mistakes.
@Chargeuk	Reply...
client/src/components/ingest/RootsTable.tsx
Comment on lines 198 to 199
      await onRefresh();
      await onRefreshModels?.();
Copilot AI
1 hour ago
doReembed performs onRefresh()/onRefreshModels() every time it runs, and handleBulk calls doReembed in a loop. For bulk operations, this can multiply network requests and rerenders (N refreshes for N selected items). Consider deferring refresh/model-refresh to handleBulk (refresh once after the loop), or adding an option to doReembed/doRemove to skip per-item refresh when invoked from bulk.

Copilot uses AI. Check for mistakes.
@Chargeuk	Reply...
client/src/components/ingest/RootsTable.tsx
@@ -153,10 +227,12 @@ export default function RootsTable({
  };

  const handleBulk = async (action: 'reembed' | 'remove') => {
Copilot AI
1 hour ago
doReembed performs onRefresh()/onRefreshModels() every time it runs, and handleBulk calls doReembed in a loop. For bulk operations, this can multiply network requests and rerenders (N refreshes for N selected items). Consider deferring refresh/model-refresh to handleBulk (refresh once after the loop), or adding an option to doReembed/doRemove to skip per-item refresh when invoked from bulk.

Copilot uses AI. Check for mistakes.
@Chargeuk	Reply...
client/src/components/ingest/RootsTable.tsx
Comment on lines +235 to 238
      for (const path of targetPaths) {
        if (action === 'reembed') await doReembed(path);
        if (action === 'remove') await doRemove(path);
      }
Copilot AI
1 hour ago
doReembed performs onRefresh()/onRefreshModels() every time it runs, and handleBulk calls doReembed in a loop. For bulk operations, this can multiply network requests and rerenders (N refreshes for N selected items). Consider deferring refresh/model-refresh to handleBulk (refresh once after the loop), or adding an option to doReembed/doRemove to skip per-item refresh when invoked from bulk.

Copilot uses AI. Check for mistakes.


server/src/ingest/reingestService.ts
Comment on lines +427 to +428
        repo.id ??
        (path.posix.basename(requestPaths.canonicalTargetPath) || 'repo'),
@chatgpt-codex-connector
chatgpt-codex-connector bot
1 hour ago
P1 Badge Preserve repository name when queueing re-embed

Build the queued payload name from a stable display field, not repo.id. In this flow repo.id is mutable and can be replaced with the active runId during repo-list overlays, so queueing a re-embed while a run is active can enqueue a UUID as name; that value is then persisted by the next ingest and effectively renames the repository in metadata/UI. Using repo.name (with basename fallback) avoids this data corruption path.

Useful? React with 👍 / 👎.