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

function collectProductionFlowAgentTypes(
  flowName: string,
  seen = new Set<string>(),
  agentTypes = new Set<string>(),
): Set<string> {
  if (seen.has(flowName)) return agentTypes;
  seen.add(flowName);
  const parsed = JSON.parse(readRepoFile(`flows/${flowName}.json`)) as {
    steps?: Array<Record<string, unknown>>;
  };
  const visit = (steps: Array<Record<string, unknown>>) => {
    for (const step of steps) {
      if (typeof step.agentType === 'string') agentTypes.add(step.agentType);
      if (Array.isArray(step.steps)) {
        visit(step.steps as Array<Record<string, unknown>>);
      }
      if (step.type === 'subflow' && Array.isArray(step.flowNames)) {
        for (const childFlowName of step.flowNames) {
          if (typeof childFlowName === 'string') {
            collectProductionFlowAgentTypes(childFlowName, seen, agentTypes);
          }
        }
      }
      if (step.type === 'subflowWave' && Array.isArray(step.groups)) {
        for (const group of step.groups as Array<Record<string, unknown>>) {
          const childFlowNames = [
            ...(typeof group.flowName === 'string' ? [group.flowName] : []),
            ...(Array.isArray(group.flowNames)
              ? group.flowNames.filter(
                  (flowName): flowName is string =>
                    typeof flowName === 'string',
                )
              : []),
          ];
          for (const childFlowName of childFlowNames) {
            collectProductionFlowAgentTypes(childFlowName, seen, agentTypes);
          }
        }
      }
    }
  };
  visit(parsed.steps ?? []);
  return agentTypes;
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

test('main stays image-baked while local host-network compose exposes the live dev overlay mounts', () => {
  const dockerfile = readRepoFile('server/Dockerfile');
  const mainCompose = readRepoFile('docker-compose.yml');
  const localCompose = readRepoFile('docker-compose.local.yml');
  const entrypoint = readRepoFile('server/entrypoint.sh');

  assert.match(
    dockerfile,
    /RUN mkdir -p \/app\/codex\/\.agents\/skills \/app\/copilot \/app\/lmstudio && chmod -R 777 \/app\/codex \/app\/copilot \/app\/lmstudio/u,
  );
  assert.match(dockerfile, /COPY codex_agents \/app\/codex_agents/u);
  assert.match(dockerfile, /COPY AGENTS\.md \/app\/AGENTS\.md/u);
  assert.match(dockerfile, /COPY planning \/app\/planning/u);
  assert.match(
    dockerfile,
    /RUN cp -R \/app\/codex_agents \/app\/codeinfo_agents/u,
  );
  assert.match(dockerfile, /ARG CODEINFO_RUNTIME_UID=1000/u);
  assert.match(dockerfile, /ARG CODEINFO_RUNTIME_GID=1000/u);
  assert.match(
    dockerfile,
    /RUN mkdir -p "\$\{HOME\}" "\$\{HOME\}\/tmp" "\$\{HOME\}\/\.docker" && \\\n\s+chown "\$\{CODEINFO_RUNTIME_UID\}:\$\{CODEINFO_RUNTIME_GID\}" "\$\{HOME\}" "\$\{HOME\}\/tmp" "\$\{HOME\}\/\.docker"/u,
  );
  assert.match(dockerfile, /ENV HOME=\/app\/codex/u);
  assert.match(dockerfile, /ENV CODEX_HOME=\/app\/codex/u);
  assert.match(dockerfile, /ENV CODEINFO_LMSTUDIO_HOME=\/app\/lmstudio/u);

  const mainServer = getServiceBlock(mainCompose, 'server');
  assert.match(
    mainServer,
    /env_file:\n\s+- server\/\.env\n\s+- server\/\.env\.local/u,
  );
  assert.match(mainServer, /network_mode: host/u);
  assert.doesNotMatch(mainServer, /\n\s+ports:/u);
  assert.doesNotMatch(mainServer, /\n\s+networks:/u);
  assert.doesNotMatch(mainServer, /\.\/codex:/u);
  assert.doesNotMatch(mainServer, /\.\/codeinfo_agents:/u);
  assert.doesNotMatch(mainServer, /\.\/codex_agents:/u);
  assert.doesNotMatch(mainServer, /\.\/flows-sandbox:/u);
  assert.match(mainServer, /\.\/scripts:\/app\/scripts:ro/u);
  assert.match(
    mainServer,
    /\.\/codeinfo_markdown:\/app\/codeinfo_markdown:ro/u,
  );
  assert.match(
    mainServer,
    /\.\/manual_testing\/codeinfo_agents:\/app\/codeinfo_agents/u,
  );
  assert.match(
    mainServer,
    /\.\/manual_testing\/codex_agents:\/app\/codex_agents/u,
  );
  assert.match(
    mainServer,
    /CODEINFO_PLAYWRIGHT_MCP_URL=http:\/\/host\.docker\.internal:8932\/mcp/u,
  );
  assert.match(mainServer, /CODEINFO_WEB_MCP_PORT=5013/u);
  assert.match(
    mainServer,
    /CODEINFO_LMSTUDIO_BASE_URL=http:\/\/host\.docker\.internal:1234/u,
  );
  assert.match(mainServer, /HOME=\/app\/codex/u);
  assert.match(mainServer, /CODEX_HOME=\/app\/codex/u);
  assert.match(mainServer, /CODEINFO_CODEX_WORKDIR=\/data/u);
  assert.match(mainServer, /FLOWS_DIR=\/app\/flows-sandbox/u);
  assert.match(
    mainServer,
    /CODEINFO_HOST_INGEST_DIR=\$\{CODEINFO_HOST_INGEST_DIR:-\/tmp\}/u,
  );
  assert.match(mainServer, /CODEINFO_LMSTUDIO_HOME=\/app\/lmstudio/u);
  assert.match(mainServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=5/u);
  assert.match(
    mainServer,
    /CODEINFO_RUNTIME_SERVER_PORTS=5010,5011,5012,5013/u,
  );
  assert.match(
    mainServer,
    /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}:\/host\/codex:ro/u,
  );
  assert.match(mainServer, /codex-data:\/app\/codex/u);
  assert.doesNotMatch(mainServer, /codex-data:\/host\/codex:ro/u);
  assert.match(mainServer, /\$\{CODEINFO_HOST_INGEST_DIR:-\/tmp\}:\/data:rw/u);
  assert.doesNotMatch(
    mainServer,
    /\$\{CODEINFO_HOST_INGEST_DIR:-\/tmp\}:\/data:ro/u,
  );
  assert.match(
    entrypoint,
    /export HOME="\$runtime_home"\nexport CODEX_HOME="\$\{CODEX_HOME:-\$\{CODEINFO_CODEX_HOME:-\$runtime_home\}\}"/u,
  );
  assert.match(
    entrypoint,
    /prepare_runtime_tree "\$\{HOME\}" "\.agents" "\.agents\/skills" "\.cache"/u,
  );
  assert.match(
    entrypoint,
    /prepare_runtime_tree "\$\{copilot_home\}" "\.cache" "\.cache\/copilot" "chat"/u,
  );
  assert.match(
    entrypoint,
    /prepare_runtime_tree "\$\{lmstudio_home\}" "\.cache"/u,
  );

  const mainPlaywright = getServiceBlock(mainCompose, 'playwright-mcp');
  assert.match(mainPlaywright, /network_mode: host/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+ports:/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+networks:/u);
  assert.match(mainPlaywright, /entrypoint: \['node', '\/app\/cli\.js'\]/u);
  assert.doesNotMatch(mainPlaywright, /\n\s+profiles:\n\s+- local/u);
  assert.match(mainPlaywright, /'8932'/u);
  assert.match(
    mainPlaywright,
    /playwright-output-main:\/tmp\/playwright-output/u,
  );

  const localServer = getServiceBlock(localCompose, 'server');
  assert.match(
    localServer,
    /env_file:\n\s+- server\/\.env\n\s+- server\/\.env\.local/u,
  );
  assert.match(localServer, /network_mode: host/u);
  assert.doesNotMatch(localServer, /\n\s+ports:/u);
  assert.doesNotMatch(localServer, /\n\s+networks:/u);
  assert.match(localServer, /\.\/codex:\/app\/codex/u);
  assert.match(localServer, /\.\/codeinfo_agents:\/app\/codeinfo_agents/u);
  assert.match(localServer, /\.\/codex_agents:\/app\/codex_agents/u);
  assert.match(localServer, /\.\/scripts:\/app\/scripts:ro/u);
  assert.match(
    localServer,
    /\.\/codeinfo_markdown:\/app\/codeinfo_markdown:ro/u,
  );
  assert.match(localServer, /\.\/flows:\/app\/flows/u);
  assert.match(localServer, /\.\/flows-sandbox:\/app\/flows-sandbox/u);
  assert.match(localServer, /CODEINFO_SERVER_PORT=5510/u);
  assert.match(localServer, /CODEINFO_WEB_MCP_PORT=5513/u);
  assert.match(localServer, /CODEINFO_LMSTUDIO_HOME=\/app\/lmstudio/u);
  assert.match(localServer, /\n\s+- HOME=\$\{HOME\}/u);
  assert.match(localServer, /\n\s+- TMP=\/tmp/u);
  assert.match(localServer, /\n\s+- TEMP=\/tmp/u);
  assert.match(localServer, /\n\s+- TMPDIR=\/tmp/u);
  assert.match(localServer, /\n\s+- TEMPDIR=\/tmp/u);
  assert.doesNotMatch(localServer, /\n\s+- HOME=\/app\/codex/u);
  assert.match(
    localServer,
    /test: \['CMD', 'curl', '-f', 'http:\/\/localhost:5510\/health'\]/u,
  );
  assert.match(
    localServer,
    /\$\{CODEINFO_HOST_INGEST_DIR\}:\$\{CODEINFO_CODEX_WORKDIR\}/u,
  );
  assert.match(
    localServer,
    /\$\{CODEINFO_DOCKER_SOCKET_PATH:-\/var\/run\/docker\.sock\}:\/var\/run\/docker\.sock/u,
  );
  assert.match(localServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=6/u);
  assert.match(
    localServer,
    /CODEINFO_RUNTIME_SERVER_PORTS=5510,5511,5512,5513/u,
  );

  const localPlaywright = getServiceBlock(localCompose, 'playwright-mcp');
  assert.match(localPlaywright, /network_mode: host/u);
  assert.doesNotMatch(localPlaywright, /\n\s+ports:/u);
  assert.doesNotMatch(localPlaywright, /\n\s+networks:/u);
  assert.match(localPlaywright, /entrypoint: \['node', '\/app\/cli\.js'\]/u);
  assert.match(localPlaywright, /'8931'/u);
  assert.match(
    localPlaywright,
    /\.\/playwright-output-local:\/tmp\/playwright-output/u,
  );
});

