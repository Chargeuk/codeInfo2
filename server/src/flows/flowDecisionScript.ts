import { execFile as execFileCb } from 'node:child_process';
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

export const resolveFlowDecisionScriptPath = (
  codeInfoRoot: string,
  decisionScript: string,
) => {
  const allowedRoot = path.resolve(codeInfoRoot, 'scripts', 'flow_control');
  const scriptPath = path.resolve(codeInfoRoot, decisionScript);
  const relative = path.relative(allowedRoot, scriptPath);
  if (
    !decisionScript.endsWith('.py') ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      'Flow decision scripts must be Python files under scripts/flow_control.',
    );
  }
  return scriptPath;
};

export const runFlowDecisionScript = async (params: {
  codeInfoRoot: string;
  workingFolder: string;
  decisionScript: string;
  execFile?: ExecFile;
}) => {
  const scriptPath = resolveFlowDecisionScriptPath(
    params.codeInfoRoot,
    params.decisionScript,
  );
  const result = await (params.execFile ?? execFile)(
    'python3',
    [scriptPath],
    {
      cwd: params.workingFolder,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    },
  );
  return result.stdout.trim();
};
