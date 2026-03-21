import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd(), '..');

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

test('root compose inventory for Task 11 remains scoped to the checked-in files', () => {
  const rootComposeFiles = fs
    .readdirSync(repoRoot)
    .filter((entry) => /^docker-compose.*\.ya?ml$/u.test(entry))
    .sort();

  assert.deepEqual(rootComposeFiles, [
    'docker-compose.e2e.yml',
    'docker-compose.local.yml',
    'docker-compose.yml',
  ]);
});

test('main and local host-network services keep the final port split and no repo runtime mounts', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');

  const mainServer = getServiceBlock(mainCompose, 'server');
  assert.match(mainServer, /network_mode: host/u);
  assert.doesNotMatch(mainServer, /\n\s+ports:/u);
  assert.doesNotMatch(mainServer, /\n\s+networks:/u);
  assert.doesNotMatch(mainServer, /\.\/codex:/u);
  assert.doesNotMatch(mainServer, /\.\/codex_agents:/u);
  assert.doesNotMatch(mainServer, /\.\/flows-sandbox:/u);
  assert.match(
    mainServer,
    /CODEINFO_PLAYWRIGHT_MCP_URL=http:\/\/host\.docker\.internal:8932\/mcp/u,
  );
  assert.match(mainServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=0/u);

  const mainPlaywright = getServiceBlock(mainCompose, 'playwright-mcp');
  assert.match(mainPlaywright, /network_mode: host/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+ports:/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+networks:/u);
  assert.match(mainPlaywright, /'8932'/u);
  assert.match(
    mainPlaywright,
    /playwright-output-main:\/tmp\/playwright-output/u,
  );

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /network_mode: host/u);
  assert.doesNotMatch(localServer, /\n\s+ports:/u);
  assert.doesNotMatch(localServer, /\n\s+networks:/u);
  assert.doesNotMatch(localServer, /\.\/codex:/u);
  assert.doesNotMatch(localServer, /\.\/codex_agents:/u);
  assert.doesNotMatch(localServer, /\.\/flows:/u);
  assert.match(localServer, /CODEINFO_SERVER_PORT=5510/u);
  assert.match(
    localServer,
    /test: \['CMD', 'curl', '-f', 'http:\/\/localhost:5510\/health'\]/u,
  );
  assert.match(
    localServer,
    /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/u,
  );
  assert.match(localServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=0/u);

  const localPlaywright = getServiceBlock(localCompose, 'playwright-mcp');
  assert.match(localPlaywright, /network_mode: host/u);
  assert.doesNotMatch(localPlaywright, /\n\s+ports:/u);
  assert.doesNotMatch(localPlaywright, /\n\s+networks:/u);
  assert.match(localPlaywright, /'8931'/u);
  assert.match(
    localPlaywright,
    /playwright-output-local:\/tmp\/playwright-output/u,
  );
});

test('e2e server host-network contract removes checked-in runtime-tree mounts', () => {
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');
  const e2eServer = getServiceBlock(e2eCompose, 'server');

  assert.match(e2eServer, /network_mode: host/u);
  assert.doesNotMatch(e2eServer, /\n\s+ports:/u);
  assert.doesNotMatch(e2eServer, /\n\s+networks:/u);
  assert.doesNotMatch(e2eServer, /\.\/e2e\/fixtures:/u);
  assert.doesNotMatch(e2eServer, /\.\/e2e\/fixtures\/repo:/u);
  assert.doesNotMatch(e2eServer, /\.\/codex:/u);
  assert.doesNotMatch(e2eServer, /\.\/codex_agents:/u);
  assert.match(e2eServer, /CODEINFO_SERVER_PORT=6010/u);
  assert.match(
    e2eServer,
    /test: \['CMD', 'curl', '-f', 'http:\/\/localhost:6010\/health'\]/u,
  );
  assert.match(e2eServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=0/u);
});
