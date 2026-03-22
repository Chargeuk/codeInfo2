#!/usr/bin/env node
// Purpose: prove the live main-stack host-network MCP listeners after compose:up.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  writeLogLine,
} from './summary-wrapper-protocol.mjs';
import {
  createMainStackProbeMarkerContext,
  probeMainStackEndpoints,
  renderMainStackProbeReport,
  resolveMainStackProbeEndpoints,
} from '../server/src/test/support/hostNetworkMainProbe.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'host-network-main-latest.log');

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'host-network:main',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'probe',
});

protocol.startHeartbeat();

let exitCode = 1;
let probeResult;

try {
  const endpoints = resolveMainStackProbeEndpoints(process.env);
  probeResult = await probeMainStackEndpoints({ endpoints });

  const report = renderMainStackProbeReport(probeResult);
  writeLogLine(logStream, report);
  console.log(report);

  const markerContext = createMainStackProbeMarkerContext(probeResult);
  const markerLine = `DEV-0000050:T12:main_stack_probe_completed ${JSON.stringify(markerContext)}`;
  writeLogLine(logStream, markerLine);
  console.log(markerLine);

  exitCode = probeResult.result === 'passed' ? 0 : 1;

  protocol.emitFinal({
    status: probeResult.result === 'passed' ? 'passed' : 'failed',
    reason: probeResult.result === 'passed' ? 'clean_success' : 'probe_failed',
  });
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  writeLogLine(logStream, message);
  console.error(message);

  protocol.emitFinal({
    status: 'failed',
    reason: 'probe_failed',
  });
} finally {
  await new Promise((resolve) => logStream.end(resolve));
}

process.exit(exitCode);
