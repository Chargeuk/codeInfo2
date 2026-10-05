import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const server = read('server/Dockerfile');
const client = read('client/Dockerfile');

test('both applications pin the verified multiarch Node image and cache manifest-only workspace installs', () => {
  const image =
    'node:22.21.1-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c';
  for (const dockerfile of [server, client]) {
    const nodeImages = dockerfile.match(/^FROM node:.*$/gm) ?? [];
    assert.ok(nodeImages.length >= 2);
    assert.ok(nodeImages.every((line) => line.includes(image)));
    const install = dockerfile.indexOf(
      'npm ci --workspaces --include-workspace-root',
    );
    assert.ok(install > dockerfile.indexOf('COPY package-lock.json'));
    assert.ok(install > dockerfile.indexOf('COPY common/package*.json'));
    assert.ok(install < dockerfile.indexOf('COPY common ./common'));
    assert.match(
      dockerfile.slice(0, install),
      /RUN --mount=type=cache,target=\/root\/\.npm/u,
    );
    assert.match(
      dockerfile.slice(0, install),
      /NPM_CONFIG_REGISTRY="\$\{CODEINFO_NPM_REGISTRY\}"/u,
    );
  }
  assert.ok(client.indexOf('npm ci') < client.indexOf('COPY tsconfig*.json'));
  for (const name of [
    'VITE_CODEINFO_API_URL',
    'VITE_CODEINFO_LMSTUDIO_URL',
    'VITE_CODEINFO_LOG_FORWARD_ENABLED',
    'VITE_CODEINFO_LOG_MAX_BYTES',
  ]) {
    const argument = client.indexOf(`ARG ${name}\n`);
    const environment = client.indexOf('ENV ' + name + '=${' + name + '}');
    assert.ok(argument > client.lastIndexOf('npm ci'), name);
    assert.ok(argument > client.indexOf('COPY client ./client'), name);
    assert.ok(environment > argument, name);
    assert.ok(
      environment < client.indexOf('RUN npm run build --workspace client'),
      name,
    );
  }
  assert.match(client, /npm ci .*--ignore-scripts --no-audit --no-fund/u);
  assert.doesNotMatch(server, /npm ci .*--ignore-scripts/u); // Native tree-sitter needs install scripts.
  assert.match(
    client,
    /NPM_CONFIG_FETCH_TIMEOUT="\$\{CODEINFO_NPM_FETCH_TIMEOUT\}"/u,
  );
});

test('locked Playwright CLI and image-persisted browser/OS install precede volatile runtime copies', () => {
  const browser = server.indexOf(
    'node /opt/playwright/node_modules/playwright/cli.js install --with-deps chromium',
  );
  const runtime = server.indexOf(' AS runtime');
  assert.ok(browser > runtime);
  for (const marker of [
    'COPY --from=build /app/node_modules',
    'COPY --from=build /app/server/dist',
    'COPY AGENTS.md',
    'COPY scripts',
    'COPY codex_agents',
    'COPY e2e/fixtures',
  ]) {
    assert.ok(browser < server.indexOf(marker), marker);
  }
  assert.match(server, /ENV PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/u);
  assert.match(server, /version !== '1\.56\.1'/u);
  assert.doesNotMatch(server, /npx .*playwright|target=\/ms-playwright/u);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages['node_modules/playwright'].version, '1.56.1');
  assert.equal(lock.packages['node_modules/playwright-core'].version, '1.56.1');
});

