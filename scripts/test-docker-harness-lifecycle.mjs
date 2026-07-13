import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_LOCK_PATH = path.join(
  tmpdir(),
  'codeinfo2-test-docker-harness.lock',
);

export const TEST_DOCKER_TARGETS = Object.freeze({
  cucumber: Object.freeze({
    projectName: 'codeinfo2-cucumber',
    composeFile: 'server/src/test/compose/docker-compose.chroma.yml',
    readyUrls: Object.freeze(['http://localhost:8100/api/v2/heartbeat']),
    env: Object.freeze({
      CODEINFO_CHROMA_URL: 'http://host.docker.internal:8100',
      CODEINFO_MONGO_URI:
        'mongodb://host.docker.internal:27717/db?directConnection=true',
    }),
  }),
  e2e: Object.freeze({
    projectName: 'codeinfo2-e2e',
    composeFile: 'docker-compose.e2e.yml',
    envFile: '.env.e2e',
    readyUrls: Object.freeze([
      'http://localhost:6010/health',
      'http://localhost:6001',
    ]),
    env: Object.freeze({}),
  }),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targetConfig = (target) => {
  const config = TEST_DOCKER_TARGETS[target];
  if (!config) {
    throw new Error(`Unsupported test Docker target: ${target}`);
  }
  return config;
};

export const createComposeCommand = ({ rootDir, target, action }) => {
  const config = targetConfig(target);
  const args = [path.join(rootDir, 'scripts', 'docker-compose-with-env.sh')];

  if (config.envFile) {
    args.push('--env-file', config.envFile);
  }

  args.push('--project-name', config.projectName, '-f', config.composeFile);

  if (action === 'config') {
    args.push('config');
  } else if (action === 'up') {
    args.push('up', '-d', '--wait', '--wait-timeout', '120');
  } else if (action === 'down') {
    args.push('down', '-v', '--remove-orphans');
  } else {
    throw new Error(`Unsupported test Docker lifecycle action: ${action}`);
  }

  return {
    cmd: 'bash',
    args,
    cwd: rootDir,
    env: process.env,
  };
};

export const waitForHttpReadiness = async ({
  urls,
  timeoutMs = 120_000,
  intervalMs = 500,
  fetchImpl = fetch,
  sleep = wait,
  onAttempt,
}) => {
  const pending = new Set(urls);
  const startedAt = Date.now();
  let lastErrors = [];

  while (pending.size > 0 && Date.now() - startedAt < timeoutMs) {
    lastErrors = [];
    for (const url of pending) {
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) {
          pending.delete(url);
        } else {
          lastErrors.push(`${url}: HTTP ${response.status}`);
        }
      } catch (error) {
        lastErrors.push(
          `${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    onAttempt?.({ pending: [...pending], lastErrors });
    if (pending.size > 0) {
      await sleep(intervalMs);
    }
  }

  if (pending.size > 0) {
    throw new Error(
      `Timed out waiting for test Docker readiness: ${[...pending].join(
        ', ',
      )} (${lastErrors.join('; ')})`,
    );
  }
};

export const waitForProjectRemoval = async ({
  projectName,
  listResources,
  timeoutMs = 30_000,
  intervalMs = 250,
  sleep = wait,
  onAttempt,
}) => {
  const allowedProjects = new Set(
    Object.values(TEST_DOCKER_TARGETS).map((target) => target.projectName),
  );
  if (!allowedProjects.has(projectName)) {
    throw new Error(
      `Refusing to inspect unmanaged Compose project: ${projectName}`,
    );
  }

  const startedAt = Date.now();
  let resources = await listResources(projectName);
  while (
    (resources.containers.length > 0 || resources.networks.length > 0) &&
    Date.now() - startedAt < timeoutMs
  ) {
    onAttempt?.(resources);
    await sleep(intervalMs);
    resources = await listResources(projectName);
  }

  if (resources.containers.length > 0 || resources.networks.length > 0) {
    throw new Error(
      `Compose project ${projectName} still owns resources after teardown: containers=${
        resources.containers.join(',') || 'none'
      } networks=${resources.networks.join(',') || 'none'}`,
    );
  }
};

export const listComposeProjectResources = async (projectName) => {
  const allowedProjects = new Set(
    Object.values(TEST_DOCKER_TARGETS).map((target) => target.projectName),
  );
  if (!allowedProjects.has(projectName)) {
    throw new Error(
      `Refusing to inspect unmanaged Compose project: ${projectName}`,
    );
  }

  const list = async (resource, format) => {
    const { stdout } = await execFileAsync('docker', [
      resource,
      'ls',
      '--filter',
      `label=com.docker.compose.project=${projectName}`,
      '--format',
      format,
    ]);
    return stdout
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  };

  const [containers, networks] = await Promise.all([
    list('container', '{{.Names}}'),
    list('network', '{{.Name}}'),
  ]);
  return { containers, networks };
};

const isProcessAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

export const acquireTestDockerLock = async ({
  lockPath = DEFAULT_LOCK_PATH,
  timeoutMs = 600_000,
  intervalMs = 1_000,
  sleep = wait,
  pidAlive = isProcessAlive,
  onWait,
  recoveryStaleMs = 30_000,
} = {}) => {
  const token = randomUUID();
  const ownerPath = path.join(lockPath, 'owner.json');
  const recoveryPath = `${lockPath}.recovery`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`,
        'utf8',
      );

      let released = false;
      return {
        lockPath,
        token,
        async release() {
          if (released) return;
          released = true;
          try {
            const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
            if (owner.token !== token) {
              throw new Error(
                'Test Docker lock ownership changed before release',
              );
            }
            await fs.rm(lockPath, { recursive: true, force: true });
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    let owner = null;
    try {
      owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError')
        throw error;
    }

    if (!owner || !pidAlive(owner.pid)) {
      const recoveryToken = randomUUID();
      try {
        await fs.writeFile(
          recoveryPath,
          `${JSON.stringify({ pid: process.pid, token: recoveryToken, startedAt: new Date().toISOString() })}\n`,
          { encoding: 'utf8', flag: 'wx' },
        );
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let recoveryOwner = null;
        try {
          recoveryOwner = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
        } catch (readError) {
          if (
            readError?.code !== 'ENOENT' &&
            readError?.name !== 'SyntaxError'
          ) {
            throw readError;
          }
        }
        const recoveryStartedAt = Date.parse(recoveryOwner?.startedAt ?? '');
        if (
          !recoveryOwner ||
          !pidAlive(recoveryOwner.pid) ||
          !Number.isFinite(recoveryStartedAt) ||
          Date.now() - recoveryStartedAt > recoveryStaleMs
        ) {
          await fs.rm(recoveryPath, { force: true });
          continue;
        }
        await sleep(intervalMs);
        continue;
      }
      try {
        let currentOwner = null;
        try {
          currentOwner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError') {
            throw error;
          }
        }
        if (!currentOwner || !pidAlive(currentOwner.pid)) {
          await fs.rm(lockPath, { recursive: true, force: true });
        }
      } finally {
        let recoveryOwner = null;
        try {
          recoveryOwner = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError') {
            throw error;
          }
        }
        if (recoveryOwner?.token === recoveryToken) {
          await fs.rm(recoveryPath, { force: true });
        }
      }
      continue;
    }

    onWait?.(owner);
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for the test Docker lock at ${lockPath}`);
};
