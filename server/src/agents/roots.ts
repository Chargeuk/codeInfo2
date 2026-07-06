import fs from 'node:fs/promises';
import path from 'node:path';
import { getScopedProcessEnv } from '../test/support/testEnvOverrideScope.js';

export const CODEINFO_AGENT_ROOT_DIRNAME = 'codeinfo_agents';
export const LEGACY_CODEX_AGENT_ROOT_DIRNAME = 'codex_agents';

export type AgentHomeEnvResolution = {
  preferredAgentHome: string;
  legacyAgentHome: string;
  activeAgentHome: string;
  activeEnvName:
    | 'CODEINFO_AGENT_HOME'
    | 'CODEINFO_CODEX_AGENT_HOME'
    | 'default';
  codeInfoRoot: string;
};

export type ResolvedAgentHome = {
  repositoryRoot: string;
  preferredAgentsRoot: string;
  legacyAgentsRoot: string;
  agentName: string;
  home?: string;
  rootKind?: 'codeinfo_agents' | 'codex_agents';
  warnings: string[];
};

export type AgentTypeValidationResult =
  | {
      ok: true;
      agentType: string;
    }
  | {
      ok: false;
      message: string;
    };

const normalizeOptionalEnvPath = (value: string | undefined) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
};

const pathExistsAsDirectory = async (targetPath: string) => {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
};

const listDirectoryEntries = async (dirPath: string) => {
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    return dirents
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
};

const buildDuplicateWarning = (params: {
  agentName: string;
  repositoryRoot: string;
}) =>
  `Agent "${params.agentName}" exists in both codeinfo_agents and codex_agents under "${params.repositoryRoot}"; using codeinfo_agents and ignoring the legacy codex_agents copy.`;

export const validateRepositoryBackedAgentType = (
  raw: string,
): AgentTypeValidationResult => {
  const agentType = raw.trim();
  if (!agentType) {
    return {
      ok: false,
      message: 'agentType must be a valid agent root name',
    };
  }
  if (agentType.includes('/') || agentType.includes('\\')) {
    return {
      ok: false,
      message: 'agentType must be a valid agent root name',
    };
  }
  if (agentType.includes('..')) {
    return {
      ok: false,
      message: 'agentType must be a valid agent root name',
    };
  }
  return {
    ok: true,
    agentType,
  };
};

export const getAgentRootsForRepository = (repositoryRoot: string) => {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  return {
    repositoryRoot: resolvedRepositoryRoot,
    preferredAgentsRoot: path.join(
      resolvedRepositoryRoot,
      CODEINFO_AGENT_ROOT_DIRNAME,
    ),
    legacyAgentsRoot: path.join(
      resolvedRepositoryRoot,
      LEGACY_CODEX_AGENT_ROOT_DIRNAME,
    ),
  };
};

const getConfiguredAgentRoots = (resolution: AgentHomeEnvResolution) => ({
  repositoryRoot: resolution.codeInfoRoot,
  preferredAgentsRoot: resolution.preferredAgentHome,
  legacyAgentsRoot: resolution.legacyAgentHome,
});

export const resolveAgentHomeEnv = (
  env: Record<string, string | undefined> = process.env,
): AgentHomeEnvResolution => {
  const effectiveEnv = getScopedProcessEnv(env);
  const configuredPreferred = normalizeOptionalEnvPath(
    effectiveEnv.CODEINFO_AGENT_HOME,
  );
  const configuredLegacy = normalizeOptionalEnvPath(
    effectiveEnv.CODEINFO_CODEX_AGENT_HOME,
  );

  if (configuredPreferred) {
    return {
      preferredAgentHome: configuredPreferred,
      legacyAgentHome:
        configuredLegacy ??
        path.join(
          path.resolve(configuredPreferred, '..'),
          LEGACY_CODEX_AGENT_ROOT_DIRNAME,
        ),
      activeAgentHome: configuredPreferred,
      activeEnvName: 'CODEINFO_AGENT_HOME',
      codeInfoRoot: path.resolve(configuredPreferred, '..'),
    };
  }

  if (configuredLegacy) {
    const codeInfoRoot = path.resolve(configuredLegacy, '..');
    return {
      preferredAgentHome: path.join(codeInfoRoot, CODEINFO_AGENT_ROOT_DIRNAME),
      legacyAgentHome: configuredLegacy,
      activeAgentHome: configuredLegacy,
      activeEnvName: 'CODEINFO_CODEX_AGENT_HOME',
      codeInfoRoot,
    };
  }

  const codeInfoRoot = path.resolve('.');
  return {
    preferredAgentHome: path.join(codeInfoRoot, CODEINFO_AGENT_ROOT_DIRNAME),
    legacyAgentHome: path.join(codeInfoRoot, LEGACY_CODEX_AGENT_ROOT_DIRNAME),
    activeAgentHome: path.join(codeInfoRoot, CODEINFO_AGENT_ROOT_DIRNAME),
    activeEnvName: 'default',
    codeInfoRoot,
  };
};

