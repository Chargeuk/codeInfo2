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

test('published port contract stays unchanged after Copilot Docker wiring', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  const mainServer = getServiceBlock(mainCompose, 'server');
  assert.match(mainServer, /network_mode: host/u);
  assert.doesNotMatch(mainServer, /\n\s+ports:/u);

  const mainClient = getServiceBlock(mainCompose, 'client');
  assert.match(mainClient, /'5001:5001'/u);
  const mainMongo = getServiceBlock(mainCompose, 'mongo');
  assert.match(mainMongo, /27517:27017/u);
  const mainChroma = getServiceBlock(mainCompose, 'chroma');
  assert.match(mainChroma, /'8000:8000'/u);
  const mainOtel = getServiceBlock(mainCompose, 'otel-collector');
  assert.match(mainOtel, /'4317:4317'/u);
  assert.match(mainOtel, /'4318:4318'/u);
  const mainZipkin = getServiceBlock(mainCompose, 'zipkin');
  assert.match(mainZipkin, /'9411:9411'/u);
  const mainPlaywright = getServiceBlock(mainCompose, 'playwright-mcp');
  assert.match(mainPlaywright, /network_mode: host/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+ports:/u);
  assert.match(mainPlaywright, /'8932'/u);

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /network_mode: host/u);
  assert.doesNotMatch(localServer, /\n\s+ports:/u);

  const localClient = getServiceBlock(localCompose, 'client');
  assert.match(localClient, /'5501:5001'/u);
  const localMongo = getServiceBlock(localCompose, 'mongo');
  assert.match(localMongo, /27417:27017/u);
  const localChroma = getServiceBlock(localCompose, 'chroma');
  assert.match(localChroma, /'8200:8000'/u);
  const localOtel = getServiceBlock(localCompose, 'otel-collector');
  assert.match(localOtel, /'4917:4317'/u);
  assert.match(localOtel, /'4918:4318'/u);
  const localZipkin = getServiceBlock(localCompose, 'zipkin');
  assert.match(localZipkin, /'9711:9411'/u);
  const localPlaywright = getServiceBlock(localCompose, 'playwright-mcp');
  assert.match(localPlaywright, /network_mode: host/u);
  assert.doesNotMatch(localPlaywright, /\n\s+ports:/u);
  assert.match(localPlaywright, /'8931'/u);

  const e2eServer = getServiceBlock(e2eCompose, 'server');
  assert.match(e2eServer, /network_mode: host/u);
  assert.doesNotMatch(e2eServer, /\n\s+ports:/u);

  const e2eClient = getServiceBlock(e2eCompose, 'client');
  assert.match(e2eClient, /'6001:5001'/u);
  const e2eMongo = getServiceBlock(e2eCompose, 'mongo-e2e');
  assert.match(e2eMongo, /27617:27017/u);
  const e2eChroma = getServiceBlock(e2eCompose, 'chroma-e2e');
  assert.match(e2eChroma, /'8800:8000'/u);
  const e2eOtel = getServiceBlock(e2eCompose, 'otel-collector');
  assert.match(e2eOtel, /'4417:4317'/u);
  assert.match(e2eOtel, /'4418:4318'/u);
  const e2eZipkin = getServiceBlock(e2eCompose, 'zipkin');
  assert.match(e2eZipkin, /'9511:9411'/u);
});

test('compose contract persists Copilot state with the Docker-managed named volume pattern', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /copilot-data:\/app\/copilot/u);
    assert.doesNotMatch(serverBlock, /\.\/copilot:\/app\/copilot/u);
  }

  assert.match(mainCompose, /^  copilot-data:$/mu);
  assert.match(localCompose, /^  copilot-data:$/mu);
  assert.match(e2eCompose, /^  copilot-data:$/mu);
});

test('dockerignore excludes repo-local Copilot runtime artifacts while compose keeps one persistence rule', () => {
  const dockerignore = readRepoFile('.dockerignore');
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  assert.match(dockerignore, /^copilot\/\*\*$/mu);
  assert.match(dockerignore, /^server\/copilot\/\*\*$/mu);

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /copilot-data:\/app\/copilot/u);
    assert.doesNotMatch(serverBlock, /\.\/copilot:\/app\/copilot/u);
  }
});

test('compose services that need Copilot state inject CODEINFO_COPILOT_HOME=/app/copilot consistently', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /CODEINFO_COPILOT_HOME=\/app\/copilot/u);
  }
});

test('compose build summary runtime asset marker includes /app/copilot', () => {
  const composeBuildSummary = readRepoFile('scripts/compose-build-summary.mjs');
  assert.match(composeBuildSummary, /['"]\/app\/copilot['"]/u);
});
