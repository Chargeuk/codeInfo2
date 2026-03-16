import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import {
  resolveChatDefaults,
  resolveCodexChatDefaults,
} from '../../config/chatDefaults.js';
import { ensureChatRuntimeConfigBootstrapped } from '../../config/runtimeConfig.js';

const ENV_KEYS = [
  'CHAT_DEFAULT_PROVIDER',
  'CHAT_DEFAULT_MODEL',
  'Codex_sandbox_mode',
  'Codex_approval_policy',
  'Codex_reasoning_effort',
  'Codex_web_search_enabled',
] as const;
const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  });
});

afterEach(async () => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

test('explicit values win', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';
  process.env.CHAT_DEFAULT_MODEL = 'env-model';

  const result = resolveChatDefaults({
    requestProvider: 'codex',
    requestModel: 'request-model',
  });

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'request-model');
  assert.equal(result.providerSource, 'request');
  assert.equal(result.modelSource, 'request');
});

test('env values apply when explicit values are missing', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';
  process.env.CHAT_DEFAULT_MODEL = 'env-model';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'lmstudio');
  assert.equal(result.model, 'env-model');
  assert.equal(result.providerSource, 'env');
  assert.equal(result.modelSource, 'env');
});

test('hardcoded fallback applies when env is missing or invalid', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'invalid-provider';
  process.env.CHAT_DEFAULT_MODEL = '   ';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'fallback');
  assert.equal(result.modelSource, 'fallback');
});

test('partial env override resolves missing fields via fallback', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'lmstudio');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'env');
  assert.equal(result.modelSource, 'fallback');
});

test('invalid and empty env values are ignored', () => {
  process.env.CHAT_DEFAULT_PROVIDER = '';
  process.env.CHAT_DEFAULT_MODEL = '';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'fallback');
  assert.equal(result.modelSource, 'fallback');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_PROVIDER is empty'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_MODEL is empty'),
    ),
  );
});

const createCodexHome = async (chatConfigToml?: string) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-chat-defaults-'),
  );
  tempDirs.push(root);
  const codexHome = path.join(root, 'codex');
  if (chatConfigToml !== undefined) {
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      chatConfigToml,
      'utf8',
    );
  }
  return codexHome;
};

test('resolver falls back deterministically and warns when codex chat config TOML is invalid', async () => {
  const codexHome = await createCodexHome('[broken');

  const result = await resolveCodexChatDefaults({ codexHome });

  assert.equal(result.values.sandboxMode, 'danger-full-access');
  assert.equal(result.values.approvalPolicy, 'on-failure');
  assert.equal(result.values.modelReasoningEffort, 'high');
  assert.equal(result.values.model, 'gpt-5.3-codex');
  assert.equal(result.values.webSearch, 'live');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('Unable to read codex/chat/config.toml'),
    ),
  );
});