test('global npm/Python and pip bootstrap are pinned while required provider versions remain intact', () => {
  const npm = read('server/npm-global.txt').trim().split('\n');
  assert.ok(npm.every((line) => /@\d+\.\d+\.\d+(?:[-.\w]*)?$/u.test(line)));
  for (const pin of [
    '@openai/codex@0.159.2',
    '@github/copilot@1.0.89',
    '@mermaid-js/mermaid-cli@11.15.0',
  ]) {
    assert.ok(npm.includes(pin));
  }
  const requirements = read('server/requirements.txt')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  const constraints = new Set(
    read('server/requirements-constraints.txt')
      .split('\n')
      .map((line) => line.toLowerCase()),
  );
  assert.ok(requirements.every((line) => /^[\w-]+==[\w.]+$/u.test(line)));
  assert.ok(requirements.every((line) => constraints.has(line.toLowerCase())));
  assert.match(server, /ARG PIP_VERSION=26\.2\.1/u);
  assert.match(
    server,
    /-c \/tmp\/requirements-constraints\.txt -r \/tmp\/requirements\.txt/u,
  );
  assert.doesNotMatch(server, /--upgrade pip/u);
  assert.match(server, /PIP_INDEX_URL="\$\{CODEINFO_PIP_INDEX_URL\}"/u);
  assert.match(server, /PIP_TRUSTED_HOST="\$\{CODEINFO_PIP_TRUSTED_HOST\}"/u);
});

test('tool installs use checksum-covered official architectures before runtime ownership and source changes', () => {
  const installer = read('server/install-rust-toolchain.sh');
  const rows = read('server/toolchain-checksums.txt')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(' '));
  for (const [tool, version] of [
    ['rustup', '1.29.1'],
    ['wasm-pack', '0.15.0'],
    ['wasm-bindgen', '0.2.129'],
    ['binaryen', '133'],
  ]) {
    for (const arch of ['amd64', 'arm64']) {
      const entries = rows.filter(
        (row) => row[0] === tool && row[1] === version && row[2] === arch,
      );
      assert.equal(entries.length, 1);
      assert.match(entries[0][3], /^[a-f0-9]{64}$/u);
    }
  }
  assert.match(installer, /sha256sum -c -/u);
  assert.match(installer, /amd64\) release_arch=x86_64/u);
  assert.match(installer, /arm64\) release_arch=aarch64/u);
  assert.match(installer, /--target wasm32-unknown-unknown/u);
  assert.match(installer, /--component rustfmt --component clippy/u);
  assert.match(server, /ARG RUST_VERSION=1\.99\.0/u);
  assert.match(server, /build-essential/u);
  assert.match(server, /xz-utils/u);
  assert.match(server, /RUSTUP_HOME=\/opt\/rustup/u);
  assert.match(server, /CARGO_HOME=\/opt\/cargo/u);
  const install = server.indexOf('RUN sh /tmp/install-rust-toolchain.sh');
  assert.ok(install < server.indexOf('ARG HOME='));
  assert.ok(install < server.indexOf('ARG CODEINFO_RUNTIME_UID='));
  assert.ok(install < server.indexOf('COPY --from=build /app/server/dist'));
  const entrypoint = read('server/entrypoint.sh');
  assert.ok(
    entrypoint.indexOf('codeinfo-prepare-rust-homes') <
      entrypoint.indexOf('drop_privileges_and_exec_node()'),
  );
});

