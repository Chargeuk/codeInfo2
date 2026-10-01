import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import { Codex } from '@openai/codex-sdk';
import {
  openForkNative,
  readCompletedCodexTurn,
} from '../../agents/forkNative.js';
import {
  buildCodexOptions,
  resolveCodexHome,
} from '../../config/codexConfig.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

// Opt-in authenticated proof: run after installing the pinned SDK/CLI. Never
// logs credentials, reauthenticates, or writes to the live provider home.
test(
  'Codex fork injection persists and is consumed by a subsequent SDK exec resume',
  {
    skip: process.env.CODEINFO_NATIVE_FORK_PROOF !== '1',
    timeout: resolveConfiguredTestTimeoutMs(180_000),
  },
  async () => {
    const authHome = resolveCodexHome();
    const homes = await createIsolatedProviderHomeEnv('agent-fork-native-');
    try {
      await fs.copyFile(
        `${authHome}/auth.json`,
        `${homes.codexHome}/auth.json`,
      );
      const model = process.env.CODEINFO_NATIVE_FORK_MODEL;
      assert.ok(
        model,
        'Set CODEINFO_NATIVE_FORK_MODEL to an authenticated provider model',
      );
      await runWithTestEnvOverrides(homes.envOverrides, async () => {
        const config = {
          model,
          approval_policy: 'never',
          sandbox_mode: 'read-only',
          mcp_servers: {},
        };
        const codex = new Codex(buildCodexOptions({ runtimeConfig: config }));
        const source = codex.startThread({
          model,
          workingDirectory: homes.tempRoot,
          skipGitRepoCheck: true,
        });
        await source.run('Reply exactly Ready. Do not use tools.');
        assert.ok(source.id);
        const completed = await readCompletedCodexTurn(source.id);
        assert.ok(completed?.turnId);
        const native = await openForkNative('codex', source.id);
        let childId: string;
        const marker = `HANDOVER_PROOF=${crypto.randomUUID()}`;
        try {
          const boundary = native.turns.find(
            (turn) => turn.id === completed.turnId,
          );
          assert.ok(boundary);
          childId = await native.fork(boundary, config, model, homes.tempRoot);
          assert.notEqual(childId, source.id);
          await native.inject(childId, marker);
          assert.equal(await native.hasInjected(childId, marker), true);
          assert.equal(await native.hasInjected(source.id, marker), false);
        } finally {
          await native.close();
        }
        assert.equal(await native.hasInjected(childId!, marker), true);
        // Close app-server before resuming to prove persisted history reaches SDK
        // exec, rather than merely proving app-server's in-memory injection.
        const child = codex.resumeThread(childId!, {
          model,
          workingDirectory: homes.tempRoot,
          skipGitRepoCheck: true,
        });
        const answer = await child.run(
          'Return the exact HANDOVER_PROOF value from your previous user history. No tools.',
        );
        assert.ok(answer.finalResponse.includes(marker.split('=')[1]));
      });
    } finally {
      await homes.cleanup();
    }
  },
);
