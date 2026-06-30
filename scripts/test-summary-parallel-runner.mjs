import { spawn } from 'node:child_process';

const formatDurationSeconds = (durationMs) =>
  `${(durationMs / 1000).toFixed(3)}s`;

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
    let timedOut = false;
    let timeoutHandle;
    let forceKillHandle;
    const child = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const prefix = `[${command.label}] `;
    pipeWithPrefix(child.stdout, process.stdout, prefix);
    pipeWithPrefix(child.stderr, process.stderr, prefix);

    const clearTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
        forceKillHandle = undefined;
      }
    };

    if (command.timeoutMs && command.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        process.stderr.write(
          `${prefix}timed out after ${command.timeoutMs}ms; terminating child process\n`,
        );
        child.kill('SIGTERM');
        forceKillHandle = setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 5_000);
        forceKillHandle.unref?.();
      }, command.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
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
      clearTimers();
      resolve({
        ...command,
        code: timedOut ? 1 : (code ?? 1),
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
      });
    });
  });

export const runCommandsInParallel = async (commands) => {
  const results = await Promise.all(
    commands.map((command) => runCommand(command)),
  );
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
