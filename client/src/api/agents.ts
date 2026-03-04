import { getApiBaseUrl } from './baseUrl';

type AgentSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: string[];
};

export type AgentApiErrorDetails = {
  status: number;
  code?: string;
  message: string;
};

export class AgentApiError extends Error {
  status: number;
  code?: string;

  constructor(details: AgentApiErrorDetails) {
    super(details.message);
    this.name = 'AgentApiError';
    this.status = details.status;
    this.code = details.code;
  }
}

function isJsonContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') || normalized.includes('+json')
  );
}

async function parseAgentApiErrorResponse(res: Response): Promise<{
  code?: string;
  message?: string;
  text?: string;
}> {
  const contentType =
    typeof res.headers?.get === 'function'
      ? res.headers.get('content-type')
      : null;

  if (isJsonContentType(contentType)) {
    try {
      const data = (await res.json()) as unknown;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        return {
          code: typeof record.code === 'string' ? record.code : undefined,
          message:
            typeof record.message === 'string' ? record.message : undefined,
        };
      }
      return {};
    } catch {
      return {};
    }
  }

  const text = await res.text().catch(() => '');
  return { text: text || undefined };
}

async function throwAgentApiError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const parsed = await parseAgentApiErrorResponse(res);
  const message =
    parsed.message ?? `${baseMessage}${parsed.text ? `: ${parsed.text}` : ''}`;
  throw new AgentApiError({
    status: res.status,
    code: parsed.code,
    message,
  });
}

const serverBase = getApiBaseUrl();

export type AgentPromptEntry = {
  relativePath: string;
  fullPath: string;
};

export async function listAgents(): Promise<{ agents: AgentSummary[] }> {
  const res = await fetch(new URL('/agents', serverBase).toString());
  if (!res.ok) {
    throw new Error(`Failed to load agents (${res.status})`);
  }
  const data = (await res.json()) as { agents?: unknown };
  const agents = Array.isArray(data.agents) ? (data.agents as unknown[]) : [];
  return {
    agents: agents
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name : undefined;
        if (!name) return null;
        return {
          name,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          disabled:
            typeof record.disabled === 'boolean' ? record.disabled : undefined,
          warnings: Array.isArray(record.warnings)
            ? (record.warnings.filter((w) => typeof w === 'string') as string[])
            : undefined,
        } satisfies AgentSummary;
      })
      .filter(Boolean) as AgentSummary[],
  };
}
export async function listAgentCommands(agentName: string): Promise<{
  commands: Array<{
    name: string;
    description: string;
    disabled: boolean;
    stepCount: number;
    sourceId?: string;
    sourceLabel?: string;
  }>;
}> {
  const res = await fetch(
    new URL(
      `/agents/${encodeURIComponent(agentName)}/commands`,
      serverBase,
    ).toString(),
  );
  if (!res.ok) {
    throw new Error(`Failed to load agent commands (${res.status})`);
  }
  const data = (await res.json()) as { commands?: unknown };
  if (!Array.isArray(data.commands)) {
    throw new Error('Invalid agent commands response');
  }
  const commands = data.commands.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid agent commands response');
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const stepCount =
      typeof record.stepCount === 'number' && Number.isInteger(record.stepCount)
        ? record.stepCount
        : undefined;
    if (!name || stepCount === undefined || stepCount < 1) {
      throw new Error('Invalid agent commands response');
    }
    return {
      name,
      description:
        typeof record.description === 'string' ? record.description : '',
      disabled: typeof record.disabled === 'boolean' ? record.disabled : false,
      stepCount,
      sourceId:
        typeof record.sourceId === 'string' ? record.sourceId : undefined,
      sourceLabel:
        typeof record.sourceLabel === 'string' ? record.sourceLabel : undefined,
    };
  });

  return {
    commands: commands as Array<{
      name: string;
      description: string;
      disabled: boolean;
      stepCount: number;
      sourceId?: string;
      sourceLabel?: string;
    }>,
  };
}

