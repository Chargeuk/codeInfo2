#!/usr/bin/env node
// Builds/runs only disposable contexts and containers; never touches Compose.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cacheEvidence } from './container-cache-evidence.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import { runLoggedCommand } from './summary-wrapper-protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = createSummaryWrapperRun({
  wrapperName: 'container_toolchain',
  logBaseName: 'container-toolchain',
  logDir: 'logs/test-summaries',
  initialPhase: 'prepare',
  description:
    'Disposable source-only cache proof, fresh-image tool/browser smoke and copied Rapier 3D build.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description: 'Show usage without building.',
    },
    {
      name: 'rapier-root',
      type: 'value',
      description: 'Required original Rapier root (read/copy only).',
    },
    {
      name: 'platform',
      type: 'value',
      description: 'Optional linux/amd64 or linux/arm64 Docker platform.',
    },
  ],
  examples: [
    'npm run test:summary:container-toolchain -- --rapier-root /home/dan/code/rapier',
  ],
});
const parsed = wrapper.parseArgs(process.argv.slice(2));
if (parsed.helpRequested) {
  console.log(wrapper.renderHelp());
  await wrapper.closeLog({ promoteLatest: false });
  process.exit(0);
}
const platform = parsed.values?.platform;
if (
  parsed.error ||
  !parsed.values['rapier-root'] ||
  (platform && !['linux/amd64', 'linux/arm64'].includes(platform))
) {
  process.exit(
    await wrapper.failCli(
      parsed.error ||
        'Require --rapier-root and, if supplied, --platform linux/amd64 or linux/arm64',
    ),
  );
}
const rapierRoot = path.resolve(parsed.values['rapier-root']);
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), 'codeinfo-toolchain-proof-'),
);
const context = path.join(temporary, 'context');
const rapierCopy = path.join(temporary, 'rapier');
const proof = path.join(temporary, 'proof');
const identity = `codeinfo-toolchain-proof-${process.pid}-${Date.now()}`;
const images = { server: `${identity}-server`, client: `${identity}-client` };
const volumes = {
  proof: `${identity}-proof`,
  home: `${identity}-home`,
  rapier: `${identity}-rapier`,
};
let status = 'failed';
let reason = 'proof_failed';
const report = { cache: {}, runtime: [], originalRapierUnchanged: false };

async function command(cmd, args, phase, cwd = root, env = process.env) {
  const result = await runLoggedCommand({
    cmd,
    args,
    cwd,
    env,
    phase,
    logStream: wrapper.logStream,
    protocol: wrapper.protocol,
    collectStdout: true,
  });
  if (result.code !== 0) {
    throw new Error(
      `${phase} failed (${result.code}); inspect saved command output`,
    );
  }
  return result;
}

