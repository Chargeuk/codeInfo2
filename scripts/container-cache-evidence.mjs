// BuildKit --progress=plain evidence only; missing or ambiguous steps fail proof.
export const cacheEvidence = (output, service) => {
  const steps = new Map();
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^#(\d+) \[([^\]]+)\] (.+)$/);
    if (header) {
      steps.set(header[1], {
        stage: header[2],
        instruction: header[3],
        status: 'unknown',
      });
    }
    const status = line.match(/^#(\d+) (CACHED|DONE|ERROR)(?:\s|$)/);
    if (status && steps.has(status[1])) steps.get(status[1]).status = status[2];
  }
  const values = [...steps.values()];
  const selectors = {
    npm: (step) =>
      /npm ci/.test(step.instruction) &&
      step.stage.startsWith(service === 'server' ? 'deps ' : 'build '),
    app: (step) =>
      step.instruction === `RUN npm run build --workspace ${service}` ||
      (service === 'server' &&
        step.instruction.includes('npm run build --workspace server')),
  };
  if (service === 'server') {
    selectors.rust = (step) =>
      step.instruction === 'RUN sh /tmp/install-rust-toolchain.sh';
    selectors.browser = (step) =>
      step.instruction.includes(
        '/opt/playwright/node_modules/playwright/cli.js install',
      );
  }
  const report = {};
  for (const [name, select] of Object.entries(selectors)) {
    const matches = values.filter(select);
    if (matches.length !== 1) {
      throw new Error(
        `${service} ${name}: expected one BuildKit step, got ${matches.length}`,
      );
    }
    report[name] = matches[0].status;
    const required = name === 'app' ? 'DONE' : 'CACHED';
    if (report[name] !== required) {
      throw new Error(
        `${service} ${name}: ${report[name]}, expected ${required}`,
      );
    }
  }
  return report;
};
