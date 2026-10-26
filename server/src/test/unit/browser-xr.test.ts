import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const browserRoot = new URL('../../../../browser/', import.meta.url);

async function initScript(): Promise<string> {
  const module = await import(new URL('xr-init.mjs', browserRoot).href);
  return module.createXRInitScript();
}

type Vector = {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
};
type Controller = {
  position: Vector;
  updateButtonValue(id: string, value: number): void;
  getButtonValue(id: string): number;
  updateAxes(id: string, x: number, y: number): void;
  getAxes(id: string): { x: number; y: number };
};
type Control = {
  mode: string;
  device: null | {
    version: string;
    name: string;
    stereoEnabled: boolean;
    position: Vector;
    controllers: Record<'left' | 'right', Controller>;
  };
  setEnabledForReload(enabled: boolean): { reloadRequired: boolean };
};

function documentFixture() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://codeinfo-xr.invalid/',
    runScripts: 'outside-only',
  });
  const nativeXR = { nativeRuntime: true };
  Object.defineProperty(dom.window.navigator, 'xr', {
    configurable: true,
    value: nativeXR,
  });
  // DOM-only tests exercise IWER installation and controls, not WebGL rendering.
  Object.defineProperty(dom.window, 'WebGL2RenderingContext', {
    value: class WebGL2RenderingContext {},
  });
  Object.defineProperty(dom.window, 'WebGLRenderingContext', {
    value: class WebGLRenderingContext {},
  });
  return {
    dom,
    nativeXR,
    control: () => dom.window.__codeinfoXR as Control,
    xr: () => Reflect.get(dom.window.navigator, 'xr') as unknown,
  };
}

test('bundled IWER matches its pinned published asset', () => {
  const base = new URL('vendor/iwer-2.7.0/', browserRoot);
  const source = JSON.parse(
    fs.readFileSync(new URL('source.json', base), 'utf8'),
  );
  assert.equal(source.version, '2.7.0');
  const digest = createHash('sha256')
    .update(fs.readFileSync(new URL('iwer.min.js', base)))
    .digest('hex');
  assert.equal(digest, source.sha256);
  assert.match(
    fs.readFileSync(new URL('LICENSE', base), 'utf8'),
    /MIT License/u,
  );
});

test('default documents retain native XR, user agent and constructors', async (t) => {
  const f = documentFixture();
  t.after(() => f.dom.window.close());
  const ua = f.dom.window.navigator.userAgent;
  const constructor = f.dom.window.WebGL2RenderingContext;
  const xrDescriptor = Object.getOwnPropertyDescriptor(
    f.dom.window.navigator,
    'xr',
  );
  f.dom.window.eval(await initScript());
  assert.equal(f.control().mode, 'native');
  assert.equal(f.control().device, null);
  assert.equal(f.xr(), f.nativeXR);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(f.dom.window.navigator, 'xr'),
    xrDescriptor,
  );
  assert.equal(f.dom.window.navigator.userAgent, ua);
  assert.equal(f.dom.window.WebGL2RenderingContext, constructor);
  assert.equal(f.dom.window.IWER, undefined);
  assert.equal(f.dom.window.document.body.children.length, 0);

  assert.equal(f.control().setEnabledForReload(true).reloadRequired, true);
  // Opt-in cannot retroactively change the environment an app already observed.
  assert.equal(f.xr(), f.nativeXR);
  assert.equal(f.control().mode, 'native');
  f.dom.window.eval(await initScript());
  assert.equal(f.xr(), f.nativeXR);
});

test('reload opt-in installs stereo Quest 3 over Chromium native XR and exposes controls', async (t) => {
  const f = documentFixture();
  t.after(() => f.dom.window.close());
  f.dom.window.sessionStorage.setItem('codeinfo.xr.metaQuest3', 'true');
  f.dom.window.eval(await initScript());
  assert.equal(f.control().mode, 'metaQuest3');
  assert.notEqual(f.xr(), f.nativeXR);
  const device = f.control().device;
  assert.ok(device);
  assert.equal(device.version, '2.7.0');
  assert.equal(device.name, 'Meta Quest 3');
  assert.equal(device.stereoEnabled, true);
  device.position.set(0.25, 1.75, -0.5);
  assert.deepEqual(
    [device.position.x, device.position.y, device.position.z],
    [0.25, 1.75, -0.5],
  );
  const right = device.controllers.right;
  right.position.set(0.3, 1.2, -0.4);
  right.updateButtonValue('trigger', 1);
  right.updateAxes('thumbstick', 0.5, -0.25);
  assert.equal(right.getButtonValue('trigger'), 1);
  assert.equal(right.getAxes('thumbstick').x, 0.5);
  assert.equal(right.getAxes('thumbstick').y, -0.25);
  assert.equal(f.dom.window.IWER, undefined);

  f.control().setEnabledForReload(false);
  assert.equal(
    f.dom.window.sessionStorage.getItem('codeinfo.xr.metaQuest3'),
    null,
  );
  assert.equal(f.control().mode, 'metaQuest3');
  assert.equal(f.control().device, device);
  assert.notEqual(f.xr(), f.nativeXR);
  // A new document with the cleared marker must revert before app detection.
  const reset = documentFixture();
  t.after(() => reset.dom.window.close());
  reset.dom.window.eval(await initScript());
  assert.equal(reset.control().mode, 'native');
  assert.equal(reset.xr(), reset.nativeXR);
});