test('main-stack manual agent catalog covers every reachable production flow agent', () => {
  const agentTypes = new Set<string>();
  for (const flowName of [
    'implement_next_plan',
    'improve_task_implement_plan',
    'task_and_implement_plan',
  ]) {
    collectProductionFlowAgentTypes(flowName, new Set<string>(), agentTypes);
  }

  for (const agentType of agentTypes) {
    const agentRoot = path.join(
      repoRoot,
      'manual_testing/codeinfo_agents',
      agentType,
    );
    for (const requiredFile of [
      'config.toml',
      'description.md',
      'system_prompt.txt',
    ]) {
      assert.equal(
        fs.existsSync(path.join(agentRoot, requiredFile)),
        true,
        `main-stack manual catalog must provide ${agentType}/${requiredFile}`,
      );
    }
  }
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
  assert.doesNotMatch(e2eServer, /\.\/codeinfo_agents:/u);
  assert.doesNotMatch(e2eServer, /\.\/codex_agents:/u);
  assert.match(e2eServer, /\.\/scripts:\/app\/scripts:ro/u);
  assert.match(e2eServer, /\.\/codeinfo_markdown:\/app\/codeinfo_markdown:ro/u);
  assert.match(e2eServer, /CODEINFO_SERVER_PORT=6010/u);
  assert.match(e2eServer, /CODEINFO_WEB_MCP_PORT=6013/u);
  assert.match(e2eServer, /CODEINFO_LMSTUDIO_HOME=\/app\/lmstudio/u);
  assert.match(
    e2eServer,
    /test: \['CMD', 'curl', '-f', 'http:\/\/localhost:6010\/health'\]/u,
  );
  assert.match(e2eServer, /CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT=3/u);
  assert.match(e2eServer, /CODEINFO_RUNTIME_SERVER_PORTS=6010,6011,6012,6013/u);
  assert.match(
    e2eServer,
    /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}:\/host\/codex:ro/u,
  );
  assert.match(e2eServer, /codex-data:\/app\/codex/u);
  assert.doesNotMatch(e2eServer, /codex-data:\/host\/codex:ro/u);
});

