import assert from 'node:assert/strict';
import test from 'node:test';

import { baseLogger } from '../../logger.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';

test('resolveCodexCapabilities uses fallback capabilities when injected metadata resolver throws', (t) => {
  const errorLines: string[] = [];
  t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string');
    if (typeof message === 'string') {
      errorLines.push(message);
    }
  });

  const result = resolveCodexCapabilities({
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

test('resolveCodexCapabilities parses metadata values without env sentinels', () => {
  const result = resolveCodexCapabilities({
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
