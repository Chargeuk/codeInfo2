import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SUMMARY_WRAPPER_HEARTBEAT_ENV = 'SUMMARY_WRAPPER_HEARTBEAT_MS';
export const DEFAULT_SUMMARY_WRAPPER_HEARTBEAT_MS = 60_000;
export const DEFAULT_SUMMARY_WRAPPER_PROGRESS_STALL_MS = 5 * 60_000;
export const DEFAULT_SUMMARY_WRAPPER_TERMINAL_GRACE_MS = 30_000;
export const SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV =
  'CODEINFO_DEBUG_WRAPPER_LIFECYCLE';

const formatBoolean = (value) => (value ? 'true' : 'false');

const emitFields = (wrapperName, fields) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    console.log(`[${wrapperName}] ${key}: ${value}`);
  }
};

const getLogSizeBytes = (logPath) => {
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
};

export const getSummaryWrapperHeartbeatMs = () => {
  const rawValue = process.env[SUMMARY_WRAPPER_HEARTBEAT_ENV];
  if (!rawValue) return DEFAULT_SUMMARY_WRAPPER_HEARTBEAT_MS;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 100) {
    return DEFAULT_SUMMARY_WRAPPER_HEARTBEAT_MS;
  }

  return parsed;
};

export const classifyAgentAction = ({
  status,
  warningCount,
  ambiguousCounts = false,
  reason,
}) => {
  if (status === 'running') {
    return {
      agentAction: 'wait',
      doNotReadLog: true,
      reason: reason ?? 'running',
    };
  }

  if (status === 'passed' && !ambiguousCounts && (warningCount ?? 0) === 0) {
    return {
      agentAction: 'skip_log',
      doNotReadLog: true,
      reason: reason ?? 'clean_success',
    };
  }

  if (ambiguousCounts) {
    return {
      agentAction: 'inspect_log',
      doNotReadLog: false,
      reason: reason ?? 'ambiguous_counts',
    };
  }

  if ((warningCount ?? 0) > 0) {
    return {
      agentAction: 'inspect_log',
      doNotReadLog: false,
      reason: reason ?? 'warnings_present',
    };
  }

  return {
    agentAction: 'inspect_log',
    doNotReadLog: false,
    reason: reason ?? 'failed',
  };
};

export const createSummaryLogStream = (logPath, { flags = 'w' } = {}) => {
  mkdirSync(path.dirname(logPath), { recursive: true });
  if (flags === 'w') {
    writeFileSync(logPath, '', 'utf8');
    return createWriteStream(logPath, { flags: 'a' });
  }
  return createWriteStream(logPath, { flags });
};

export const writeLogLine = (logStream, text = '') => {
  const suffix = text.endsWith('\n') ? '' : '\n';
  logStream.write(`${text}${suffix}`);
};

// Shared wrapper output contract:
// - Heartbeats always print wrapper name, timestamp, phase, status, log size,
//   agent_action, do_not_read_log, and reason to wrapper stdout only.
// - Final summaries always print the same fields plus the saved log path.
// - Child stdout/stderr is streamed only to the saved log file and never
//   receives the wrapper heartbeat/final guidance lines.
export const createSummaryWrapperProtocol = ({
  wrapperName,
  logPath,
  logDisplayPath = logPath,
  initialPhase = 'setup',
  heartbeatMs = getSummaryWrapperHeartbeatMs(),
}) => {
  let phase = initialPhase;
  let heartbeatTimer;
  let heartbeatExtraFields = {};

  const emitStatus = ({
    status,
    warningCount,
    ambiguousCounts = false,
    reason,
    includeLogPath = false,
    extraFields = {},
  }) => {
    const action = classifyAgentAction({
      status,
      warningCount,
      ambiguousCounts,
      reason,
    });

    emitFields(wrapperName, {
      timestamp: new Date().toISOString(),
      phase,
      status,
      log_size_bytes: getLogSizeBytes(logPath),
      ...extraFields,
      agent_action: action.agentAction,
      do_not_read_log: formatBoolean(action.doNotReadLog),
      reason: action.reason,
      log: includeLogPath ? logDisplayPath : undefined,
    });
  };

  const emitHeartbeat = () => {
    emitStatus({
      status: 'running',
      reason: 'running',
      extraFields: heartbeatExtraFields,
    });
  };

  return {
    setPhase(nextPhase) {
      phase = nextPhase;
    },
    getPhase() {
      return phase;
    },
    setHeartbeatFields(fields = {}) {
      heartbeatExtraFields = { ...fields };
    },
    startHeartbeat() {
      if (heartbeatTimer) return;
      emitHeartbeat();
      heartbeatTimer = setInterval(emitHeartbeat, heartbeatMs);
      heartbeatTimer.unref?.();
    },
    stopHeartbeat() {
      if (!heartbeatTimer) return;
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    },
    emitFinal({
      status,
      warningCount,
      ambiguousCounts = false,
      reason,
      extraFields = {},
    }) {
      this.stopHeartbeat();
      emitStatus({
        status,
        warningCount,
        ambiguousCounts,
        reason,
        includeLogPath: true,
        extraFields,
      });
    },
  };
};