// Capture current tracked/unignored files, including uncommitted reviewed work.
// No ignored credentials, live homes, node_modules or old build artifacts copied.
async function copyRepository(source, destination) {
  const rootResult = await command(
    'git',
    ['rev-parse', '--show-toplevel'],
    'repository_root',
    source,
  );
  if (path.resolve(rootResult.stdout.trim()) !== source) {
    throw new Error(`Expected repository root: ${source}`);
  }
  const result = await command(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    'snapshot',
    source,
  );
  for (const relative of new Set(result.stdout.split('\0').filter(Boolean))) {
    if (/^(codex|copilot|lmstudio|codeinfo_config)\//.test(relative)) continue;
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.cp(path.join(source, relative), target, {
        dereference: false,
        preserveTimestamps: true,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } // Tracked deletions remain deleted.
  }
}

async function repositoryFingerprint(source) {
  const files = await command(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    'fingerprint_files',
    source,
  );
  const digest = createHash('sha256');
  const names = [...new Set(files.stdout.split('\0').filter(Boolean))].sort();
  for (const relative of names) {
    const file = path.join(source, relative);
    try {
      const stat = await fs.lstat(file);
      digest.update(relative + '\0');
      digest.update(
        stat.isSymbolicLink()
          ? await fs.readlink(file)
          : await fs.readFile(file),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return digest.digest('hex');
}

const platformArgs = platform ? ['--platform', platform] : [];
const buildOverrides = [
  'CODEINFO_NPM_REGISTRY',
  'CODEINFO_PIP_INDEX_URL',
  'CODEINFO_PIP_TRUSTED_HOST',
  'CODEINFO_NODE_EXTRA_CA_CERTS',
  'CODEINFO_NPM_FETCH_RETRIES',
  'CODEINFO_NPM_FETCH_RETRY_FACTOR',
  'CODEINFO_NPM_FETCH_RETRY_MINTIMEOUT',
  'CODEINFO_NPM_FETCH_RETRY_MAXTIMEOUT',
  'CODEINFO_NPM_FETCH_TIMEOUT',
]
  .filter((name) => process.env[name])
  .flatMap((name) => ['--build-arg', name]);
async function build(service, phase) {
  return command(
    'docker',
    [
      'build',
      '--progress=plain',
      ...platformArgs,
      ...buildOverrides,
      '-f',
      path.join(context, service, 'Dockerfile'),
      '-t',
      images[service],
      context,
    ],
    phase,
  );
}
async function runtime(uid, args) {
  const name = `${identity}-${uid}`;
  const env = { ...process.env };
  if (env.CODEINFO_NPM_REGISTRY) {
    env.NPM_CONFIG_REGISTRY = env.CODEINFO_NPM_REGISTRY;
  }
  await command(
    'docker',
    [
      'create',
      '--name',
      name,
      ...platformArgs,
      '--env',
      `CODEINFO_RUNTIME_UID=${uid}`,
      '--env',
      `CODEINFO_RUNTIME_GID=${uid}`,
      '--env',
      'HOME=/app/codex',
      '--env',
      'NPM_CONFIG_REGISTRY',
      '--env',
      'HTTPS_PROXY',
      '--env',
      'HTTP_PROXY',
      '--env',
      'NO_PROXY',
      '--mount',
      `type=volume,src=${volumes.proof},dst=/proof`,
      '--mount',
      `type=volume,src=${volumes.home},dst=/app/codex`,
      '--mount',
      `type=volume,src=${volumes.rapier},dst=/work/rapier`,
      '--entrypoint',
      '/bin/sh',
      images.server,
      '/proof/runtime.sh',
      ...args,
    ],
    `create_${uid}`,
    root,
    env,
  );
  if (uid === 1000) {
    await command(
      'docker',
      ['cp', `${proof}/.`, `${name}:/proof`],
      'copy_proof',
    );
    await command(
      'docker',
      ['cp', `${rapierCopy}/.`, `${name}:/work/rapier`],
      'copy_rapier',
    );
  }
  const result = await command(
    'docker',
    ['start', '--attach', name],
    `runtime_${uid}`,
  );
  // docker start's exit status is not proof of the container process exit status.
  const state = await command(
    'docker',
    ['inspect', '--format', '{{.State.ExitCode}}', name],
    `exit_${uid}`,
  );
  if (state.stdout.trim() !== '0') {
    throw new Error(`Runtime ${uid} exited ${state.stdout.trim()}`);
  }
  const artifacts = path.join(temporary, `artifacts-${uid}`);
  await fs.mkdir(artifacts);
  for (const filename of ['native', 'native.rs', 'wasm.rs', 'smoke.wasm']) {
    await command(
      'docker',
      [
        'cp',
        `${name}:/proof/artifacts/${filename}`,
        path.join(artifacts, filename),
      ],
      'copy_artifacts',
    );
  }
  if (uid === 1000) {
    for (const filename of [
      'rapier-pack.json',
      'rapier-native.rlib',
      'rapier_wasm3d.wasm',
    ]) {
      await command(
        'docker',
        [
          'cp',
          `${name}:/proof/artifacts/${filename}`,
          path.join(artifacts, filename),
        ],
        'copy_rapier_artifacts',
      );
    }
    await command(
      'docker',
      [
        'cp',
        `${name}:/work/rapier/bindings/typescript/rapier-compat/builds/3d/pkg`,
        path.join(temporary, 'package'),
      ],
      'copy_package',
    );
  }
  report.runtime.push({
    uid,
    status: 'passed',
    versionsAndSmoke: result.stdout
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('{')),
  });
}

wrapper.protocol.startHeartbeat();
try {
  const before = await command(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'original_rapier_before',
    rapierRoot,
  );
  const originalFingerprint = await repositoryFingerprint(rapierRoot);
  await copyRepository(root, context);
  await copyRepository(rapierRoot, rapierCopy);
  await fs.mkdir(proof);
  await fs.copyFile(
    path.join(root, 'scripts/container-toolchain-runtime.sh'),
    path.join(proof, 'runtime.sh'),
  );
  await fs.copyFile(
    path.join(root, 'scripts/container-package-smoke.mjs'),
    path.join(proof, 'package-smoke.mjs'),
  );
  await build('server', 'server_baseline');
  await build('client', 'client_baseline');
  // Only disposable source copies change; manifests and all install inputs stay fixed.
  await fs.appendFile(
    path.join(context, 'server/src/index.ts'),
    '\nconsole.info("temporary source-only cache proof");\n',
  );
  await fs.appendFile(
    path.join(context, 'client/src/main.tsx'),
    '\nconsole.info("temporary source-only cache proof");\n',
  );
  for (const service of ['server', 'client']) {
    const result = await build(service, `${service}_source_only`);
    report.cache[service] = cacheEvidence(result.output, service);
    console.log(JSON.stringify({ service, cache: report.cache[service] }));
  }
  for (const name of Object.values(volumes)) {
    await command('docker', ['volume', 'create', name], 'create_volume');
  }
  await runtime(1000, []);
  await runtime(12345, ['uid-only']);
  const after = await command(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'original_rapier_after',
    rapierRoot,
  );
  if (
    before.stdout !== after.stdout ||
    originalFingerprint !== (await repositoryFingerprint(rapierRoot))
  ) {
    throw new Error('Original Rapier working tree changed during proof');
  }
  report.originalRapierUnchanged = true;
  status = 'passed';
  reason = 'cache_and_runtime_smoke_passed';
} catch (error) {
  wrapper.logStream.write(`${error.stack}\n`);
  console.error(error.message);
} finally {
  // Only names created by this invocation; no Compose operations or cache pruning.
  for (const args of [
    ...[1000, 12345].map((uid) => ['rm', '-f', `${identity}-${uid}`]),
    ['image', 'rm', ...Object.values(images)],
    ['volume', 'rm', ...Object.values(volumes)],
  ]) {
    await runLoggedCommand({
      cmd: 'docker',
      args,
      logStream: wrapper.logStream,
      protocol: wrapper.protocol,
      phase: 'cleanup',
    });
  }
  // Copied package/native/WASM artifacts remain; large disposable targets are removed.
  report.artifacts = temporary;
  console.log(JSON.stringify(report));
  await fs.writeFile(
    path.join(root, 'logs/test-summaries/container-toolchain-evidence.json'),
    JSON.stringify({ status, ...report }, null, 2) + '\n',
  );
  await wrapper.closeLog();
  wrapper.protocol.emitFinal({ status, reason });
  process.exitCode = status === 'passed' ? 0 : 1;
}