test('checked-in env and README keep the documented host Codex-home fallback contract intact', () => {
  const serverEnv = readRepoFile('server/.env');
  const e2eEnv = readRepoFile('.env.e2e');
  const readme = readRepoFile('README.md');
  const mainCompose = readRepoFile('docker-compose.yml');
  const e2eCompose = readRepoFile('docker-compose.e2e.yml');

  assert.doesNotMatch(serverEnv, /^CODEINFO_HOST_CODEX_HOME=\.\/codex$/mu);
  assert.doesNotMatch(e2eEnv, /^CODEINFO_HOST_CODEX_HOME=\.\/codex$/mu);
  assert.match(readme, /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}/u);
  assert.match(
    mainCompose,
    /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}:\/host\/codex:ro/u,
  );
  assert.match(
    e2eCompose,
    /\$\{CODEINFO_HOST_CODEX_HOME:-\$HOME\/\.codex\}:\/host\/codex:ro/u,
  );
});

test('checked-in default launcher awaits provider bootstrap before listen instead of firing it off in the background', () => {
  const indexSource = readRepoFile('server/src/index.ts');

  assert.doesNotMatch(
    indexSource,
    /void ensureAllProviderChatConfigsBootstrapped\(/u,
  );
  assert.match(
    indexSource,
    /const start = async \(\) => \{[\s\S]*await ensureAllProviderChatConfigsBootstrapped\([\s\S]*const httpServer = http\.createServer\(app\);/u,
  );
});

test('checked-in default launcher keeps listening reachable after degraded provider bootstrap is recorded', () => {
  const indexSource = readRepoFile('server/src/index.ts');
  const runtimeConfigSource = readRepoFile(
    'server/src/config/runtimeConfig.ts',
  );

  assert.match(
    runtimeConfigSource,
    /providerBootstrapStatuses\[provider\] = \{\s*provider,\s*healthy: false,/u,
  );
  assert.match(
    runtimeConfigSource,
    /return results\.filter\(Boolean\) as ProviderChatDefaultsSnapshot\[\];/u,
  );
  assert.match(
    indexSource,
    /const bootstrapSnapshots = await ensureAllProviderChatConfigsBootstrapped\([\s\S]*const httpServer = http\.createServer\(app\);/u,
  );
});
