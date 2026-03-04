import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import {
  modelReasoningEfforts,
  validateChatRequest,
} from '../../routes/chatValidators.js';

const ENV_KEYS = [
  'Codex_sandbox_mode',
  'Codex_approval_policy',
  'Codex_reasoning_effort',
  'Codex_network_access_enabled',
  'Codex_web_search_enabled',
  'CHAT_DEFAULT_PROVIDER',
  'CHAT_DEFAULT_MODEL',
  'CODEX_HOME',
];

const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];

const setEnv = (values: Record<string, string | undefined>) => {
  ENV_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
};

const setChatConfig = async (chatToml: string) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task7-'));
  tempDirs.push(root);
  const codexHome = path.join(root, 'codex');
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    chatToml,
    'utf8',
  );
  process.env.CODEX_HOME = codexHome;
};

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  });
});

afterEach(async () => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

test('resolver defaults apply when Codex flags are omitted', async () => {
  await setChatConfig(`
sandbox_mode = "workspace-write"
approval_policy = "on-request"
model_reasoning_effort = "medium"
web_search = "disabled"
`);
  setEnv({
    Codex_network_access_enabled: 'false',
  });

  const result = await validateChatRequest({
    model: 'gpt-5.1-codex-max',
    message: 'hello',
    conversationId: 'c1',
    provider: 'codex',
  });

  assert.deepEqual(result.codexFlags, {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    modelReasoningEffort: 'medium',
    networkAccessEnabled: false,
    webSearchEnabled: false,
  });
  assert.equal(result.warnings.length, 0);
});

test('chat request resolves provider and model from shared env defaults', async () => {
  setEnv({
    CHAT_DEFAULT_PROVIDER: 'codex',
    CHAT_DEFAULT_MODEL: 'gpt-5.3-codex',
  });

  const result = await validateChatRequest({
    message: 'hello',
    conversationId: 'shared-defaults-1',
  });

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.defaultsResolution.providerSource, 'env');
  assert.equal(result.defaultsResolution.modelSource, 'env');
});

test('invalid shared env defaults fallback without leaking invalid state', async () => {
  setEnv({
    CHAT_DEFAULT_PROVIDER: 'not-a-provider',
    CHAT_DEFAULT_MODEL: '',
  });

  const result = await validateChatRequest({
    message: 'hello',
    conversationId: 'shared-defaults-2',
  });

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.defaultsResolution.providerSource, 'fallback');
  assert.equal(result.defaultsResolution.modelSource, 'fallback');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_PROVIDER must be one of'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_MODEL is empty'),
    ),
  );
});

test('explicit Codex flags override resolver defaults', async () => {
  await setChatConfig(`
sandbox_mode = "read-only"
approval_policy = "never"
model_reasoning_effort = "low"
web_search = "disabled"
`);
  setEnv({
    Codex_network_access_enabled: 'false',
  });

  const result = await validateChatRequest({
    model: 'gpt-5.1-codex-max',
    message: 'hello',
    conversationId: 'c2',
    provider: 'codex',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  });

  assert.deepEqual(result.codexFlags, {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  });
  assert.equal(result.warnings.length, 0);
});

test('accepts every SDK-native reasoning effort value for Codex requests', async () => {
  for (const reasoningEffort of modelReasoningEfforts) {
    const result = await validateChatRequest({
      model: 'gpt-5.2-codex',
      message: 'hello',
      conversationId: `reasoning-${reasoningEffort}`,
      provider: 'codex',
      modelReasoningEffort: reasoningEffort,
    });

    assert.equal(result.codexFlags.modelReasoningEffort, reasoningEffort);
  }
});

test('rejects unsupported reasoning effort values with deterministic message', async () => {
  await assert.rejects(
    async () =>
      await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'reasoning-invalid',
        provider: 'codex',
        modelReasoningEffort: 'unsupported-effort',
      }),
    new RegExp(
      `modelReasoningEffort must be one of: ${modelReasoningEfforts.join(', ')}`,
    ),
  );
});

test('non-Codex validation ignores resolver defaults', async () => {
  await setChatConfig(`
sandbox_mode = "workspace-write"
`);
  setEnv({
    Codex_network_access_enabled: 'false',
  });

  const result = await validateChatRequest({
    model: 'model-1',
    message: 'hello',
    conversationId: 'c3',
    provider: 'lmstudio',
  });

  assert.deepEqual(result.codexFlags, {});
  assert.equal(result.warnings.length, 0);
});

test('non-Codex provider emits warnings for Codex-only flags', async () => {
  const result = await validateChatRequest({
    model: 'model-2',
    message: 'hello',
    conversationId: 'c4',
    provider: 'lmstudio',
    sandboxMode: 'read-only',
    approvalPolicy: 'on-request',
    modelReasoningEffort: 'medium',
    networkAccessEnabled: false,
    webSearchEnabled: true,
  });

  assert.equal(result.codexFlags.sandboxMode, undefined);
  assert.equal(result.warnings.length, 5);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('sandboxMode is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('approvalPolicy is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('modelReasoningEffort is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('networkAccessEnabled is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('webSearchEnabled is Codex-only'),
    ),
  );
});

test('whitespace-only message is rejected with exact contract message', async () => {
  await assert.rejects(
    async () =>
      await validateChatRequest({
        message: '   \t  ',
        conversationId: 'c-whitespace',
      }),
    /message must contain at least one non-whitespace character/,
  );
});

test('newline-only message is rejected with exact contract message', async () => {
  await assert.rejects(
    async () =>
      await validateChatRequest({
        message: '\n\n\r\n',
        conversationId: 'c-newline',
      }),
    /message must contain at least one non-whitespace character/,
  );
});

test('message with surrounding whitespace is accepted and preserved', async () => {
  const result = await validateChatRequest({
    message: '  hello with spaces  \n',
    conversationId: 'c-surrounding',
  });

  assert.equal(result.message, '  hello with spaces  \n');
});

test('chat validation parity fixture mirrors resolver-backed defaults and warnings', async () => {
  await setChatConfig(`
sandbox_mode = "workspace-write"
approval_policy = "on-request"
model_reasoning_effort = "medium"
web_search_request = false
`);

  const result = await validateChatRequest({
    model: 'gpt-5.2-codex',
    message: 'hello parity',
    conversationId: 'c-parity',
    provider: 'codex',
  });

  assert.equal(result.codexFlags.sandboxMode, 'workspace-write');
  assert.equal(result.codexFlags.approvalPolicy, 'on-request');
  assert.equal(result.codexFlags.modelReasoningEffort, 'medium');
  assert.equal(result.codexFlags.webSearchEnabled, false);
});