export const runLoggedCommand = ({
  cmd,
  args,
  cwd,
  env = process.env,
  logStream,
  protocol,
  phase,
  collectStdout = false,
  bannerPrefix = '\n',
  semanticProgressPatterns = [],
  terminalSummaryPatterns = [],
  semanticProgressStallMs = DEFAULT_SUMMARY_WRAPPER_PROGRESS_STALL_MS,
  terminalSummaryGraceMs = DEFAULT_SUMMARY_WRAPPER_TERMINAL_GRACE_MS,
}) =>
  new Promise((resolve) => {
    if (phase) {
      protocol?.setPhase(phase);
    }

    writeLogLine(logStream, `${bannerPrefix}$ ${cmd} ${args.join(' ')}`.trim());

    const debugLifecycle =
      env?.[SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV] === '1' ||
      env?.[SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV] === 'true';

    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let stdout = '';
    let settled = false;
    let lastProgressLine = '';
    let lastProgressAt = 0;
    let terminalSummaryLine = '';
    let terminalSummaryAt = 0;
    let stdoutEnded = false;
    let stdoutClosed = false;
    let stderrEnded = false;
    let stderrClosed = false;
    let forcedReason;
    let watchdogTriggered = false;
    let progressWatchdog;
    let killTimer;

    const logLifecycle = (event, fields = {}) => {
      if (!debugLifecycle) return;
      writeLogLine(
        logStream,
        `[wrapper-debug] ${JSON.stringify({
          timestamp: new Date().toISOString(),
          phase: phase ?? protocol?.getPhase?.(),
          cmd,
          event,
          ...fields,
        })}`,
      );
    };

    const noteProgress = (line, kind) => {
      lastProgressLine = line;
      lastProgressAt = Date.now();
      if (kind === 'terminal_summary') {
        terminalSummaryLine = line;
        terminalSummaryAt = lastProgressAt;
      }
    };

    const trackProgress = (text) => {
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (terminalSummaryPatterns.some((pattern) => pattern.test(line))) {
          noteProgress(line, 'terminal_summary');
          continue;
        }
        if (semanticProgressPatterns.some((pattern) => pattern.test(line))) {
          noteProgress(line, 'semantic_progress');
        }
      }
    };

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (progressWatchdog) clearInterval(progressWatchdog);
      if (killTimer) clearTimeout(killTimer);
      logLifecycle('resolve', {
        code: code ?? 1,
        stdoutEnded,
        stdoutClosed,
        stderrEnded,
        stderrClosed,
        lastProgressLine: lastProgressLine || undefined,
        forcedReason,
      });
      resolve({
        code: code ?? 1,
        output,
        stdout,
        lastProgressLine,
        terminalSummaryLine,
        forcedReason,
      });
    };

    logLifecycle('spawn', { pid: child.pid });

    const triggerWatchdog = (reason, progressLine) => {
      if (watchdogTriggered || settled) return;
      watchdogTriggered = true;
      forcedReason = reason;
      writeLogLine(
        logStream,
        `[wrapper-watchdog] ${reason}${progressLine ? ` last_progress=${progressLine}` : ''}`,
      );
      logLifecycle('watchdog_triggered', {
        reason,
        lastProgressLine: progressLine || undefined,
      });
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 5_000);
      killTimer.unref?.();
    };

    if (
      semanticProgressPatterns.length > 0 ||
      terminalSummaryPatterns.length > 0
    ) {
      progressWatchdog = setInterval(() => {
        if (settled || watchdogTriggered) return;
        const now = Date.now();
        if (
          terminalSummaryAt > 0 &&
          now - terminalSummaryAt >= terminalSummaryGraceMs
        ) {
          triggerWatchdog(
            'terminal_summary_without_close',
            terminalSummaryLine || lastProgressLine,
          );
          return;
        }
        if (
          terminalSummaryAt === 0 &&
          lastProgressAt > 0 &&
          now - lastProgressAt >= semanticProgressStallMs
        ) {
          triggerWatchdog('semantic_progress_stalled', lastProgressLine);
        }
      }, 15_000);
      progressWatchdog.unref?.();
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      if (collectStdout) stdout += text;
      logStream.write(text);
      trackProgress(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      logStream.write(text);
      trackProgress(text);
    });

    child.stdout.on('end', () => {
      stdoutEnded = true;
      logLifecycle('stdout_end', {
        lastProgressLine: lastProgressLine || undefined,
      });
    });

    child.stdout.on('close', () => {
      stdoutClosed = true;
      logLifecycle('stdout_close', {
        lastProgressLine: lastProgressLine || undefined,
      });
    });

    child.stderr.on('end', () => {
      stderrEnded = true;
      logLifecycle('stderr_end', {
        lastProgressLine: lastProgressLine || undefined,
      });
    });

    child.stderr.on('close', () => {
      stderrClosed = true;
      logLifecycle('stderr_close', {
        lastProgressLine: lastProgressLine || undefined,
      });
    });

    child.on('error', (err) => {
      const message = `Spawn error: ${err?.message ?? String(err)}`;
      writeLogLine(logStream, message);
      output += `\n${message}\n`;
      logLifecycle('error', {
        message: err?.message ?? String(err),
        lastProgressLine: lastProgressLine || undefined,
      });
      finish(1);
    });

    child.on('exit', (code, signal) => {
      logLifecycle('exit', {
        code,
        signal: signal ?? undefined,
        stdoutEnded,
        stdoutClosed,
        stderrEnded,
        stderrClosed,
        lastProgressLine: lastProgressLine || undefined,
      });
    });

    child.on('close', (code, signal) => {
      logLifecycle('close', {
        code,
        signal: signal ?? undefined,
        stdoutEnded,
        stdoutClosed,
        stderrEnded,
        stderrClosed,
        lastProgressLine: lastProgressLine || undefined,
      });
      finish(code);
    });
  });
