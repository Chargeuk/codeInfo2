import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function resolveRepoPath(...segments: string[]): string {
  const serverRoot = process.cwd();
  return path.resolve(serverRoot, '..', ...segments);
}

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(resolveRepoPath(...segments), 'utf8');
}

test('compose files pass workflow provenance and cert source vars into server runtime env', () => {
  const composeFiles = [
    'docker-compose.yml',
    'docker-compose.local.yml',
    'docker-compose.e2e.yml',
  ];
  const requiredEnvironmentLines = [
    '- CODEINFO_RUNTIME_UID=${CODEINFO_DOCKER_UID:-1000}',
    '- CODEINFO_RUNTIME_GID=${CODEINFO_DOCKER_GID:-1000}',
    '- CODEINFO_CORP_CERTS_DIR=${CODEINFO_CORP_CERTS_DIR:-}',
    '- CODEINFO_COMPOSE_WORKFLOW=${CODEINFO_COMPOSE_WORKFLOW:-}',
    '- CODEINFO_INTERPOLATION_SOURCE=${CODEINFO_INTERPOLATION_SOURCE:-}',
    '- CODEINFO_RUNTIME_ENV_FILE_SOURCE=${CODEINFO_RUNTIME_ENV_FILE_SOURCE:-}',
  ];

  for (const composeFile of composeFiles) {
    const content = readRepoFile(composeFile);
    for (const line of requiredEnvironmentLines) {
      assert.match(
        content,
        new RegExp(escapeRegExp(line)),
        `${composeFile} should include ${line}`,
      );
    }
  }
});

test('server entrypoint derives T01 booleans from build metadata and emits T02 from provenance env vars', () => {
  const content = readRepoFile('server', 'entrypoint.sh');

  const requiredMarkers = [
    'runtime_uid="${CODEINFO_RUNTIME_UID:-1000}"',
    'runtime_gid="${CODEINFO_RUNTIME_GID:-1000}"',
    'runtime_supplementary_gids="${CODEINFO_RUNTIME_SUPPLEMENTARY_GIDS:-}"',
    'drop_privileges_and_exec_node() {',
    'if ! command -v setpriv >/dev/null 2>&1; then',
    'exec setpriv \\',
    '--reuid "$runtime_uid" \\',
    '--regid "$runtime_gid" \\',
    '--groups "$target_groups" \\',
    'if [ -r "$build_override_state_file" ]; then',
    'if [ "$npm_registry_override" = "on" ]; then',
    'if [ "$pip_index_override" = "on" ]; then',
    'if [ "$pip_trusted_host_override" = "on" ]; then',
    'corp_certs_mount_source="${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}"',
    'echo "[CODEINFO][T01_COMPOSE_WIRING_APPLIED] corp_certs_mount_source=${corp_certs_mount_source} npm_registry_set=${npm_registry_set} pip_index_set=${pip_index_set} pip_trusted_host_set=${pip_trusted_host_set}"',
    'echo "[CODEINFO][T02_ENV_SOURCE_RESOLVED] workflow=${CODEINFO_COMPOSE_WORKFLOW:-compose} interpolation_source=${CODEINFO_INTERPOLATION_SOURCE:-server/.env+server/.env.local} runtime_env_file=${CODEINFO_RUNTIME_ENV_FILE_SOURCE:-unchanged}"',
    'drop_privileges_and_exec_node',
  ];

  for (const marker of requiredMarkers) {
    assert.match(content, new RegExp(escapeRegExp(marker)));
  }
});

test('server entrypoint stays POSIX-sh compatible around Copilot seed import locals', () => {
  const content = readRepoFile('server', 'entrypoint.sh');

  assert.match(content, /^#!\/usr\/bin\/env sh$/m);
  assert.doesNotMatch(
    content,
    /^\s*local\s+/m,
    'server entrypoint should not use bash-only local declarations under a sh shebang',
  );
});

test('server entrypoint degrades malformed Copilot seed helper stdout into a warning', async () => {
  const content = readRepoFile('server', 'entrypoint.sh');
  const functionMatch = content.match(
    /run_copilot_seed_import\(\) \{[\s\S]*?\n\}\n\nif \[ -x "\$CHROME_BIN" \]; then/u,
  );
  assert(
    functionMatch,
    'expected to locate run_copilot_seed_import in entrypoint',
  );

  const functionSource = functionMatch[0].replace(
    /\n\nif \[ -x "\$CHROME_BIN" \]; then$/u,
    '\n',
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-seed-'));
  const fakeBinDir = path.join(tempRoot, 'bin');
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBinDir, 'node'),
    "#!/usr/bin/env sh\nprintf '%s\\n' 'not-json-helper-output'\n",
    'utf8',
  );
  fs.chmodSync(path.join(fakeBinDir, 'node'), 0o755);

  const shellScript = [
    'set -e',
    functionSource,
    'run_copilot_seed_import >/tmp/entrypoint-seed-stdout.txt 2>/tmp/entrypoint-seed-stderr.txt',
    'printf "%s\\n" survived',
  ].join('\n');

  const result = spawnSync('sh', ['-c', shellScript], {
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      CODEINFO_COPILOT_HOME: '/app/copilot',
      CODEINFO_COPILOT_SEED_HOME: '/seed/copilot',
    },
    encoding: 'utf8',
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /survived/u);
    const stderr = fs.readFileSync('/tmp/entrypoint-seed-stderr.txt', 'utf8');
    assert.match(stderr, /"status":"seed_copy_failed"/u);
    assert.match(stderr, /Malformed Copilot seed bootstrap output/u);
    assert.match(stderr, /not-json-helper-output/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync('/tmp/entrypoint-seed-stdout.txt', { force: true });
    fs.rmSync('/tmp/entrypoint-seed-stderr.txt', { force: true });
  }
});

test('docker-compose.local.yml passes the docker socket gid as a supplemental runtime group', () => {
  const content = readRepoFile('docker-compose.local.yml');

  assert.match(
    content,
    /- CODEINFO_RUNTIME_SUPPLEMENTARY_GIDS=\$\{CODEINFO_DOCKER_RUNTIME_SUPPLEMENTARY_GIDS:-\$\{CODEINFO_DOCKER_SOCK_GID:-0\}\}/,
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
