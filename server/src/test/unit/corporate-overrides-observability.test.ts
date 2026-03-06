import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    'if [ -r "$build_override_state_file" ]; then',
    'if [ "$npm_registry_override" = "on" ]; then',
    'if [ "$pip_index_override" = "on" ]; then',
    'if [ "$pip_trusted_host_override" = "on" ]; then',
    'corp_certs_mount_source="${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}"',
    'echo "[CODEINFO][T01_COMPOSE_WIRING_APPLIED] corp_certs_mount_source=${corp_certs_mount_source} npm_registry_set=${npm_registry_set} pip_index_set=${pip_index_set} pip_trusted_host_set=${pip_trusted_host_set}"',
    'echo "[CODEINFO][T02_ENV_SOURCE_RESOLVED] workflow=${CODEINFO_COMPOSE_WORKFLOW:-compose} interpolation_source=${CODEINFO_INTERPOLATION_SOURCE:-server/.env+server/.env.local} runtime_env_file=${CODEINFO_RUNTIME_ENV_FILE_SOURCE:-unchanged}"',
  ];

  for (const marker of requiredMarkers) {
    assert.match(content, new RegExp(escapeRegExp(marker)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
