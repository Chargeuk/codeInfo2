type AgentSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: string[];
};

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

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
  commands: Array<{ name: string; description: string; disabled: boolean }>;
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
  const commands = Array.isArray(data.commands)
    ? (data.commands as unknown[])
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const record = item as Record<string, unknown>;
          const name =
            typeof record.name === 'string' ? record.name : undefined;
          if (!name) return null;
          return {
            name,
            description:
              typeof record.description === 'string' ? record.description : '',
            disabled:
              typeof record.disabled === 'boolean' ? record.disabled : false,
          };
        })
        .filter(Boolean)
    : [];

  return {
    commands: commands as Array<{
      name: string;
      description: string;
      disabled: boolean;
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
  agentName: string;
  conversationId: string;
  modelId: string;
  segments: unknown[];
}> {
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
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to run agent instruction (${res.status})${text ? `: ${text}` : ''}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const agentName = typeof data.agentName === 'string' ? data.agentName : '';
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (!agentName || !conversationId || !modelId) {
    throw new Error('Invalid agent run response');
  }
  return { agentName, conversationId, modelId, segments };
}

export async function runAgentCommand(params: {
  agentName: string;
  commandName: string;
  conversationId?: string;
  working_folder?: string;
  signal?: AbortSignal;
}): Promise<{
  agentName: string;
  commandName: string;
  conversationId: string;
  modelId: string;
}> {
  const res = await fetch(
    new URL(
      `/agents/${encodeURIComponent(params.agentName)}/commands/run`,
      serverBase,
    ).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandName: params.commandName,
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : {}),
        ...(params.working_folder?.trim()
          ? { working_folder: params.working_folder }
          : {}),
      }),
      signal: params.signal,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to run agent command (${res.status})${text ? `: ${text}` : ''}`,
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const agentName = typeof data.agentName === 'string' ? data.agentName : '';
  const commandName =
    typeof data.commandName === 'string' ? data.commandName : '';
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  if (!agentName || !commandName || !conversationId || !modelId) {
    throw new Error('Invalid agent command run response');
  }

  return { agentName, commandName, conversationId, modelId };
}
