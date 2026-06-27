#!/usr/bin/env node
// Purpose: prove the live main-stack host-network MCP listeners after compose:up.

import { writeLogLine } from './summary-wrapper-protocol.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import {
  createMainStackProbeMarkerContext,
  probeMainStackEndpoints,
  renderMainStackProbeReport,
  resolveMainStackProbeEndpoints,
} from '../server/src/test/support/hostNetworkMainProbe.mjs';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'host-network:main',
  logBaseName: 'host-network-main',
  logDir: 'logs/test-summaries',
  initialPhase: 'probe',
  description:
    'Probes the live main-stack host-network endpoints after the compose stack is up.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description: 'Show wrapper help and exit without probing endpoints.',
    },
  ],
  examples: ['node scripts/test-summary-host-network-main.mjs --help'],
});

const parsedArgs = wrapper.parseArgs(process.argv.slice(2));

if (parsedArgs.helpRequested) {
  process.stdout.write(wrapper.renderHelp());
  await wrapper.closeLog();
  process.exit(0);
}

if (parsedArgs.error) {
  console.error(parsedArgs.error);
  process.exit(await wrapper.failCli(parsedArgs.error));
}

wrapper.startHeartbeat();

let exitCode = 1;
let probeResult;

try {
  const endpoints = resolveMainStackProbeEndpoints(process.env);
  probeResult = await probeMainStackEndpoints({ endpoints });

  const report = renderMainStackProbeReport(probeResult);
  writeLogLine(wrapper.logStream, report);
  console.log(report);

  const markerContext = createMainStackProbeMarkerContext(probeResult);
  const markerLine = `DEV-0000050:T12:main_stack_probe_completed ${JSON.stringify(markerContext)}`;
  writeLogLine(wrapper.logStream, markerLine);
  console.log(markerLine);

  exitCode = probeResult.result === 'passed' ? 0 : 1;

  await wrapper.closeLog();
  wrapper.protocol.emitFinal({
    status: probeResult.result === 'passed' ? 'passed' : 'failed',
    reason: probeResult.result === 'passed' ? 'clean_success' : 'probe_failed',
  });
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  writeLogLine(wrapper.logStream, message);
  console.error(message);

  await wrapper.closeLog();
  wrapper.protocol.emitFinal({
    status: 'failed',
    reason: 'probe_failed',
  });
}

process.exit(exitCode);
