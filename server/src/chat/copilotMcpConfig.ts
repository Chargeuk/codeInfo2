import type { MCPServerConfig } from '@github/copilot-sdk';
import type { RuntimeTomlConfig } from '../config/runtimeConfig.js';

type TomlRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is TomlRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (
  value: unknown,
  field: string,
  serverName: string,
): string => {
  if (typeof value !== 'string') {
    throw new Error(
      `copilot mcp server "${serverName}" field "${field}" must be a string`,
    );
  }
  return value;
};

const normalizeStringArray = (
  value: unknown,
  field: string,
  serverName: string,
): string[] => {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(
      `copilot mcp server "${serverName}" field "${field}" must be an array of strings`,
    );
  }
  return [...value];
};

const normalizeStringRecord = (
  value: unknown,
  field: string,
  serverName: string,
): Record<string, string> => {
  if (!isRecord(value)) {
    throw new Error(
      `copilot mcp server "${serverName}" field "${field}" must be a table`,
    );
  }
  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      throw new Error(
        `copilot mcp server "${serverName}" field "${field}.${key}" must be a string`,
      );
    }
    normalized[key] = entryValue;
  }
  return normalized;
};

const normalizeTools = (value: unknown, serverName: string): string[] => {
  if (value === undefined) return ['*'];
  if (typeof value === 'string') return [value];
  return normalizeStringArray(value, 'tools', serverName);
};

const normalizeTimeout = (
  value: unknown,
  serverName: string,
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `copilot mcp server "${serverName}" field "tool_timeout_sec" must be a non-negative number`,
    );
  }
  return Math.round(value * 1000);
};

function toCopilotRemoteServerConfig(
  serverName: string,
  definition: TomlRecord,
): MCPServerConfig {
  const timeout = normalizeTimeout(definition.tool_timeout_sec, serverName);
  const typeValue = definition.type;
  const type =
    typeValue === 'sse'
      ? 'sse'
      : typeValue === undefined || typeValue === 'http'
        ? 'http'
        : (() => {
            throw new Error(
              `copilot mcp server "${serverName}" field "type" must be "http" or "sse" when "url" is present`,
            );
          })();
  return {
    type,
    url: normalizeString(definition.url, 'url', serverName),
    tools: normalizeTools(definition.tools, serverName),
    ...(definition.http_headers !== undefined
      ? {
          headers: normalizeStringRecord(
            definition.http_headers,
            'http_headers',
            serverName,
          ),
        }
      : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

function toCopilotLocalServerConfig(
  serverName: string,
  definition: TomlRecord,
): MCPServerConfig {
  const timeout = normalizeTimeout(definition.tool_timeout_sec, serverName);
  const typeValue = definition.type;
  if (
    typeValue !== undefined &&
    typeValue !== 'local' &&
    typeValue !== 'stdio'
  ) {
    throw new Error(
      `copilot mcp server "${serverName}" field "type" must be "local" or "stdio" when "command" is present`,
    );
  }
  return {
    type: typeValue === 'local' ? 'local' : 'stdio',
    command: normalizeString(definition.command, 'command', serverName),
    args: normalizeStringArray(definition.args ?? [], 'args', serverName),
    tools: normalizeTools(definition.tools, serverName),
    ...(definition.env !== undefined
      ? { env: normalizeStringRecord(definition.env, 'env', serverName) }
      : {}),
    ...(definition.cwd !== undefined
      ? { cwd: normalizeString(definition.cwd, 'cwd', serverName) }
      : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

export function buildCopilotMcpServers(
  runtimeConfig: RuntimeTomlConfig | undefined,
): Record<string, MCPServerConfig> | undefined {
  const rawServers = runtimeConfig?.mcp_servers;
  if (!isRecord(rawServers)) return undefined;

  const normalized: Record<string, MCPServerConfig> = {};
  for (const [serverName, rawDefinition] of Object.entries(rawServers)) {
    if (!isRecord(rawDefinition)) {
      throw new Error(`copilot mcp server "${serverName}" must be a table`);
    }
    if (rawDefinition.url !== undefined) {
      normalized[serverName] = toCopilotRemoteServerConfig(
        serverName,
        rawDefinition,
      );
      continue;
    }
    if (rawDefinition.command !== undefined) {
      normalized[serverName] = toCopilotLocalServerConfig(
        serverName,
        rawDefinition,
      );
      continue;
    }
    throw new Error(
      `copilot mcp server "${serverName}" must define either "url" or "command"`,
    );
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
