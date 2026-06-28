import { spawn } from 'node:child_process';

const formatDurationSeconds = (durationMs) => `${(durationMs / 1000).toFixed(3)}s`;

const pipeWithPrefix = (stream, target, prefix) => {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      target.write(`${prefix}${buffer}\n`);
      buffer = '';
    }
  });
};

export const runCommand = (command) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const child = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const prefix = `[${command.label}] `;
    pipeWithPrefix(child.stdout, process.stdout, prefix);
    pipeWithPrefix(child.stderr, process.stderr, prefix);

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      process.stderr.write(`${prefix}spawn error: ${error.message}\n`);
      resolve({
        ...command,
        code: 1,
        signal: null,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ...command,
        code: code ?? 1,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
      });
    });
  });

export const runCommandsInParallel = async (commands) => {
  const results = await Promise.all(commands.map((command) => runCommand(command)));
  const hasFailure = results.some((result) => result.code !== 0);

  console.log('===== Parallel summary =====');
  for (const result of results) {
    const status = result.code === 0 ? 'passed' : 'failed';
    const signalSuffix = result.signal ? ` signal=${result.signal}` : '';
    console.log(
      `${result.label}: ${status} duration=${formatDurationSeconds(result.durationMs)} exit_code=${result.code}${signalSuffix}`,
    );
  }

  return {
    results,
    exitCode: hasFailure ? 1 : 0,
  };
};
