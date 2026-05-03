import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, test } from '@jest/globals';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (!tempRoot) {
      continue;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('client entrypoint emits executable runtime config for env values with backslashes and newlines', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo-client-entrypoint-'),
  );
  tempRoots.push(tempRoot);

  const configPath = path.join(tempRoot, 'dist', 'config.js');
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const apiBaseUrl = 'https://host\\\\path\nnext-line';
  const lmStudioBaseUrl = 'http://lmstudio.local/with\\slash\nline-two';
  const entrypointPath = path.resolve(process.cwd(), 'entrypoint.sh');

  const result = spawnSync('sh', [entrypointPath, 'true'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEINFO_CLIENT_RUNTIME_CONFIG_PATH: configPath,
      VITE_CODEINFO_API_URL: apiBaseUrl,
      VITE_CODEINFO_LMSTUDIO_URL: lmStudioBaseUrl,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const configSource = await fs.readFile(configPath, 'utf8');
  const runtimeWindow = {} as { __CODEINFO_CONFIG__?: Record<string, unknown> };
  vm.runInNewContext(configSource, { window: runtimeWindow });

  assert.equal(runtimeWindow.__CODEINFO_CONFIG__?.apiBaseUrl, apiBaseUrl);
  assert.equal(
    runtimeWindow.__CODEINFO_CONFIG__?.lmStudioBaseUrl,
    lmStudioBaseUrl,
  );
  assert.match(
    configSource,
    /apiBaseUrl: "https:\/\/host\\\\\\\\path\\nnext-line"/u,
  );
  assert.match(
    configSource,
    /lmStudioBaseUrl: "http:\/\/lmstudio\.local\/with\\\\slash\\nline-two"/u,
  );
});