test('resolver rejects invalid field values from parsed config and falls back by field', async () => {
  process.env.Codex_sandbox_mode = 'workspace-write';
  process.env.Codex_approval_policy = 'never';
  process.env.Codex_reasoning_effort = 'medium';
  process.env.CHAT_DEFAULT_MODEL = 'env-model';
  process.env.Codex_web_search_enabled = 'false';

  const codexHome = await createCodexHome(`
sandbox_mode = "invalid"
approval_policy = ""
model_reasoning_effort = "bad"
model = ""
web_search = "broken"
`);

  const result = await resolveCodexChatDefaults({ codexHome });

  assert.equal(result.values.sandboxMode, 'workspace-write');
  assert.equal(result.values.approvalPolicy, 'never');
  assert.equal(result.values.modelReasoningEffort, 'medium');
  assert.equal(result.values.model, 'env-model');
  assert.equal(result.values.webSearch, 'disabled');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('invalid value for "sandbox_mode"'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('invalid value for "approval_policy"'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('invalid value for "model_reasoning_effort"'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('invalid value for "model"'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('invalid value for "web_search"'),
    ),
  );
});

test('sandbox_mode precedence is override > config > env > hardcoded', async () => {
  process.env.Codex_sandbox_mode = 'workspace-write';
  const codexHome = await createCodexHome('sandbox_mode = "read-only"\n');

  const withOverride = await resolveCodexChatDefaults({
    codexHome,
    overrides: { sandboxMode: 'danger-full-access' },
  });
  assert.equal(withOverride.values.sandboxMode, 'danger-full-access');
  assert.equal(withOverride.sources.sandboxMode, 'override');

  const withConfig = await resolveCodexChatDefaults({ codexHome });
  assert.equal(withConfig.values.sandboxMode, 'read-only');
  assert.equal(withConfig.sources.sandboxMode, 'config');

  const noConfigHome = await createCodexHome();
  const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
  assert.equal(withEnv.values.sandboxMode, 'workspace-write');
  assert.equal(withEnv.sources.sandboxMode, 'env');
  assert.ok(
    withEnv.warnings.some(
      (warning) =>
        warning.includes('sandbox_mode') &&
        warning.includes('Codex_sandbox_mode'),
    ),
  );

  delete process.env.Codex_sandbox_mode;
  const withHardcoded = await resolveCodexChatDefaults({
    codexHome: noConfigHome,
  });
  assert.equal(withHardcoded.values.sandboxMode, 'danger-full-access');
  assert.equal(withHardcoded.sources.sandboxMode, 'hardcoded');
});

test('approval_policy precedence is override > config > env > hardcoded', async () => {
  process.env.Codex_approval_policy = 'never';
  const codexHome = await createCodexHome('approval_policy = "on-request"\n');

  const withOverride = await resolveCodexChatDefaults({
    codexHome,
    overrides: { approvalPolicy: 'untrusted' },
  });
  assert.equal(withOverride.values.approvalPolicy, 'untrusted');
  assert.equal(withOverride.sources.approvalPolicy, 'override');

  const withConfig = await resolveCodexChatDefaults({ codexHome });
  assert.equal(withConfig.values.approvalPolicy, 'on-request');
  assert.equal(withConfig.sources.approvalPolicy, 'config');

  const noConfigHome = await createCodexHome();
  const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
  assert.equal(withEnv.values.approvalPolicy, 'never');
  assert.equal(withEnv.sources.approvalPolicy, 'env');
  assert.ok(
    withEnv.warnings.some(
      (warning) =>
        warning.includes('approval_policy') &&
        warning.includes('Codex_approval_policy'),
    ),
  );

  delete process.env.Codex_approval_policy;
  const withHardcoded = await resolveCodexChatDefaults({
    codexHome: noConfigHome,
  });
  assert.equal(withHardcoded.values.approvalPolicy, 'on-failure');
  assert.equal(withHardcoded.sources.approvalPolicy, 'hardcoded');
});

test('model_reasoning_effort precedence is override > config > env > hardcoded', async () => {
  process.env.Codex_reasoning_effort = 'low';
  const codexHome = await createCodexHome('model_reasoning_effort = "xhigh"\n');

  const withOverride = await resolveCodexChatDefaults({
    codexHome,
    overrides: { modelReasoningEffort: 'minimal' },
  });
  assert.equal(withOverride.values.modelReasoningEffort, 'minimal');
  assert.equal(withOverride.sources.modelReasoningEffort, 'override');

  const withConfig = await resolveCodexChatDefaults({ codexHome });
  assert.equal(withConfig.values.modelReasoningEffort, 'xhigh');
  assert.equal(withConfig.sources.modelReasoningEffort, 'config');

  const noConfigHome = await createCodexHome();
  const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
  assert.equal(withEnv.values.modelReasoningEffort, 'low');
  assert.equal(withEnv.sources.modelReasoningEffort, 'env');
  assert.ok(
    withEnv.warnings.some(
      (warning) =>
        warning.includes('model_reasoning_effort') &&
        warning.includes('Codex_reasoning_effort'),
    ),
  );

  delete process.env.Codex_reasoning_effort;
  const withHardcoded = await resolveCodexChatDefaults({
    codexHome: noConfigHome,
  });
  assert.equal(withHardcoded.values.modelReasoningEffort, 'high');
  assert.equal(withHardcoded.sources.modelReasoningEffort, 'hardcoded');
});

test('model precedence is override > config > env > hardcoded', async () => {
  process.env.CHAT_DEFAULT_MODEL = 'env-model';
  const codexHome = await createCodexHome('model = "config-model"\n');

  const withOverride = await resolveCodexChatDefaults({
    codexHome,
    overrides: { model: 'override-model' },
  });
  assert.equal(withOverride.values.model, 'override-model');
  assert.equal(withOverride.sources.model, 'override');

  const withConfig = await resolveCodexChatDefaults({ codexHome });
  assert.equal(withConfig.values.model, 'config-model');
  assert.equal(withConfig.sources.model, 'config');

  const noConfigHome = await createCodexHome();
  const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
  assert.equal(withEnv.values.model, 'env-model');
  assert.equal(withEnv.sources.model, 'env');
  assert.ok(
    withEnv.warnings.some(
      (warning) =>
        warning.includes('model') && warning.includes('CHAT_DEFAULT_MODEL'),
    ),
  );

  delete process.env.CHAT_DEFAULT_MODEL;
  const withHardcoded = await resolveCodexChatDefaults({
    codexHome: noConfigHome,
  });
  assert.equal(withHardcoded.values.model, 'gpt-5.3-codex');
  assert.equal(withHardcoded.sources.model, 'hardcoded');
});

test('missing codex chat config falls back without creating the file', async () => {
  process.env.CHAT_DEFAULT_MODEL = 'env-model';
  const codexHome = await createCodexHome();
  const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

  const result = await resolveCodexChatDefaults({ codexHome });

  assert.equal(result.values.model, 'env-model');
  await assert.rejects(fs.access(chatConfigPath));
});

test('unreadable codex chat config warns and falls back without repair', async () => {
  process.env.CHAT_DEFAULT_MODEL = 'env-model';
  const codexHome = await createCodexHome('model = "config-model"\n');
  const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

  await fs.rm(chatConfigPath);
  await fs.mkdir(chatConfigPath, { recursive: true });

  const result = await resolveCodexChatDefaults({ codexHome });

  assert.equal(result.values.model, 'env-model');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('Unable to read codex/chat/config.toml'),
    ),
  );
  const stat = await fs.stat(chatConfigPath);
  assert.ok(stat.isDirectory());
});

