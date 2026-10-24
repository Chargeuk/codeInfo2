import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

// A harness-owned fixture: no application or external CDN needs XR test hooks.
const fixtureURL = 'https://codeinfo-xr.invalid/';
const fixtureHTML = `<!doctype html><html><head><script>
  window.initialXR = {
    mode: window.__codeinfoXR.mode,
    stereo: window.__codeinfoXR.device?.stereoEnabled ?? false,
    userAgent: navigator.userAgent,
  };
</script></head><body><canvas id="xr" width="800" height="400"></canvas></body></html>`;

test('opt-in precedes app detection, renders both eyes and delivers Quest 3 input, then resets to 2D', async ({
  page,
  context,
}) => {
  const module = await import(
    new URL('../browser/xr-init.mjs', import.meta.url).href
  );
  await context.addInitScript({ content: module.createXRInitScript() });
  await context.route(`${fixtureURL}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: fixtureHTML,
    }),
  );
  await page.goto(fixtureURL);
  const native = await page.evaluate('window.initialXR');
  expect(native.mode).toBe('native');
  expect(native.stereo).toBe(false);

  await page.evaluate('window.__codeinfoXR.setEnabledForReload(true)');
  expect(await page.evaluate('window.__codeinfoXR.mode')).toBe('native');
  await page.reload();
  expect(await page.evaluate('window.initialXR.mode')).toBe('metaQuest3');
  expect(await page.evaluate('window.initialXR.stereo')).toBe(true);

  // A new tab without an opener must not inherit another tab's XR opt-in.
  const nativeTab = await context.newPage();
  try {
    await nativeTab.goto(fixtureURL);
    expect(await nativeTab.evaluate('window.initialXR.mode')).toBe('native');
  } finally {
    await nativeTab.close();
  }

  // Keep WebXR code in the browser realm; no WebXR type shim enters production.
  const result = await page.evaluate(`(async () => {
    const device = window.__codeinfoXR.device;
    const canvas = document.querySelector('#xr');
    const gl = canvas.getContext('webgl2', { xrCompatible: true });
    if (!gl) throw new Error('WebGL2 unavailable in XR proof');
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
    });
    try {
      const layer = new XRWebGLLayer(session, gl);
      session.updateRenderState({ baseLayer: layer });
      const reference = await session.requestReferenceSpace('local-floor');
      const nextFrame = (read) => new Promise((resolve, reject) => {
        session.requestAnimationFrame((time, frame) => {
          try { resolve(read(frame)); } catch (error) { reject(error); }
        });
      });
      device.position.set(0.25, 1.75, -0.5);
      device.controllers.right.position.set(0.5, 1.25, -0.5);
      const stereo = await nextFrame((frame) => {
        const pose = frame.getViewerPose(reference);
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.enable(gl.SCISSOR_TEST);
        const eyes = pose.views.map((view) => {
          const viewport = layer.getViewport(view);
          gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
          gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
          gl.clearColor(view.eye === 'left' ? 1 : 0, 0, view.eye === 'right' ? 1 : 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const pixel = new Uint8Array(4);
          gl.readPixels(viewport.x + Math.floor(viewport.width / 2), viewport.y + Math.floor(viewport.height / 2),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return { eye: view.eye, x: viewport.x, width: viewport.width, pixel: [...pixel] };
        });
        gl.disable(gl.SCISSOR_TEST);
        const right = [...session.inputSources].find((input) => input.handedness === 'right');
        if (!right) throw new Error('Right Quest 3 input source missing');
        const controllerPose = frame.getPose(right.targetRaySpace, reference);
        return {
          eyes,
          head: [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z],
          controller: [controllerPose.transform.position.x, controllerPose.transform.position.y, controllerPose.transform.position.z],
        };
      });
      const events = [];
      for (const type of ['selectstart', 'selectend', 'select']) {
        session.addEventListener(type, (event) => events.push(type + ':' + event.inputSource.handedness));
      }
      device.controllers.right.updateButtonValue('trigger', 1);
      await nextFrame(() => null);
      device.controllers.right.updateButtonValue('trigger', 0);
      await nextFrame(() => null);
      return { ...stereo, events };
    } finally {
      await session.end();
    }
  })()`);
  expect(result.eyes.map((eye: { eye: string }) => eye.eye)).toEqual([
    'left',
    'right',
  ]);
  expect(result.eyes[0].width).toBeGreaterThan(0);
  expect(result.eyes[1].width).toBeGreaterThan(0);
  expect(result.eyes[1].x).toBeGreaterThan(result.eyes[0].x);
  expect(result.eyes[0].pixel).toEqual([255, 0, 0, 255]);
  expect(result.eyes[1].pixel).toEqual([0, 0, 255, 255]);
  expect(result.head).toEqual([0.25, 1.75, -0.5]);
  expect(result.controller).toEqual([0.5, 1.25, -0.5]);
  expect(result.events).toEqual(
    expect.arrayContaining([
      'selectstart:right',
      'selectend:right',
      'select:right',
    ]),
  );

  await page.evaluate('window.__codeinfoXR.setEnabledForReload(false)');
  expect(await page.evaluate('window.__codeinfoXR.mode')).toBe('metaQuest3');
  await page.reload();
  expect(await page.evaluate('window.initialXR')).toEqual(native);
});
