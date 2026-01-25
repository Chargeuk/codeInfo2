import fs from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from 'pino';

type Params = {
  agentHome: string;
  primaryCodexHome: string;
  logger: Logger;
};

type Result = { seeded: boolean; warning?: string };
type CopyResult = { copied: boolean; warning?: string };

type PropagateParams = {
  agents: Array<{ name: string; home: string }>;
  primaryCodexHome: string;
  logger: Logger;
  targetAgentName?: string;
  overwrite?: boolean;
};

const fileExists = async (filePath: string) => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
};

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => next);
  locks.set(key, chain);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

/**
 * Best-effort seeding: if agent auth is missing and the primary Codex home has
 * auth.json, copy it into the agent home. Never overwrites existing agent auth.
 * Never throws; returns a warning string on failure.
 */
export async function ensureAgentAuthSeeded({
  agentHome,
  primaryCodexHome,
  logger,
}: Params): Promise<Result> {
  const agentAuthPath = path.join(agentHome, 'auth.json');
  const primaryAuthPath = path.join(primaryCodexHome, 'auth.json');

  try {
    return await withLock(agentAuthPath, async () => {
      if (await fileExists(agentAuthPath)) return { seeded: false };
      if (!(await fileExists(primaryAuthPath))) return { seeded: false };

      await fs.mkdir(agentHome, { recursive: true });
      await fs.copyFile(primaryAuthPath, agentAuthPath);

      logger.info(
        { primaryAuthPath, agentAuthPath },
        'Seeded agent Codex auth from primary Codex home',
      );

      return { seeded: true };
    });
  } catch (error) {
    const warning = `Failed to seed auth.json for agent home "${agentHome}": ${(error as Error).message}`;
    logger.warn({ agentHome, primaryCodexHome, err: error }, warning);
    return { seeded: false, warning };
  }
}

export async function copyAgentAuthFromPrimary({
  agentHome,
  primaryCodexHome,
  logger,
  overwrite = false,
}: Params & { overwrite?: boolean }): Promise<CopyResult> {
  const agentAuthPath = path.join(agentHome, 'auth.json');
  const primaryAuthPath = path.join(primaryCodexHome, 'auth.json');

  try {
    return await withLock(agentAuthPath, async () => {
      if (!overwrite && (await fileExists(agentAuthPath))) {
        return { copied: false };
      }
      if (!(await fileExists(primaryAuthPath))) return { copied: false };

      await fs.mkdir(agentHome, { recursive: true });
      await fs.copyFile(primaryAuthPath, agentAuthPath);

      return { copied: true };
    });
  } catch (error) {
    const warning = `Failed to copy auth.json for agent home "${agentHome}": ${(error as Error).message}`;
    logger.warn({ agentHome, primaryCodexHome, err: error }, warning);
    return { copied: false, warning };
  }
}

export async function propagateAgentAuthFromPrimary({
  agents,
  primaryCodexHome,
  logger,
  targetAgentName,
  overwrite = false,
}: PropagateParams): Promise<{ agentCount: number }> {
  const filtered = targetAgentName
    ? agents.filter((agent) => agent.name === targetAgentName)
    : agents;
  const agentCount = filtered.length;

  for (const agent of filtered) {
    await copyAgentAuthFromPrimary({
      agentHome: agent.home,
      primaryCodexHome,
      logger,
      overwrite,
    });
  }

  return { agentCount };
}
