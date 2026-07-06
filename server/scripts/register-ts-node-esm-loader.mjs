import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const trimToUndefined = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const ensureFile = (targetPath, contents) => {
  if (fs.existsSync(targetPath)) {
    return;
  }
  fs.writeFileSync(targetPath, contents, { encoding: 'utf8', flag: 'wx' });
};

const ensureSeededProviderHomes = () => {
  const testProviderHomeRoot = trimToUndefined(
    process.env.CODEINFO_TEST_PROVIDER_HOME_ROOT,
  );
  if (!testProviderHomeRoot) {
    return;
  }

  const processRoot = path.join(
    path.resolve(testProviderHomeRoot),
    `pid-${process.pid}`,
  );
  const codexHome = path.join(processRoot, 'codex');
  const copilotHome = path.join(processRoot, 'copilot');
  const lmstudioHome = path.join(processRoot, 'lmstudio');

  for (const providerHome of [codexHome, copilotHome, lmstudioHome]) {
    fs.mkdirSync(path.join(providerHome, 'chat'), { recursive: true });
    ensureFile(path.join(providerHome, 'config.toml'), '');
  }

  ensureFile(path.join(codexHome, 'auth.json'), '{}');
  ensureFile(
    path.join(codexHome, 'chat', 'config.toml'),
    [
      'model = "gpt-5.3-codex"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      '',
    ].join('\n'),
  );
  ensureFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    ['model = "copilot-gpt-5"', 'tool_access = "on"', ''].join('\n'),
  );
  ensureFile(
    path.join(lmstudioHome, 'chat', 'config.toml'),
    ['model = "model-1"', 'tool_access = "on"', ''].join('\n'),
  );
};

ensureSeededProviderHomes();

register('ts-node/esm', pathToFileURL('./'));