test('Rust home preparation handles ownership changes, skips matching owners and rejects invalid IDs', () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codeinfo-rust-homes-'),
  );
  try {
    for (const directory of ['bin', 'cargo', 'rustup']) {
      fs.mkdirSync(path.join(temporary, directory));
    }
    fs.writeFileSync(
      path.join(temporary, 'bin/id'),
      '#!/bin/sh\nprintf "0\\n"\n',
      {
        mode: 0o755,
      },
    );
    fs.writeFileSync(
      path.join(temporary, 'bin/stat'),
      '#!/bin/sh\nprintf "1000:1000\\n"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(temporary, 'bin/chown'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OWNERSHIP_LOG"\n',
      { mode: 0o755 },
    );
    const log = path.join(temporary, 'owners');
    const invoke = (uid: string) =>
      spawnSync('/bin/sh', [path.join(root, 'server/prepare-rust-homes.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${temporary}/bin:/usr/bin:/bin`,
          CARGO_HOME: `${temporary}/cargo`,
          RUSTUP_HOME: `${temporary}/rustup`,
          CODEINFO_RUNTIME_UID: uid,
          CODEINFO_RUNTIME_GID: '1000',
          OWNERSHIP_LOG: log,
        },
      });
    assert.equal(invoke('1000').status, 0);
    assert.equal(fs.existsSync(log), false);
    assert.equal(invoke('12345').status, 0);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(calls, [
      `-R 12345:1000 ${temporary}/cargo`,
      `-R 12345:1000 ${temporary}/rustup`,
    ]);
    assert.notEqual(invoke('bad').status, 0);
    assert.notEqual(invoke('1:2').status, 0);
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('cache proof accepts real step statuses and rejects missing, rebuilt or ambiguous stable installs', async () => {
  const moduleUrl = new URL(
    '../../../../scripts/container-cache-evidence.mjs',
    import.meta.url,
  ).href;
  const { cacheEvidence } = await import(moduleUrl);
  const output = [
    '#2 [deps 8/8] RUN --mount=type=cache,target=/root/.npm npm ci --workspaces',
    '#2 CACHED',
    '#7 [runtime 25/40] RUN sh /tmp/install-rust-toolchain.sh',
    '#7 CACHED',
    '#8 [runtime 26/40] RUN node /opt/playwright/node_modules/playwright/cli.js install --with-deps chromium',
    '#8 CACHED',
    '#12 [build 10/10] RUN npm run build --workspace common && npm run build --workspace server',
    '#12 DONE 3.0s',
  ].join('\n');
  assert.deepEqual(cacheEvidence(output, 'server'), {
    npm: 'CACHED',
    app: 'DONE',
    rust: 'CACHED',
    browser: 'CACHED',
  });
  assert.throws(
    () => cacheEvidence(output.replace('#7 CACHED', '#7 DONE 10s'), 'server'),
    /rust/u,
  );
  assert.throws(
    () =>
      cacheEvidence(output.replace('#8 CACHED', '#8 1.0 no status'), 'server'),
    /browser/u,
  );
  assert.throws(
    () =>
      cacheEvidence(
        output + '\n#20 [deps 9/9] RUN npm ci\n#20 CACHED',
        'server',
      ),
    /expected one/u,
  );
  assert.throws(
    () =>
      cacheEvidence(output.replace('#12 DONE 3.0s', '#12 CACHED'), 'server'),
    /app/u,
  );
  assert.deepEqual(
    cacheEvidence(
      '#1 [build 7/12] RUN npm ci\n#1 CACHED\n#2 [build 12/12] RUN npm run build --workspace client\n#2 DONE 1s',
      'client',
    ),
    { npm: 'CACHED', app: 'DONE' },
  );
});

test('proof help and invalid flags stop before any Docker operation', () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codeinfo-proof-cli-'),
  );
  try {
    const marker = path.join(temporary, 'docker-called');
    fs.writeFileSync(
      path.join(temporary, 'docker'),
      '#!/bin/sh\nprintf "unexpected Docker call\\n" > "$DOCKER_CALL_MARKER"\nexit 99\n',
      { mode: 0o755 },
    );
    const invoke = (args: string[]) =>
      spawnSync(
        process.execPath,
        [path.join(root, 'scripts/container-toolchain-proof.mjs'), ...args],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: '',
            PATH: `${temporary}:${process.env.PATH}`,
            DOCKER_CALL_MARKER: marker,
          },
        },
      );
    const help = invoke(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--rapier-root/u);
    const invalid = invoke(['--unexpected']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /wrapper_cli_failure/u);
    const invalidPlatform = invoke([
      '--rapier-root',
      '/not-used',
      '--platform',
      'linux/unsupported',
    ]);
    assert.equal(invalidPlatform.status, 1);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
