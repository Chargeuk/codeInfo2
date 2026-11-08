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
  private writerExited = false;
  private forcedShutdown = false;
  private readonly ownsProcessGroup = process.platform !== 'win32';
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
      // The npm launcher may spawn a native child with inherited pipes. Give
      // only this helper its own process group; source exec workers are unrelated.
      detached: this.ownsProcessGroup,
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
        this.writerExited = !this.forcedShutdown;
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

  isWriterTerminated(): boolean {
    // Even a failed graceful close can prove this owned process cannot flush later.
    return this.writerExited;
  }

  private async closeWriter() {
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded)
      this.child.stdin.end();
    // EOF lets app-server flush its rollout writer. Killing immediately after
    // inject acknowledgement can lose the handover needed by SDK exec resume.
    let deadline: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => {
        this.forcedShutdown = true;
        try {
          if (this.ownsProcessGroup && this.child.pid)
            process.kill(-this.child.pid, 'SIGKILL');
          else this.child.kill('SIGKILL');
        } catch {
          // A racing exit or failed kill is not proof of durable delivery.
        }
        reject(
          new Error(
            'Codex native writer did not close gracefully; handover delivery remains unconfirmed.',
          ),
        );
      }, 10_000);
    });
    try {
      // A launcher exiting does not imply its inherited pipes have closed.
      // The deadline must settle the caller even if close is never emitted.
      const { code, signal } = await Promise.race([this.exited, timedOut]);
      if (this.forcedShutdown || signal || code !== 0 || this.connectionError)
        throw new Error(
          'Codex native writer did not close gracefully; handover delivery remains unconfirmed.',
        );
    } finally {
      clearTimeout(deadline);
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Codex native session connection closed'));
      }
      this.pending.clear();
      this.lines.close();
      this.child.stdin.destroy();
      this.child.stdout.destroy();
    }
  }
}

export async function withCodexAppServer<T>(
  work: (rpc: CodexAppServer) => Promise<T>,
  createServer = () => new CodexAppServer(),
): Promise<T> {
  const rpc = createServer();
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
