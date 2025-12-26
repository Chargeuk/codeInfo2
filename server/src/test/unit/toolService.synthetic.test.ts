import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createLmStudioTools } from '../../lmstudio/tools.js';

const baseDeps = {
  getRootsCollection: async () =>
    ({
      get: async () => ({ ids: [], metadatas: [] }),
    }) as unknown as import('chromadb').Collection,
  getVectorsCollection: async () =>
    ({
      query: async () => ({
        ids: [['chunk-1']],
        documents: [['body']],
        metadatas: [
          [{ root: '/data/repo', relPath: 'file.txt', model: 'embed' }],
        ],
        distances: [[0.1]],
      }),
    }) as unknown as import('chromadb').Collection,
  getLockedModel: async () => 'embed-model',
};

const buildCtx = (callId = 7) => ({
  status: () => undefined,
  warn: () => undefined,
  signal: new AbortController().signal,
  callId,
});

test('calls onToolResult with success payload when resolver completes', async () => {
  const onToolResult = mock.fn();
  const { vectorSearchTool } = createLmStudioTools({
    deps: baseDeps,
    onToolResult,
  });

  const result = await vectorSearchTool.implementation(
    { query: 'hi' },
    buildCtx(12),
  );

  assert.ok(result.results.length > 0);
  assert.equal(onToolResult.mock.calls.length, 1);
  const [callId, payload, error] = onToolResult.mock.calls[0].arguments;
  assert.equal(callId, 12);
  assert.ok(payload);
  assert.equal(error, undefined);
});

test('calls onToolResult with error when resolver throws', async () => {
  const onToolResult = mock.fn();
  const { vectorSearchTool } = createLmStudioTools({
    deps: baseDeps,
    onToolResult,
  });

  await assert.rejects(() =>
    vectorSearchTool.implementation({ repository: 123 }, buildCtx(13)),
  );

  assert.equal(onToolResult.mock.calls.length, 1);
  const [callId, payload, error] = onToolResult.mock.calls[0].arguments;
  assert.equal(callId, 13);
  assert.equal(payload, undefined);
  assert.ok(error);
});