export const resolveAgentHomeForRepository = async (params: {
  repositoryRoot: string;
  agentName: string;
}): Promise<ResolvedAgentHome> => {
  const validatedAgentType = validateRepositoryBackedAgentType(
    params.agentName,
  );
  if (!validatedAgentType.ok) {
    const error = new Error(validatedAgentType.message) as Error & {
      code?: string;
    };
    error.code = 'INVALID_AGENT_NAME';
    throw error;
  }
  const roots = getAgentRootsForRepository(params.repositoryRoot);
  const preferredHome = path.join(
    roots.preferredAgentsRoot,
    validatedAgentType.agentType,
  );
  const legacyHome = path.join(
    roots.legacyAgentsRoot,
    validatedAgentType.agentType,
  );
  const [hasPreferred, hasLegacy] = await Promise.all([
    pathExistsAsDirectory(preferredHome),
    pathExistsAsDirectory(legacyHome),
  ]);

  const warnings =
    hasPreferred && hasLegacy
      ? [
          buildDuplicateWarning({
            agentName: validatedAgentType.agentType,
            repositoryRoot: roots.repositoryRoot,
          }),
        ]
      : [];

  if (hasPreferred) {
    return {
      ...roots,
      agentName: validatedAgentType.agentType,
      home: preferredHome,
      rootKind: 'codeinfo_agents',
      warnings,
    };
  }

  if (hasLegacy) {
    return {
      ...roots,
      agentName: validatedAgentType.agentType,
      home: legacyHome,
      rootKind: 'codex_agents',
      warnings,
    };
  }

  return {
    ...roots,
    agentName: validatedAgentType.agentType,
    warnings,
  };
};

export const listConfiguredAgentHomes = async (
  env: Record<string, string | undefined> = process.env,
) => {
  const resolution = resolveAgentHomeEnv(getScopedProcessEnv(env));
  const roots = getConfiguredAgentRoots(resolution);
  const [preferredNames, legacyNames] = await Promise.all([
    listDirectoryEntries(roots.preferredAgentsRoot),
    listDirectoryEntries(roots.legacyAgentsRoot),
  ]);
  const names = new Set([...preferredNames, ...legacyNames]);
  const resolved = await Promise.all(
    [...names].map(async (agentName): Promise<ResolvedAgentHome> => {
      const preferredHome = path.join(roots.preferredAgentsRoot, agentName);
      const legacyHome = path.join(roots.legacyAgentsRoot, agentName);
      const [hasPreferred, hasLegacy] = await Promise.all([
        pathExistsAsDirectory(preferredHome),
        pathExistsAsDirectory(legacyHome),
      ]);

      const warnings =
        hasPreferred && hasLegacy
          ? [
              buildDuplicateWarning({
                agentName,
                repositoryRoot: roots.repositoryRoot,
              }),
            ]
          : [];

      if (hasPreferred) {
        return {
          ...roots,
          agentName,
          home: preferredHome,
          rootKind: 'codeinfo_agents' as const,
          warnings,
        };
      }

      if (hasLegacy) {
        return {
          ...roots,
          agentName,
          home: legacyHome,
          rootKind: 'codex_agents' as const,
          warnings,
        };
      }

      return {
        ...roots,
        agentName,
        warnings,
      };
    }),
  );

  return {
    ...resolution,
    ...roots,
    agents: resolved.filter((entry) => entry.home),
  };
};
