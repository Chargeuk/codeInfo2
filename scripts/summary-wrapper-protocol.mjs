import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const SUMMARY_WRAPPER_HEARTBEAT_ENV = 'SUMMARY_WRAPPER_HEARTBEAT_MS';
export const DEFAULT_SUMMARY_WRAPPER_HEARTBEAT_MS = 60_000;

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
    emitStatus({ status: 'running', reason: 'running' });
  };

  return {
    setPhase(nextPhase) {
      phase = nextPhase;
    },
    getPhase() {
      return phase;
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
}) =>
  new Promise((resolve) => {
    if (phase) {
      protocol?.setPhase(phase);
    }

    writeLogLine(logStream, `${bannerPrefix}$ ${cmd} ${args.join(' ')}`.trim());

    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let stdout = '';
    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, output, stdout });
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      if (collectStdout) stdout += text;
      logStream.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      logStream.write(text);
    });

    child.on('error', (err) => {
      const message = `Spawn error: ${err?.message ?? String(err)}`;
      writeLogLine(logStream, message);
      output += `\n${message}\n`;
      finish(1);
    });

    child.on('close', (code) => finish(code));
  });
