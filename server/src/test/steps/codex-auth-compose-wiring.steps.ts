import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Then } from '@cucumber/cucumber';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function getServiceBlock(content: string, serviceName: string): string {
  const lines = content.split('\n');
  const serviceIndex = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(serviceIndex, -1, `missing service ${serviceName}`);

  const block: string[] = [];
  for (let index = serviceIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (
      index > serviceIndex &&
      /^  [A-Za-z0-9][A-Za-z0-9_-]*:/.test(line) &&
      !line.startsWith('    ')
    ) {
      break;
    }
    if (index > serviceIndex && !line.startsWith(' ') && line.length > 0) {
      break;
    }
    block.push(line);
  }

  return block.join('\n');
}

function assertCodexAuthComposeMounts(relativePath: string) {
  const compose = readRepoFile(relativePath);
  const serverBlock = getServiceBlock(compose, 'server');

  assert.match(
    serverBlock,
    /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}:\/host\/codex:ro/u,
  );
  assert.match(serverBlock, /codex-data:\/app\/codex/u);
  assert.doesNotMatch(serverBlock, /codex-data:\/host\/codex:ro/u);
}

Then(
  /^the main compose server service mounts the host Codex home read-only at \/host\/codex$/,
  () => {
    assertCodexAuthComposeMounts('docker-compose.yml');
  },
);

Then(
  /^the main compose server service keeps codex-data mounted at \/app\/codex$/,
  () => {
    assertCodexAuthComposeMounts('docker-compose.yml');
  },
);

Then(
  /^the e2e compose server service mounts the host Codex home read-only at \/host\/codex$/,
  () => {
    assertCodexAuthComposeMounts('docker-compose.e2e.yml');
  },
);

Then(
  /^the e2e compose server service keeps codex-data mounted at \/app\/codex$/,
  () => {
    assertCodexAuthComposeMounts('docker-compose.e2e.yml');
  },
);
