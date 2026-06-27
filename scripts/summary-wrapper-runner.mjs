import { accessSync, constants, mkdirSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  writeLogLine,
} from './summary-wrapper-protocol.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const formatTimestamp = () =>
  new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

const endWritable = async (stream) => {
  if (!stream || stream.destroyed) {
    return;
  }

  stream.end();
  await once(stream, 'finish');
};

const parseDeclaredArgs = (argv, flagDefinitions) => {
  const values = Object.fromEntries(
    flagDefinitions.map((flag) => [flag.name, flag.multiple ? [] : null]),
  );

  for (const flag of flagDefinitions) {
    if (flag.type === 'boolean') {
      values[flag.name] = false;
    }
  }

  const flagByToken = new Map();
  for (const flag of flagDefinitions) {
    flagByToken.set(`--${flag.name}`, flag);
    if (flag.alias) {
      flagByToken.set(`-${flag.alias}`, flag);
    }
  }

  const setFlagValue = (flag, rawValue) => {
    if (flag.type === 'boolean') {
      if (rawValue !== true) {
        return `Flag --${flag.name} does not accept a value.`;
      }
      values[flag.name] = true;
      return null;
    }

    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return `Flag --${flag.name} requires a value.`;
    }

    if (flag.multiple) {
      values[flag.name].push(rawValue);
    } else {
      values[flag.name] = rawValue;
    }
    return null;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith('-')) {
      return { error: `Unexpected positional argument: ${arg}` };
    }

    const equalsIndex = arg.indexOf('=');
    const token = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue =
      equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined;
    const flag = flagByToken.get(token);

    if (!flag) {
      return { error: `Unknown wrapper flag: ${arg}` };
    }

    if (flag.type === 'boolean') {
      const booleanError = setFlagValue(
        flag,
        inlineValue === undefined ? true : inlineValue,
      );
      if (booleanError) {
        return { error: booleanError };
      }
      continue;
    }

    if (inlineValue !== undefined) {
      const inlineError = setFlagValue(flag, inlineValue);
      if (inlineError) {
        return { error: inlineError };
      }
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue === undefined || nextValue.startsWith('-')) {
      return { error: `Flag --${flag.name} requires a value.` };
    }

    const nextError = setFlagValue(flag, nextValue);
    if (nextError) {
      return { error: nextError };
    }

    index += 1;
  }

  return {
    values,
    helpRequested: values.help === true,
  };
};

export const resolveWritableYarnEnv = () => {
  const homeDir = process.env.HOME;
  const configHome = process.env.XDG_CONFIG_HOME || '/tmp';

  if (homeDir) {
    try {
      accessSync(
        path.join(homeDir, '.config'),
        constants.R_OK | constants.W_OK,
      );
      return {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
      };
    } catch {
      // Fall back to /tmp when the container-local HOME config path is unreadable.
    }
  }

  return {
    ...process.env,
    HOME: '/tmp',
    XDG_CONFIG_HOME: '/tmp',
  };
};

export const createSummaryWrapperRun = ({
  wrapperName,
  logBaseName,
  logDir = 'logs/test-summaries',
  initialPhase = 'setup',
  description,
  allowedFlags = [],
  examples = [],
}) => {
  const timestamp = formatTimestamp();
  const logDirPath = path.join(rootDir, logDir);
  const timestampedLogPath = path.join(
    logDirPath,
    `${logBaseName}-${timestamp}.log`,
  );
  const latestLogPath = path.join(logDirPath, `${logBaseName}-latest.log`);
  const latestLogTempPath = path.join(
    logDirPath,
    `${logBaseName}-latest.${timestamp}.${process.pid}.tmp`,
  );
  const logDisplayPath = path.relative(rootDir, timestampedLogPath);
  const logStream = createSummaryLogStream(timestampedLogPath);
  const protocol = createSummaryWrapperProtocol({
    wrapperName,
    logPath: timestampedLogPath,
    logDisplayPath,
    initialPhase,
  });
  let closed = false;

  const refreshLatestLog = async () => {
    mkdirSync(logDirPath, { recursive: true });
    try {
      await rm(latestLogTempPath, { force: true });
      await copyFile(timestampedLogPath, latestLogTempPath);
      await rename(latestLogTempPath, latestLogPath);
    } finally {
      await rm(latestLogTempPath, { force: true });
    }
  };

  const closeLog = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await endWritable(logStream);
    await refreshLatestLog();
  };

  const appendLogSection = (label, lines = []) => {
    writeLogLine(logStream, `===== ${label} =====`);
    const entries = Array.isArray(lines) ? lines : [lines];
    for (const line of entries) {
      writeLogLine(logStream, line);
    }
    writeLogLine(logStream);
  };

  const renderHelp = () => {
    const usageFlags = allowedFlags
      .filter((flag) => flag.name !== 'help')
      .map((flag) =>
        flag.type === 'boolean'
          ? `[--${flag.name}]`
          : `[--${flag.name} <value>]`,
      )
      .join(' ');

    const lines = [
      wrapperName,
      description,
      '',
      `Usage: node scripts/${path.basename(
        process.argv[1] || '',
      )} ${usageFlags}`.trim(),
      '',
      'Wrapper-owned flags:',
    ];

    for (const flag of allowedFlags) {
      const names = [`--${flag.name}`];
      if (flag.alias) {
        names.push(`-${flag.alias}`);
      }
      const suffix = flag.type === 'boolean' ? '' : ' <value>';
      lines.push(`  ${names.join(', ')}${suffix}  ${flag.description}`);
    }

    lines.push('');
    lines.push(
      `Logs are written to ${logDir}/ as timestamped logs plus ${path.basename(
        latestLogPath,
      )}.`,
    );

    if (examples.length > 0) {
      lines.push('');
      lines.push('Examples:');
      for (const example of examples) {
        lines.push(`  ${example}`);
      }
    }

    return `${lines.join('\n')}\n`;
  };

  const failCli = async (reason) => {
    appendLogSection('WRAPPER CLI FAILURE', reason);
    await closeLog();
    protocol.emitFinal({
      status: 'failed',
      reason: 'wrapper_cli_failure',
      extraFields: {
        wrapper_error: reason,
      },
    });
    return 1;
  };

  return {
    rootDir,
    timestamp,
    logDir,
    logDirPath,
    timestampedLogPath,
    latestLogPath,
    logDisplayPath,
    logStream,
    protocol,
    parseArgs(argv) {
      return parseDeclaredArgs(argv, allowedFlags);
    },
    renderHelp,
    appendLogSection,
    closeLog,
    failCli,
    startHeartbeat() {
      protocol.startHeartbeat();
    },
  };
};
