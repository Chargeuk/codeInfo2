import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getChatInterface,
  UnsupportedProviderError,
} from '../../chat/factory.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';

test('returns codex chat interface instance', () => {
  const chat = getChatInterface('codex');
  assert.ok(chat instanceof ChatInterface);
});

test('returns lmstudio chat interface instance', () => {
  const chat = getChatInterface('lmstudio');
  assert.ok(chat instanceof ChatInterface);
});

test('throws for unsupported provider', () => {
  assert.throws(
    () => getChatInterface('unknown'),
    (err: unknown) =>
      err instanceof UnsupportedProviderError &&
      err.message.includes('Unsupported chat provider'),
  );
});