test('bootstrap leaves invalid existing chat config untouched while defaults still warn and fall back', async () => {
  process.env.CHAT_DEFAULT_MODEL = 'env-model';
  const codexHome = await createCodexHome('[broken');
  const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

  const bootstrapResult = await ensureChatRuntimeConfigBootstrapped({
    codexHome,
  });
  const result = await resolveCodexChatDefaults({ codexHome });
  const chatContents = await fs.readFile(chatConfigPath, 'utf8');

  assert.equal(bootstrapResult.branch, 'existing_noop');
  assert.equal(chatContents, '[broken');
  assert.equal(result.values.model, 'env-model');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('Unable to read codex/chat/config.toml'),
    ),
  );
});

test('resolver rereads codex chat config on consecutive calls', async () => {
  const codexHome = await createCodexHome('model = "first-model"\n');
  const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

  const first = await resolveCodexChatDefaults({ codexHome });
  await fs.writeFile(chatConfigPath, 'model = "second-model"\n', 'utf8');
  const second = await resolveCodexChatDefaults({ codexHome });

  assert.equal(first.values.model, 'first-model');
  assert.equal(second.values.model, 'second-model');
});

test('canonical web_search wins when canonical and alias are both present', async () => {
  const codexHome = await createCodexHome(`
web_search = "cached"
web_search_request = true
`);

  const result = await resolveCodexChatDefaults({ codexHome });
  assert.equal(result.values.webSearch, 'cached');
  assert.equal(result.sources.webSearch, 'config');
});

test('alias web_search=true maps to live when canonical is not set', async () => {
  const codexHome = await createCodexHome('web_search_request = true\n');
  const result = await resolveCodexChatDefaults({ codexHome });
  assert.equal(result.values.webSearch, 'live');
  assert.equal(result.sources.webSearch, 'config');
});

test('alias web_search=false maps to disabled when canonical is not set', async () => {
  const codexHome = await createCodexHome('web_search_request = false\n');
  const result = await resolveCodexChatDefaults({ codexHome });
  assert.equal(result.values.webSearch, 'disabled');
  assert.equal(result.sources.webSearch, 'config');
});

test('web_search canonical precedence is override > config > env > hardcoded with env warnings', async () => {
  process.env.Codex_web_search_enabled = 'false';
  const codexHome = await createCodexHome('web_search = "cached"\n');

  const withOverride = await resolveCodexChatDefaults({
    codexHome,
    overrides: { webSearch: 'live' },
  });
  assert.equal(withOverride.values.webSearch, 'live');
  assert.equal(withOverride.sources.webSearch, 'override');

  const withConfig = await resolveCodexChatDefaults({ codexHome });
  assert.equal(withConfig.values.webSearch, 'cached');
  assert.equal(withConfig.sources.webSearch, 'config');

  const noConfigHome = await createCodexHome();
  const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
  assert.equal(withEnv.values.webSearch, 'disabled');
  assert.equal(withEnv.sources.webSearch, 'env');
  assert.ok(
    withEnv.warnings.some(
      (warning) =>
        warning.includes('web_search') &&
        warning.includes('Codex_web_search_enabled'),
    ),
  );

  delete process.env.Codex_web_search_enabled;
  const withHardcoded = await resolveCodexChatDefaults({
    codexHome: noConfigHome,
  });
  assert.equal(withHardcoded.values.webSearch, 'live');
  assert.equal(withHardcoded.sources.webSearch, 'hardcoded');
});
