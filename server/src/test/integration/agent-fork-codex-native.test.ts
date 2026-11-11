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
  'Codex native fork accepts a normal child handover that subsequent SDK resumes retain',
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
        const prompt = 'Reply exactly Ready. Do not use tools.';
        const response = await source.run(prompt);
        assert.ok(source.id);
        const completed = await readCompletedCodexTurn(
          source.id,
          {
            fresh: true,
            prompt,
            assistant: response.finalResponse,
          },
          homes.codexHome,
        );
        assert.ok(completed?.turnId);
        const native = await openForkNative('codex', source.id, false);
        let childId: string;
        const marker = `HANDOVER_PROOF=${crypto.randomUUID()}`;
        try {
          const boundary = {
            id: completed.turnId,
            completed: true,
            user: prompt,
            assistant: response.finalResponse,
          };
          childId = await native.fork(boundary, config, model, homes.tempRoot);
          assert.notEqual(childId, source.id);
        } finally {
          await native.close();
        }
        // The handover is a normal user turn. No inject RPC or rollout-file
        // confirmation participates in the new handover flow.
        const child = codex.resumeThread(childId!, {
          model,
          workingDirectory: homes.tempRoot,
          skipGitRepoCheck: true,
        });
        await child.run(
          `${marker}\nAcknowledge ONLY. Await the next user instruction. No tools or work.`,
        );
        const reopened = codex.resumeThread(childId!, {
          model,
          workingDirectory: homes.tempRoot,
          skipGitRepoCheck: true,
        });
        const answer = await reopened.run(
          'Return the exact HANDOVER_PROOF value from your previous user history. No tools.',
        );
        assert.ok(answer.finalResponse.includes(marker.split('=')[1]));
      });
    } finally {
      await homes.cleanup();
    }
  },
);
