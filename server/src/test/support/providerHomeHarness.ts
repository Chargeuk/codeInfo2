import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatProviderId } from '@codeinfo2/common';

import { runWithTestEnvOverrides } from './testEnvOverrideScope.js';

type IsolatedProviderHomeEnv = {
  tempRoot: string;
  codexHome: string;
  copilotHome: string;
  lmstudioHome: string;
  envOverrides: Record<string, string>;
  cleanup: () => Promise<void>;
};

const PROVIDER_CHAT_CONFIGS: Record<ChatProviderId, string> = {
  codex: [
    'model = "gpt-5.3-codex"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    '',
  ].join('\n'),
  copilot: ['model = "copilot-gpt-5"', 'tool_access = "on"', ''].join('\n'),
  lmstudio: ['model = "model-1"', 'tool_access = "on"', ''].join('\n'),
};

const seedProviderHome = async (params: {
  provider: ChatProviderId;
  home: string;
}) => {
  await fs.mkdir(path.join(params.home, 'chat'), { recursive: true });
  await fs.writeFile(path.join(params.home, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(params.home, 'chat', 'config.toml'),
    PROVIDER_CHAT_CONFIGS[params.provider],
    'utf8',
  );
  if (params.provider === 'codex') {
    await fs.writeFile(path.join(params.home, 'auth.json'), '{}', 'utf8');
  }
};

export async function createIsolatedProviderHomeEnv(
  prefix = 'provider-homes-',
): Promise<IsolatedProviderHomeEnv> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const codexHome = path.join(tempRoot, 'codex-home');
  const copilotHome = path.join(tempRoot, 'copilot-home');
  const lmstudioHome = path.join(tempRoot, 'lmstudio-home');

  await Promise.all([
    seedProviderHome({ provider: 'codex', home: codexHome }),
    seedProviderHome({ provider: 'copilot', home: copilotHome }),
    seedProviderHome({ provider: 'lmstudio', home: lmstudioHome }),
  ]);

  return {
    tempRoot,
    codexHome,
    copilotHome,
    lmstudioHome,
    envOverrides: {
      CODEINFO_CODEX_HOME: codexHome,
      CODEINFO_COPILOT_HOME: copilotHome,
      CODEINFO_LMSTUDIO_HOME: lmstudioHome,
    },
    cleanup: async () => {
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function withIsolatedProviderHomeTestEnv<T>(
  params: {
    prefix?: string;
    overrides?: Record<string, string | undefined>;
  },
  run: (providerHomes: IsolatedProviderHomeEnv) => Promise<T>,
): Promise<T> {
  const providerHomes = await createIsolatedProviderHomeEnv(params.prefix);
  try {
    return await runWithTestEnvOverrides(
      {
        ...providerHomes.envOverrides,
        ...(params.overrides ?? {}),
      },
      async () => await run(providerHomes),
    );
  } finally {
    await providerHomes.cleanup();
  }
}
