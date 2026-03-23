import {
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type GetAuthStatusResponse,
  type ModelInfo,
  type ResumeSessionConfig,
  type SessionConfig,
} from '@github/copilot-sdk';
import {
  buildCopilotClientOptions,
  type CopilotCliMode,
} from '../config/copilotConfig.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

const TASK2_LOG_MARKER = 'story.0000051.task02.runtime_seam_ready';

type PingResponse = Awaited<ReturnType<CopilotClient['ping']>>;

export interface CopilotRuntimeClient {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  ping(message?: string): Promise<PingResponse>;
  getAuthStatus(): Promise<GetAuthStatusResponse>;
  listModels(): Promise<ModelInfo[]>;
  createSession(config: SessionConfig): Promise<CopilotSession>;
  resumeSession(
    sessionId: string,
    config: ResumeSessionConfig,
  ): Promise<CopilotSession>;
}

export type CopilotRuntimeFactory = (
  options: CopilotClientOptions,
) => CopilotRuntimeClient;

export type CopilotLifecycleOptions = {
  copilotHome?: string;
  cliPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logLevel?: CopilotClientOptions['logLevel'];
  clientFactory?: CopilotRuntimeFactory;
};

const defaultClientFactory: CopilotRuntimeFactory = (
  options: CopilotClientOptions,
) => new CopilotClient(options);

export class CopilotLifecycle {
  readonly copilotHome: string;
  readonly configDir: string;
  readonly cliMode: CopilotCliMode;
  readonly clientOptions: CopilotClientOptions;

  private readonly client: CopilotRuntimeClient;

  constructor(options: CopilotLifecycleOptions = {}) {
    const resolved = buildCopilotClientOptions({
      copilotHome: options.copilotHome,
      cliPath: options.cliPath,
      cwd: options.cwd,
      env: options.env,
      logLevel: options.logLevel,
    });

    this.copilotHome = resolved.copilotHome;
    this.configDir = resolved.configDir;
    this.cliMode = resolved.cliMode;
    this.clientOptions = resolved.clientOptions;
    this.client = (options.clientFactory ?? defaultClientFactory)(
      this.clientOptions,
    );

    append({
      level: 'info',
      message: TASK2_LOG_MARKER,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        cliMode: this.cliMode,
        configDir: this.configDir,
      },
    });
    baseLogger.info(
      {
        cliMode: this.cliMode,
        configDir: this.configDir,
      },
      TASK2_LOG_MARKER,
    );
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<Error[]> {
    return this.client.stop();
  }

  async ping(message?: string): Promise<PingResponse> {
    return this.client.ping(message);
  }

  async getAuthStatus(): Promise<GetAuthStatusResponse> {
    return this.client.getAuthStatus();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.client.listModels();
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    return this.client.createSession(this.withConfigDir(config));
  }

  async resumeSession(
    sessionId: string,
    config: ResumeSessionConfig,
  ): Promise<CopilotSession> {
    return this.client.resumeSession(sessionId, this.withConfigDir(config));
  }

  private withConfigDir<T extends { configDir?: string }>(config: T): T {
    if (config.configDir) return config;
    return {
      ...config,
      configDir: this.configDir,
    };
  }
}
