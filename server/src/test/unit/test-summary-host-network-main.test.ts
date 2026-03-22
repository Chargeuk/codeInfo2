import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMainStackProbeMarkerContext,
  probeMainStackEndpoints,
  renderMainStackProbeReport,
} from '../support/hostNetworkMainProbe.mjs';
import type { MainStackProbeEndpoint } from '../support/hostNetworkMainProbe.mjs';

const createEndpoints = () => ({
  classicMcp: { label: 'classicMcp', url: 'http://host.test:5010/mcp' },
  chatMcp: { label: 'chatMcp', url: 'http://host.test:5011/' },
  agentsMcp: { label: 'agentsMcp', url: 'http://host.test:5012/' },
  playwrightMcp: { label: 'playwrightMcp', url: 'http://host.test:8932/mcp' },
});

test('main-stack host-network probe succeeds when all required listeners are reachable', async () => {
  const result = await probeMainStackEndpoints({
    endpoints: createEndpoints(),
    probeJsonRpc: async () => ({
      reachable: true,
      httpStatus: 200,
      detail: 'HTTP 200',
    }),
  });

  assert.equal(result.result, 'passed');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(createMainStackProbeMarkerContext(result), {
    classicMcp: 'reachable',
    chatMcp: 'reachable',
    agentsMcp: 'reachable',
    playwrightMcp: 'reachable',
    result: 'passed',
  });
});

test('main-stack host-network probe fails when one required listener is unavailable', async () => {
  const result = await probeMainStackEndpoints({
    endpoints: createEndpoints(),
    probeJsonRpc: async ({
      endpoint,
    }: {
      endpoint: MainStackProbeEndpoint;
    }) => {
      if (endpoint.label === 'agentsMcp') {
        return {
          reachable: false,
          httpStatus: null,
          detail: 'connect ECONNREFUSED 127.0.0.1:5012',
        };
      }

      return {
        reachable: true,
        httpStatus: 200,
        detail: 'HTTP 200',
      };
    },
  });

  assert.equal(result.result, 'failed');
  assert.deepEqual(result.failures, ['agentsMcp']);
  assert.equal(result.endpoints.agentsMcp.reachable, false);
  assert.match(result.endpoints.agentsMcp.detail, /ECONNREFUSED/u);
});

test('main-stack host-network probe report keeps failing endpoint output inspectable', async () => {
  const result = await probeMainStackEndpoints({
    endpoints: createEndpoints(),
    probeJsonRpc: async ({
      endpoint,
    }: {
      endpoint: MainStackProbeEndpoint;
    }) => {
      if (endpoint.label === 'playwrightMcp') {
        throw new Error('unexpected EOF while probing playwright MCP');
      }

      return {
        reachable: true,
        httpStatus: 200,
        detail: 'HTTP 200',
      };
    },
  });

  const report = renderMainStackProbeReport(result);

  assert.equal(result.result, 'failed');
  assert.match(report, /playwrightMcp: unreachable/u);
  assert.match(report, /unexpected EOF while probing playwright MCP/u);
  assert.match(report, /failing endpoints: playwrightMcp/u);
});

test('main-stack host-network probe accepts event-stream style initialize responses from Playwright MCP', async () => {
  const result = await probeMainStackEndpoints({
    endpoints: createEndpoints(),
    fetchImpl: async (_input, init) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText);
      assert.equal(parsed.method, 'initialize');

      return new Response(
        'event: message\ndata: {"jsonrpc":"2.0","id":"probe","result":{"protocolVersion":"2024-11-05"}}\n\n',
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
          },
        },
      );
    },
  });

  assert.equal(result.result, 'passed');
  assert.equal(result.endpoints.playwrightMcp.reachable, true);
});
