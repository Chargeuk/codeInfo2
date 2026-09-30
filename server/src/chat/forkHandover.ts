import type { CopilotSession, MCPServerConfig } from '@github/copilot-sdk';

export class ForkInstructionOutcomeUnknownError extends Error {
  readonly code = 'FORK_INSTRUCTION_OUTCOME_UNKNOWN';

  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Copilot fork first instruction may already have been accepted; automatic retry is disabled. ${reason}`,
      { cause },
    );
    this.name = 'ForkInstructionOutcomeUnknownError';
  }
}

export async function sendPendingForkHandover(params: {
  session: Pick<CopilotSession, 'getEvents' | 'rpc' | 'sendAndWait' | 'on'>;
  handovers: string[];
  instruction: string;
  timeoutMs: number;
  signal?: AbortSignal;
  markDelivered: () => Promise<void>;
}) {
  params.signal?.throwIfAborted();
  const events = await params.session.getEvents();
  params.signal?.throwIfAborted();
  // A crash can happen after native acceptance but before Mongo acknowledgement.
  // Read native user events before retrying; send IDs are not event IDs.
  const pending = params.handovers.filter(
    (text) =>
      !events.some(
        (event) => event.type === 'user.message' && event.data.content === text,
      ),
  );
  if (pending.length === 0) {
    await params.markDelivered();
    // Acknowledgement can yield while Stop cancels the next instruction.
    params.signal?.throwIfAborted();
    await params.session.sendAndWait(
      { prompt: params.instruction },
      params.timeoutMs,
    );
    return;
  }
  let resolveIdle!: () => void;
  let rejectWait!: (error: Error) => void;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  const failure = new Promise<never>((_resolve, reject) => {
    rejectWait = reject;
  });
  // Cancellation during listener registration can prevent sending altogether.
  // Observe that rejection even when no RPC is issued to join the race below.
  void failure.catch(() => undefined);
  let batchDispatched = false;
  let providerRunFailed = false;
  const unsubscribe = params.session.on((event) => {
    if (event.agentId) return;
    if (event.type === 'session.idle') resolveIdle();
    else if (event.type === 'session.error') {
      providerRunFailed = true;
      rejectWait(new Error(event.data.message));
    } else if (event.type === 'abort') {
      providerRunFailed = true;
      rejectWait(new Error(event.data.reason || 'Copilot run stopped'));
    }
  });
  const onAbort = () =>
    rejectWait(new Error('Copilot fork instruction aborted'));
  const timer = setTimeout(
    () =>
      rejectWait(
        new Error(
          `Timeout after ${params.timeoutMs}ms waiting for Copilot fork instruction`,
        ),
      ),
    params.timeoutMs,
  );
  params.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // Subscribe before sending: idle/error can arrive before the RPC reply.
    // wait:false keeps native acceptance separate from our configured deadline,
    // which also bounds a stalled RPC. The caller owns disconnect/stop in finally.
    params.signal?.throwIfAborted();
    batchDispatched = true;
    const sent = params.session.rpc.sendMessages({
      messages: [
        ...pending.map((prompt) => ({ prompt })),
        { prompt: params.instruction },
      ],
      wait: false,
    });
    await Promise.race([Promise.all([sent, idle]), failure]);
    await params.markDelivered();
  } catch (error) {
    // Once dispatched, a lost RPC reply/idle or Mongo acknowledgement cannot
    // prove rejection. Retrying the command would replay an accepted instruction.
    // Explicit provider failures and Stop retain their existing retry/cancel path.
    if (batchDispatched && !providerRunFailed && !params.signal?.aborted)
      throw new ForkInstructionOutcomeUnknownError(error);
    throw error;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    params.signal?.removeEventListener('abort', onAbort);
  }
}

export async function enforceForkMcpServers(
  session: Pick<CopilotSession, 'rpc'>,
  target: Record<string, MCPServerConfig> | undefined,
) {
  const listed = await session.rpc.mcp.list();
  for (const server of listed.servers) {
    if (!target?.[server.name])
      await session.rpc.mcp.disable({ serverName: server.name });
  }
}
