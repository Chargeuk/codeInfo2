import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  approveAll,
  CopilotClient,
  type CopilotSession,
} from '@github/copilot-sdk';
import { openForkNative } from '../../agents/forkNative.js';
import {
  enforceForkMcpServers,
  sendPendingForkHandover,
} from '../../chat/forkHandover.js';
import {
  buildCopilotClientOptions,
  resolveCopilotHome,
} from '../../config/copilotConfig.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const fixture = `import { createInterface } from 'node:readline';
const tool = process.argv[2];
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: tool, version: '1' } };
  if (request.method === 'tools/list') result = { tools: [{ name: tool, description: tool, inputSchema: { type: 'object', properties: {} } }] };
  if (request.method === 'tools/call') result = { content: [{ type: 'text', text: tool }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});`;

test(
  'Copilot native child uses target MCP catalog and delivers distinct handover/instruction messages only once',
  {
    skip: process.env.CODEINFO_NATIVE_COPILOT_FORK_PROOF !== '1',
    timeout: resolveConfiguredTestTimeoutMs(180_000),
  },
  async () => {
    const authHome = resolveCopilotHome();
    const homes = await createIsolatedProviderHomeEnv('copilot-fork-native-');
    try {
      // Credentials are copied read-only into this disposable home. Existing
      // sessions and the live runtime catalog are deliberately excluded.
      for (const filename of ['config.json', 'settings.json']) {
        await fs
          .copyFile(
            path.join(authHome, filename),
            path.join(homes.copilotHome, filename),
          )
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
      }
      const model = process.env.CODEINFO_NATIVE_COPILOT_FORK_MODEL;
      assert.ok(
        model,
        'Set CODEINFO_NATIVE_COPILOT_FORK_MODEL to an authenticated Copilot model',
      );
      const fixturePath = path.join(homes.tempRoot, 'mcp-fixture.mjs');
      await fs.writeFile(fixturePath, fixture);
      await runWithTestEnvOverrides(homes.envOverrides, async () => {
        const client = new CopilotClient(
          buildCopilotClientOptions().clientOptions,
        );
        let source: CopilotSession | undefined;
        let child: CopilotSession | undefined;
        const sourceId = crypto.randomUUID();
        const marker = `HANDOVER_PROOF=${crypto.randomUUID()}`;
        const targetMcp = {
          target_only: {
            type: 'local' as const,
            command: process.execPath,
            args: [fixturePath, 'target_marker'],
            tools: ['*'],
          },
        };
        try {
          await client.start();
          source = await client.createSession({
            sessionId: sourceId,
            model,
            workingDirectory: homes.tempRoot,
            onPermissionRequest: approveAll,
            mcpServers: {
              source_only: {
                type: 'local',
                command: process.execPath,
                args: [fixturePath, 'source_marker'],
                tools: ['*'],
              },
            },
          });
          await source.sendAndWait(
            { prompt: 'Reply exactly Ready. Do not use tools.' },
            resolveConfiguredTestTimeoutMs(120_000),
          );
          await source.disconnect();
          source = undefined;
          const native = await openForkNative('copilot', sourceId);
          let childId: string;
          try {
            const boundary = native.turns.at(-1);
            assert.ok(boundary?.completed);
            childId = await native.fork(boundary, {}, model, homes.tempRoot);
            assert.notEqual(childId, sourceId);
          } finally {
            await native.close();
          }
          child = await client.resumeSession(childId!, {
            model,
            workingDirectory: homes.tempRoot,
            onPermissionRequest: approveAll,
            mcpServers: targetMcp,
          });
          await enforceForkMcpServers(child, targetMcp);
          const mcp = await child.rpc.mcp.list();
          assert.ok(
            mcp.servers.some((server) => server.name === 'target_only'),
          );
          assert.ok(
            !mcp.servers.some((server) => server.name === 'source_only') ||
              mcp.host?.disabledServers.includes('source_only'),
          );
          let delivered = 0;
          await sendPendingForkHandover({
            session: child,
            handovers: [marker],
            instruction:
              'Return the exact HANDOVER_PROOF value in the previous user message. No tools.',
            timeoutMs: resolveConfiguredTestTimeoutMs(120_000),
            markDelivered: async () => {
              delivered++;
            },
          });
          const events = await child.getEvents();
          assert.equal(
            events.filter(
              (event) =>
                event.type === 'user.message' && event.data.content === marker,
            ).length,
            1,
          );
          assert.ok(
            events.some(
              (event) =>
                event.type === 'assistant.message' &&
                event.data.content.includes(marker.split('=')[1]),
            ),
          );
          assert.equal(delivered, 1);
          const sourceHistory = await fs.readFile(
            path.join(
              homes.copilotHome,
              'session-state',
              sourceId,
              'events.jsonl',
            ),
            'utf8',
          );
          assert.equal(sourceHistory.includes(marker), false);
        } finally {
          await child?.disconnect();
          await source?.disconnect();
          await client.stop();
        }
      });
    } finally {
      await homes.cleanup();
    }
  },
);