test('opaque origins expose the control without changing native APIs or throwing during init', async (t) => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(await initScript());
  const control = dom.window.__codeinfoXR as Control;
  assert.equal(control.mode, 'native');
  assert.equal(control.device, null);
  assert.throws(() => control.setEnabledForReload(true), {
    name: 'SecurityError',
  });
});

test('server Chromium registers initialization on its persistent context and seeds its initial tab', async () => {
  const module = await import(new URL('start-chromium.mjs', browserRoot).href);
  const events: string[] = [];
  const context = {
    addInitScript: async ({ content }: { content: string }) => {
      assert.match(content, /forceInstall: true/u);
      events.push('init');
    },
    pages: () => [
      {
        evaluate: async () => {
          events.push('initial-tab');
        },
      },
    ],
    close: async () => {
      events.push('close');
    },
  };
  const result = await module.startChromium(
    {
      launchPersistentContext: async (
        profile: string,
        options: {
          executablePath: string;
          headless: boolean;
          viewport: unknown;
          args: string[];
        },
      ) => {
        assert.equal(profile, '/tmp/test-owned-profile');
        assert.equal(options.executablePath, '/test/chromium');
        assert.equal(options.headless, false);
        assert.equal(options.viewport, null);
        assert.ok(options.args.includes('--remote-debugging-port=19222'));
        assert.ok(
          options.args.includes('--remote-debugging-address=127.0.0.1'),
        );
        assert.ok(options.args.includes('--enable-unsafe-swiftshader'));
        events.push('launch');
        return context;
      },
    },
    {
      CHROME_BIN: '/test/chromium',
      CHROME_USER_DATA_DIR: '/tmp/test-owned-profile',
      CHROME_REMOTE_DEBUG_PORT: '19222',
      CHROME_REMOTE_DEBUG_ADDRESS: '127.0.0.1',
      CHROME_HEADLESS: 'false',
    },
  );
  assert.equal(result, context);
  assert.deepEqual(events, ['launch', 'init', 'initial-tab']);
});

test('server Chromium closes its owned browser if initialization fails', async () => {
  const module = await import(new URL('start-chromium.mjs', browserRoot).href);
  let closed = false;
  await assert.rejects(
    module.startChromium(
      {
        launchPersistentContext: async () => ({
          addInitScript: async () => {
            throw new Error('init failed');
          },
          close: async () => {
            closed = true;
          },
        }),
      },
      {},
    ),
    /init failed/u,
  );
  assert.equal(closed, true);
});

test('both compose variants build the pinned independent MCP image with isolated pre-app initialization', () => {
  for (const name of ['docker-compose.yml', 'docker-compose.local.yml']) {
    const compose = fs.readFileSync(
      new URL(`../../../../${name}`, import.meta.url),
      'utf8',
    );
    const service = compose
      .split('\n  playwright-mcp:\n')[1]
      ?.split('\nnetworks:')[0];
    assert.ok(service);
    assert.match(service, /dockerfile: browser\/Dockerfile/u);
    assert.match(service, /'--isolated'/u);
    assert.match(service, /'--init-script',\s+'\/app\/browser\/xr-init.js'/u);
    assert.doesNotMatch(service, /--cdp-endpoint/u);
  }
  const docker = fs.readFileSync(new URL('Dockerfile', browserRoot), 'utf8');
  assert.match(docker, /mcp:v0\.0\.83@sha256:[a-f0-9]{64}/u);
  assert.match(
    docker,
    /node \/app\/browser\/xr-init.mjs > \/app\/browser\/xr-init.js/u,
  );
  const entrypoint = fs.readFileSync(
    new URL('../../../../server/entrypoint.sh', import.meta.url),
    'utf8',
  );
  assert.match(entrypoint, /node \/app\/browser\/start-chromium.mjs/u);
  const serverDocker = fs.readFileSync(
    new URL('../../../../server/Dockerfile', import.meta.url),
    'utf8',
  );
  assert.match(serverDocker, /COPY browser \/app\/browser/u);
});
