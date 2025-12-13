import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchJsonRpc } from '../../mcpCommon/dispatch.js';

function getMessageId(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  return record.id ?? null;
}

test('invalid request returns invalidRequest(id) handler output', async () => {
  const invalidResponse = { ok: false, reason: 'invalid' };

  const result = await dispatchJsonRpc({
    message: { jsonrpc: 'nope', id: 123, method: 'initialize' },
    getId: getMessageId,
    handlers: {
      initialize: () => ({ ok: true }),
      resourcesList: () => ({ ok: true }),
      resourcesListTemplates: () => ({ ok: true }),
      toolsList: () => ({ ok: true }),
      toolsCall: () => ({ ok: true }),
      methodNotFound: () => ({ ok: false, reason: 'missing' }),
      invalidRequest: (id) => ({ ...invalidResponse, id }),
    },
  });

  assert.deepEqual(result, { ok: false, reason: 'invalid', id: 123 });
});

test('initialize routes to handlers.initialize(id)', async () => {
  const initializeResponse = { jsonrpc: '2.0', id: 1, result: { ok: true } };
  let seenId: unknown;

  const result = await dispatchJsonRpc({
    message: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    getId: getMessageId,
    handlers: {
      initialize: (id) => {
        seenId = id;
        return initializeResponse;
      },
      resourcesList: () => ({}) as unknown,
      resourcesListTemplates: () => ({}) as unknown,
      toolsList: () => ({}) as unknown,
      toolsCall: () => ({}) as unknown,
      methodNotFound: () => ({}) as unknown,
      invalidRequest: () => ({}) as unknown,
    },
  });

  assert.equal(seenId, 1);
  assert.strictEqual(result, initializeResponse);
});

test('unknown method routes to handlers.methodNotFound(id)', async () => {
  const notFoundResponse = { jsonrpc: '2.0', id: 7, error: { code: 1 } };

  const result = await dispatchJsonRpc({
    message: { jsonrpc: '2.0', id: 7, method: 'unknown/method' },
    getId: getMessageId,
    handlers: {
      initialize: () => ({}) as unknown,
      resourcesList: () => ({}) as unknown,
      resourcesListTemplates: () => ({}) as unknown,
      toolsList: () => ({}) as unknown,
      toolsCall: () => ({}) as unknown,
      methodNotFound: () => notFoundResponse,
      invalidRequest: () => ({}) as unknown,
    },
  });

  assert.strictEqual(result, notFoundResponse);
});

test('dispatcher returns handler payloads verbatim (no rewriting)', async () => {
  const toolsCallResponse = {
    jsonrpc: '2.0',
    id: 9,
    result: { content: [{ type: 'text', text: '{"ok":true}' }] },
  };

  const result = await dispatchJsonRpc({
    message: {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'Tool', arguments: { a: 1 } },
    },
    getId: getMessageId,
    handlers: {
      initialize: () => ({}) as unknown,
      resourcesList: () => ({}) as unknown,
      resourcesListTemplates: () => ({}) as unknown,
      toolsList: () => ({}) as unknown,
      toolsCall: () => toolsCallResponse,
      methodNotFound: () => ({}) as unknown,
      invalidRequest: () => ({}) as unknown,
    },
  });

  assert.strictEqual(result, toolsCallResponse);
});
