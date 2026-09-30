import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildCodexOptions } from '../config/codexConfig.js';

/** Short-lived, no-inference RPC connection sharing the SDK's CODEX_HOME. */
export class CodexAppServer {
  private readonly child;
  private readonly lines;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private closed = false;
  private readonly exited: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>;
  private closing?: Promise<void>;
  private connectionError?: Error;

  constructor(spawnProcess: typeof spawn = spawn) {
    const options = buildCodexOptions();
    this.child = spawnProcess('codex', ['app-server', '--listen', 'stdio://'], {
      env: options?.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let response: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      const waiter =
        response.id === undefined ? undefined : this.pending.get(response.id);
      if (!waiter) return;
      this.pending.delete(response.id!);
      clearTimeout(waiter.timer);
      if (response.error)
        waiter.reject(new Error(response.error.message ?? 'Codex RPC failed'));
      else waiter.resolve(response.result);
    });
    const fail = (error?: Error) => {
      if (error) this.connectionError = error;
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Codex native session connection closed'));
      }
      this.pending.clear();
    };
    this.child.on('error', fail);
    this.child.stdin.on('error', fail);
    this.exited = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        fail();
        resolve({ code, signal });
      }),
    );
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'codeinfo_fork', title: 'CodeInfo', version: '1.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new Error('Codex native session connection closed'),
      );
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  close(): Promise<void> {
    return (this.closing ??= this.closeWriter());
  }

  private async closeWriter() {
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded)
      this.child.stdin.end();
    // EOF lets app-server flush its rollout writer. Killing immediately after
    // inject acknowledgement can lose the handover needed by SDK exec resume.
    let forced = false;
    const deadline = setTimeout(() => {
      forced = true;
      this.child.kill('SIGKILL');
    }, 10_000);
    try {
      const { code, signal } = await this.exited;
      if (forced || signal || code !== 0 || this.connectionError)
        throw new Error(
          'Codex native writer did not close gracefully; handover delivery remains unconfirmed.',
        );
    } finally {
      clearTimeout(deadline);
      this.lines.close();
    }
  }
}

export async function withCodexAppServer<T>(
  work: (rpc: CodexAppServer) => Promise<T>,
): Promise<T> {
  const rpc = new CodexAppServer();
  try {
    await rpc.initialize();
    return await work(rpc);
  } finally {
    await rpc.close();
  }
}

export type NativeCodexThread = {
  id: string;
  path?: string;
  turns: Array<{
    id: string;
    status: string;
    items: Array<{
      type: string;
      text?: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
  }>;
};
