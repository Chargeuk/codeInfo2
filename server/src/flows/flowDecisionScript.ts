import {
  execFile as execFileCb,
  spawn as spawnProcess,
} from 'node:child_process';
import { realpathSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

type ExecFileResult = { stdout: string; stderr: string };
type ExecFile = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    maxBuffer: number;
  },
) => Promise<ExecFileResult>;

const execFile = promisify(execFileCb) as ExecFile;

const isContainedPath = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const resolveScriptPathWithinRoot = (params: {
  root: string;
  decisionScript: string;
  flowControlOnly: boolean;
}) => {
  const root = path.resolve(params.root);
  const allowedRoot = params.flowControlOnly
    ? path.join(root, 'scripts', 'flow_control')
    : root;
  const scriptPath = path.resolve(root, params.decisionScript);
  if (
    !params.decisionScript.endsWith('.py') ||
    !isContainedPath(allowedRoot, scriptPath)
  ) {
    throw new Error(
      params.flowControlOnly
        ? 'Flow decision scripts must be Python files under scripts/flow_control.'
        : `Script path must stay inside the worked repository root: ${params.decisionScript}`,
    );
  }
  const resolvedAllowedRoot = realpathSync(allowedRoot);
  const resolvedScriptPath = realpathSync(scriptPath);
  if (!isContainedPath(resolvedAllowedRoot, resolvedScriptPath)) {
    throw new Error(
      params.flowControlOnly
        ? 'Flow decision scripts must be Python files under scripts/flow_control.'
        : `Script path must resolve inside the worked repository root: ${params.decisionScript}`,
    );
  }
  return resolvedScriptPath;
};

export const resolveFlowDecisionScriptPath = (
  codeInfoRoot: string,
  decisionScript: string,
) =>
  resolveScriptPathWithinRoot({
    root: codeInfoRoot,
    decisionScript,
    flowControlOnly: true,
  });

export const runFlowDecisionScript = async (params: {
  codeInfoRoot: string;
  workingFolder: string;
  decisionScript: string;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFile;
}) => {
  const scriptPath = resolveFlowDecisionScriptPath(
    params.codeInfoRoot,
    params.decisionScript,
  );
  const result = await (params.execFile ?? execFile)('python3', [scriptPath], {
    cwd: params.workingFolder,
    env: params.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
};

export type FlowDecisionScriptExecutionResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: string };

export const executeFlowDecisionScript = async (params: {
  workingFolder: string;
  scriptRepositoryRoot?: string;
  decisionScript: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<FlowDecisionScriptExecutionResult> => {
  let workingFolder: string;
  let repositoryRoot: string;
  let scriptPath: string;
  try {
    workingFolder = await fsPromises.realpath(params.workingFolder);
  } catch {
    return {
      ok: false,
      reason: `Worked repository root could not be resolved: ${params.workingFolder}`,
    };
  }
  try {
    repositoryRoot = await fsPromises.realpath(
      params.scriptRepositoryRoot ?? params.workingFolder,
    );
  } catch {
    return {
      ok: false,
      reason: `Script repository root could not be resolved: ${params.scriptRepositoryRoot ?? params.workingFolder}`,
    };
  }
  try {
    scriptPath = resolveScriptPathWithinRoot({
      root: repositoryRoot,
      decisionScript: params.decisionScript,
      flowControlOnly: false,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return {
      ok: false,
      reason:
        code === 'ENOENT'
          ? `Script file not found: ${path.resolve(repositoryRoot, params.decisionScript)}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }

  let fileContent: string;
  try {
    fileContent = await fsPromises.readFile(scriptPath, 'utf8');
  } catch {
    return { ok: false, reason: `Script file not found: ${scriptPath}` };
  }
  if (!fileContent.trim()) {
    return { ok: false, reason: `Script file is empty: ${scriptPath}` };
  }

  return new Promise<FlowDecisionScriptExecutionResult>((resolve) => {
    const child = spawnProcess('python3', [scriptPath], {
      cwd: workingFolder,
      env: params.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    const maxOutputLength = 64 * 1024;
    const finish = (result: FlowDecisionScriptExecutionResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      finish({
        ok: false,
        reason: `Script timed out after ${params.timeoutMs}ms: ${params.decisionScript}`,
      });
    }, params.timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > maxOutputLength) {
        outputLimitExceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > maxOutputLength) {
        outputLimitExceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      finish({
        ok: false,
        reason: `Script execution failed: ${error.message}`,
      });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeoutHandle);
      if (timedOut) {
        finish({
          ok: false,
          reason: `Script timed out after ${params.timeoutMs}ms: ${params.decisionScript}`,
        });
        return;
      }
      if (outputLimitExceeded) {
        finish({
          ok: false,
          reason: `Script output exceeded 65536 bytes: ${params.decisionScript}`,
        });
        return;
      }
      if ((exitCode ?? -1) !== 0) {
        const stderrSection = stderr.trim() ? `\nstderr: ${stderr.trim()}` : '';
        const signalSection = signal ? ` (signal ${signal})` : '';
        finish({
          ok: false,
          reason: `Script exited with code ${String(exitCode ?? -1)}${signalSection}: ${stdout.trim()}${stderrSection}`,
        });
        return;
      }
      finish({ ok: true, stdout: stdout.trim() });
    });
  });
};
