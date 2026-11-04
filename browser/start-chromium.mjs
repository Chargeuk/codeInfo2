import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createXRInitScript } from './xr-init.mjs';

// This owns the server Chromium only. The isolated Playwright MCP service uses
// its own --init-script and remains an independent browser.
export async function startChromium(browserType, env) {
  const context = await browserType.launchPersistentContext(
    env.CHROME_USER_DATA_DIR || '/tmp/chrome-profile',
    {
      executablePath: env.CHROME_BIN || '/usr/bin/chromium',
      headless: (env.CHROME_HEADLESS || 'true') === 'true',
      viewport: null,
      chromiumSandbox: false,
      args: [
        `--remote-debugging-port=${env.CHROME_REMOTE_DEBUG_PORT || '9222'}`,
        `--remote-debugging-address=${env.CHROME_REMOTE_DEBUG_ADDRESS || '0.0.0.0'}`,
        '--enable-unsafe-swiftshader',
      ],
    },
  );
  try {
    const content = createXRInitScript();
    await context.addInitScript({ content });
    // launchPersistentContext creates an initial about:blank before registration.
    for (const page of context.pages()) await page.evaluate(content);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const context = await startChromium(chromium, process.env);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => void context.close());
  }
  console.log(
    'CodeInfo Chromium ready: CDP with opt-in Meta Quest 3 emulation',
  );
}
