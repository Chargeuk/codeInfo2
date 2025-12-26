import fs from 'node:fs/promises';
import path from 'node:path';

import { getCodexHome } from '../config/codexConfig.js';
import { baseLogger } from '../logger.js';

import { ensureAgentAuthSeeded } from './authSeed.js';
import type { DiscoveredAgent } from './types.js';

const fileExists = async (filePath: string) => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
};

export const discoverAgents = async (): Promise<DiscoveredAgent[]> => {
  const agentsHomeEnv = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (!agentsHomeEnv) {
    throw new Error('CODEINFO_CODEX_AGENT_HOME is not set');
  }

  const agentsHome = path.resolve(agentsHomeEnv);
  const primaryCodexHome = getCodexHome();
  const dirents = await fs.readdir(agentsHome, { withFileTypes: true });

  const agents: DiscoveredAgent[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;

    const name = dirent.name;
    const home = path.join(agentsHome, name);
    const configPath = path.join(home, 'config.toml');
    if (!(await fileExists(configPath))) continue;

    const descriptionPath = path.join(home, 'description.md');
    const systemPromptPath = path.join(home, 'system_prompt.txt');

    const warnings: string[] = [];

    const seedResult = await ensureAgentAuthSeeded({
      agentHome: home,
      primaryCodexHome,
      logger: baseLogger,
    });
    if (seedResult.warning) warnings.push(seedResult.warning);

    let description: string | undefined;
    const hasDescription = await fileExists(descriptionPath);
    if (hasDescription) {
      try {
        description = await fs.readFile(descriptionPath, 'utf8');
      } catch (error) {
        warnings.push(
          `Failed to read description.md for agent "${name}": ${(error as Error).message}`,
        );
      }
    }

    const hasSystemPrompt = await fileExists(systemPromptPath);
    agents.push({
      name,
      home,
      configPath,
      description,
      descriptionPath: hasDescription ? descriptionPath : undefined,
      systemPromptPath: hasSystemPrompt ? systemPromptPath : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
};