export async function runAgentInstruction(params: {
  agentName: string;
  instruction: string;
  working_folder?: string;
  conversationId?: string;
  signal?: AbortSignal;
}): Promise<{
  status: 'started';
  agentName: string;
  conversationId: string;
  inflightId: string;
  modelId: string;
}> {
  const instructionRaw = params.instruction;
  console.info('DEV-0000035:T11:agents_raw_send_result', {
    source: 'agents_api',
    sent: true,
    reason: 'dispatching',
    rawLength: instructionRaw.length,
    trimmedLength: instructionRaw.trim().length,
  });

  const res = await fetch(
    new URL(
      `/agents/${encodeURIComponent(params.agentName)}/run`,
      serverBase,
    ).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: params.instruction,
        ...(params.working_folder?.trim()
          ? { working_folder: params.working_folder }
          : {}),
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : {}),
      }),
      signal: params.signal,
    },
  );
  if (!res.ok) {
    await throwAgentApiError(
      res,
      `Failed to run agent instruction (${res.status})`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const agentName = typeof data.agentName === 'string' ? data.agentName : '';
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  const inflightId = typeof data.inflightId === 'string' ? data.inflightId : '';
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  if (
    status !== 'started' ||
    !agentName ||
    !conversationId ||
    !inflightId ||
    !modelId
  ) {
    throw new Error('Invalid agent run response');
  }
  return { status: 'started', agentName, conversationId, inflightId, modelId };
}

export async function runAgentCommand(params: {
  agentName: string;
  commandName: string;
  startStep?: number;
  sourceId?: string;
  conversationId?: string;
  working_folder?: string;
  signal?: AbortSignal;
}): Promise<{
  status: 'started';
  agentName: string;
  commandName: string;
  conversationId: string;
  modelId: string;
}> {
  const payload = {
    commandName: params.commandName,
    ...(typeof params.startStep === 'number'
      ? { startStep: params.startStep }
      : {}),
    ...(params.sourceId?.trim() ? { sourceId: params.sourceId } : {}),
    ...(params.conversationId ? { conversationId: params.conversationId } : {}),
    ...(params.working_folder?.trim()
      ? { working_folder: params.working_folder }
      : {}),
  };
  console.info('DEV_0000040_T04_CLIENT_AGENTS_API', {
    endpoint: '/agents/:agentName/commands/run',
    agentName: params.agentName,
    commandName: params.commandName,
    includesStartStep: Object.prototype.hasOwnProperty.call(
      payload,
      'startStep',
    ),
    startStep: typeof params.startStep === 'number' ? params.startStep : null,
  });

  const res = await fetch(
    new URL(
      `/agents/${encodeURIComponent(params.agentName)}/commands/run`,
      serverBase,
    ).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: params.signal,
    },
  );

  if (!res.ok) {
    await throwAgentApiError(
      res,
      `Failed to run agent command (${res.status})`,
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const agentName = typeof data.agentName === 'string' ? data.agentName : '';
  const commandName =
    typeof data.commandName === 'string' ? data.commandName : '';
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  if (
    status !== 'started' ||
    !agentName ||
    !commandName ||
    !conversationId ||
    !modelId
  ) {
    throw new Error('Invalid agent command run response');
  }

  return { status: 'started', agentName, commandName, conversationId, modelId };
}

export async function listAgentPrompts(params: {
  agentName: string;
  working_folder: string;
}): Promise<{ prompts: AgentPromptEntry[] }> {
  const query = new URLSearchParams();
  query.set('working_folder', params.working_folder);
  const route = `/agents/${encodeURIComponent(params.agentName)}/prompts`;
  const url = new URL(`${route}?${query.toString()}`, serverBase).toString();

  console.info(
    `[agents.prompts.api.request] agentName=${params.agentName} workingFolder=${params.working_folder}`,
  );

  try {
    const res = await fetch(url);
    if (!res.ok) {
      await throwAgentApiError(
        res,
        `Failed to list agent prompts (${res.status})`,
      );
    }

    const data = (await res.json()) as { prompts?: unknown };
    const promptsRaw = Array.isArray(data.prompts) ? data.prompts : [];
    const prompts = promptsRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const relativePath =
          typeof record.relativePath === 'string'
            ? record.relativePath
            : undefined;
        const fullPath =
          typeof record.fullPath === 'string' ? record.fullPath : undefined;
        if (!relativePath || !fullPath) return null;
        return { relativePath, fullPath } satisfies AgentPromptEntry;
      })
      .filter(Boolean) as AgentPromptEntry[];

    console.info(
      `[agents.prompts.api.success] agentName=${params.agentName} promptsCount=${prompts.length}`,
    );

    return { prompts };
  } catch (error) {
    const status =
      error instanceof AgentApiError ? String(error.status) : 'none';
    const code =
      error instanceof AgentApiError && error.code ? error.code : 'none';
    console.info(
      `[agents.prompts.api.error] agentName=${params.agentName} status=${status} code=${code}`,
    );
    throw error;
  }
}
