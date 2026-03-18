import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import { baseLogger } from '../../logger.js';

test('resolveCodexCapabilities uses fallback capabilities when injected metadata resolver throws', async (t) => {
  const errorLines: string[] = [];
  t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string');
    if (typeof message === 'string') {
      errorLines.push(message);
    }
  });

  const result = await resolveCodexCapabilities({
    consumer: 'chat_models',
    resolveReasoningEffortsMetadata: () => {
      throw new Error('injected metadata failure');
    },
  });

  assert.equal(result.fallbackUsed, true);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('fallback capabilities'),
    ),
  );
  assert.ok(
    errorLines.some((line) =>
      line.includes(
        '[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=error',
      ),
    ),
  );
});

test('resolveCodexCapabilities parses metadata values without env sentinels', async () => {
  const result = await resolveCodexCapabilities({
    consumer: 'chat_validation',
    resolveReasoningEffortsMetadata: () => ' minimal,high, minimal , turbo ',
  });

  assert.equal(result.fallbackUsed, false);
  const supported = result.models[0]?.supportedReasoningEfforts ?? [];
  assert.ok(supported.includes('minimal'));
  assert.ok(supported.includes('high'));
  assert.ok(supported.includes('turbo'));
  assert.equal(new Set(supported).size, supported.length);
});

test('resolveCodexCapabilities does not duplicate a chat-config model already present in Codex_model_list', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-capability-resolver-'),
  );
  const codexHome = path.join(root, 'codex');
  const originalModelList = process.env.Codex_model_list;
  const originalCodexHome = process.env.CODEX_HOME;
  try {
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      'model = "gamma"\n',
      'utf8',
    );
    process.env.Codex_model_list = 'alpha,gamma,beta';
    process.env.CODEX_HOME = codexHome;

    const result = await resolveCodexCapabilities({
      consumer: 'chat_models',
      codexHome,
    });

    assert.deepEqual(
      result.models.map((entry) => entry.model),
      ['alpha', 'gamma', 'beta'],
    );
  } finally {
    if (originalModelList === undefined) delete process.env.Codex_model_list;
    else process.env.Codex_model_list = originalModelList;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  }
});
