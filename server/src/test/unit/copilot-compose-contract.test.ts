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

test('compose contract keeps local Copilot state on the repo bind mount while main and e2e stay on named volumes', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  for (const compose of [mainCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /copilot-data:\/app\/copilot/u);
    assert.match(serverBlock, /\.\/copilot:\/seed\/copilot:ro/u);
    assert.match(serverBlock, /CODEINFO_COPILOT_SEED_HOME=\/seed\/copilot/u);
    assert.doesNotMatch(serverBlock, /\.\/copilot:\/app\/copilot/u);
  }

  assert.match(mainCompose, /^  copilot-data:$/mu);
  assert.match(e2eCompose, /^  copilot-data:$/mu);

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /\.\/copilot:\/app\/copilot/u);
  assert.doesNotMatch(localServer, /copilot-data:\/app\/copilot/u);
  assert.doesNotMatch(localServer, /\.\/copilot:\/seed\/copilot:ro/u);
  assert.doesNotMatch(
    localServer,
    /CODEINFO_COPILOT_SEED_HOME=\/seed\/copilot/u,
  );
  assert.doesNotMatch(localCompose, /^  copilot-data:$/mu);
});

test('dockerignore excludes repo-local Copilot runtime artifacts while local compose uses the repo bind mount', () => {
  const dockerignore = readRepoFile('.dockerignore');
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  assert.match(dockerignore, /^copilot\/\*\*$/mu);
  assert.match(dockerignore, /^server\/copilot\/\*\*$/mu);

  for (const compose of [mainCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /copilot-data:\/app\/copilot/u);
    assert.doesNotMatch(serverBlock, /\.\/copilot:\/app\/copilot/u);
  }

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /\.\/copilot:\/app\/copilot/u);
  assert.doesNotMatch(localServer, /copilot-data:\/app\/copilot/u);
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

test('compose services publish CODEINFO_AGENT_HOME as the preferred runtime contract', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');
  const serverEnv = readRepoFile('server/.env');

  assert.match(serverEnv, /^CODEINFO_AGENT_HOME=\.\.\/codeinfo_agents$/mu);

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /CODEINFO_AGENT_HOME=\/app\/codeinfo_agents/u);
  }

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /\.\/codeinfo_agents:\/app\/codeinfo_agents/u);
});

test('compose keeps CODEINFO_CODEX_AGENT_HOME only as the legacy fallback alias', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');
  const serverEnv = readRepoFile('server/.env');

  assert.match(serverEnv, /^CODEINFO_CODEX_AGENT_HOME=\.\.\/codex_agents$/mu);

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(serverBlock, /CODEINFO_CODEX_AGENT_HOME=\/app\/codex_agents/u);
  }

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /\.\/codex_agents:\/app\/codex_agents/u);
});

test('compose build summary runtime asset marker includes /app/copilot', () => {
  const composeBuildSummary = readRepoFile('scripts/compose-build-summary.mjs');
  assert.match(composeBuildSummary, /['"]\/app\/copilot['"]/u);
});

test('compose wrapper bootstraps the repo-root Copilot home for local runs through settings.json without overwriting existing state', () => {
  const composeWrapper = readRepoFile('scripts/docker-compose-with-env.sh');

  assert.match(composeWrapper, /"\$\{repo_root\}\/copilot"/u);
  assert.match(
    composeWrapper,
    /printf '\{\\n  "storeTokenPlaintext": true\\n\}\\n' > "\$\{copilot_settings_path\}"/u,
  );
  assert.match(composeWrapper, /\[ ! -e "\$\{copilot_settings_path\}" \]/u);
});

test('compose services keep the optional repo-local codeinfo_config layer reachable without widening docker build context', () => {
  const dockerignore = readRepoFile('.dockerignore');
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  assert.match(dockerignore, /^codeinfo_config\/\*\*$/mu);

  for (const compose of [mainCompose, localCompose, e2eCompose]) {
    const serverBlock = getServiceBlock(compose, 'server');
    assert.match(
      serverBlock,
      /\$\{CODEINFO_RUNTIME_CODEINFO_CONFIG_DIR:-\.\/codeinfo_config\}:\/app\/codeinfo_config/u,
    );
  }
});

test('compose keeps lmstudio runtime artifacts on a writable provider-managed path across main, local, and e2e workflows', () => {
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  const mainServer = getServiceBlock(mainCompose, 'server');
  assert.match(mainServer, /lmstudio-data:\/app\/lmstudio/u);
  assert.match(mainCompose, /^  lmstudio-data:$/mu);

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(localServer, /\.\/lmstudio:\/app\/lmstudio/u);

  const e2eServer = getServiceBlock(e2eCompose, 'server');
  assert.match(e2eServer, /lmstudio-data:\/app\/lmstudio/u);
  assert.match(e2eCompose, /^  lmstudio-data:$/mu);
});

test('compose wrapper resolves a non-repo fallback mount for absent codeinfo_config directories', () => {
  const composeWrapper = readRepoFile('scripts/docker-compose-with-env.sh');

  assert.match(
    composeWrapper,
    /fallback_dir="\$\{TMPDIR:-\/tmp\}\/codeinfo2-empty-codeinfo-config"/u,
  );
  assert.match(
    composeWrapper,
    /export CODEINFO_RUNTIME_CODEINFO_CONFIG_DIR="\$\(resolve_runtime_codeinfo_config_dir\)"/u,
  );
});
