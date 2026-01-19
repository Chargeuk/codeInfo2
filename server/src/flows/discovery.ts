import fs from 'node:fs/promises';
import path from 'node:path';

import { append } from '../logStore.js';
import { parseFlowFile } from './flowSchema.js';

export type FlowSummary = {
  name: string;
  description: string;
  disabled: boolean;
  error?: string;
};

const INVALID_DESCRIPTION = 'Invalid flow file';

const isJsonFile = (entry: string) => entry.toLowerCase().endsWith('.json');

const resolveFlowsDir = (baseDir?: string): string => {
  if (baseDir) return path.resolve(baseDir);
  if (process.env.FLOWS_DIR) return path.resolve(process.env.FLOWS_DIR);
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..', 'flows');
  return path.resolve('flows');
};

const buildSummary = (params: {
  name: string;
  parsed: ReturnType<typeof parseFlowFile> | null;
  error?: string;
}): FlowSummary => {
  if (!params.parsed?.ok) {
    return {
      name: params.name,
      description: INVALID_DESCRIPTION,
      disabled: true,
      error: params.error ?? INVALID_DESCRIPTION,
    };
  }

  return {
    name: params.name,
    description: params.parsed.flow.description ?? '',
    disabled: false,
  };
};

export async function discoverFlows(params?: {
  baseDir?: string;
}): Promise<FlowSummary[]> {
  const flowsDir = resolveFlowsDir(params?.baseDir);
  let entries: Array<import('node:fs').Dirent>;

  try {
    entries = await fs.readdir(flowsDir, { withFileTypes: true });
  } catch {
    append({
      level: 'info',
      message: 'flows.discovery.scan',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: { totalFlows: 0, disabledFlows: 0 },
    });
    return [];
  }

  const summaries: FlowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isJsonFile(entry.name)) continue;

    const name = entry.name.replace(/\.json$/i, '');
    const filePath = path.join(flowsDir, entry.name);
    const jsonText = await fs.readFile(filePath, 'utf-8').catch(() => null);
    if (!jsonText) {
      summaries.push(
        buildSummary({
          name,
          parsed: null,
          error: 'Unable to read flow file',
        }),
      );
      continue;
    }

    const parsed = parseFlowFile(jsonText);
    summaries.push(
      buildSummary({
        name,
        parsed,
        error: parsed.ok ? undefined : 'Invalid flow file',
      }),
    );
  }

  const disabledFlows = summaries.filter((flow) => flow.disabled).length;
  append({
    level: 'info',
    message: 'flows.discovery.scan',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: { totalFlows: summaries.length, disabledFlows },
  });

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
