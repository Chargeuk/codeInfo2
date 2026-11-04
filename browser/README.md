# Browser VR testing

CodeInfo2 includes offline WebXR emulation for browser tests. The browser startup path makes its initialization script available before page scripts; the pinned IWER 2.7.0 runtime is installed only after a test opts in. Ordinary sessions retain Chromium's native XR API and stay in 2D.

## Availability and lifecycle

The emulation is included in both the isolated Playwright MCP browser and the server's Chrome DevTools browser. After pulling or changing this browser support, rebuild the Docker images and restart the relevant CodeInfo2 stack so the images load the generated init script. For the main stack, run `npm run compose:build` and then `npm run compose:up`. The main and local Compose configurations build the separate MCP image from `browser/Dockerfile`; server images also copy the browser launcher and init script.

From a page on the origin under test, opt in and reload before the application detects WebXR:

```js
window.__codeinfoXR.setEnabledForReload(true);
location.reload();
```

The setting is stored in `sessionStorage`, so it applies to that origin and tab. It cannot change the XR environment already observed by the current document. The next document exposes `window.__codeinfoXR.mode === 'metaQuest3'` and `window.__codeinfoXR.device`. Disable emulation and reload to restore the browser's native API:

```js
window.__codeinfoXR.setEnabledForReload(false);
location.reload();
```

Disabling takes effect in the next document; the current document remains emulated until it is replaced. A fresh tab without an opener has its own session storage and starts in native mode.

## Headset and controller controls

The device is IWER's Meta Quest 3 profile with stereo enabled. Set poses and input values before the frame the test inspects:

```js
const device = window.__codeinfoXR.device;
device.position.set(0.25, 1.75, -0.5);
device.controllers.right.position.set(0.5, 1.25, -0.5);
device.controllers.right.updateButtonValue('trigger', 1);
device.controllers.right.updateAxes('thumbstick', 0.5, -0.25);
```

Controller button and axis values can also be read with `getButtonValue('trigger')` and `getAxes('thumbstick')`. Our browser proof requests the `local-floor` reference space. The emulated session presents left and right views through a stereo framebuffer; browser tests can use `XRWebGLLayer.getViewport(view)` to render and inspect each eye.

## Browser entry points and standalone tests

- The isolated Playwright MCP service uses the generated `/app/browser/xr-init.js` through its `--init-script` option.
- The server starts its own persistent Chromium profile with `browser/start-chromium.mjs`. It registers the same init script on the context before page scripts run, so pages created through an external Chrome DevTools Protocol (CDP) attachment receive the emulation too.
- A standalone Playwright runner must register the script before navigation. From the repository root:

  ```js
  import { chromium } from 'playwright';
  import { createXRInitScript } from './browser/xr-init.mjs';

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript({ content: createXRInitScript() });
  const page = await context.newPage();
  // Navigate only after registering the initialization script.
  ```

## Scope and limitations

This provides software emulation for browser behavior and test input. It does not emulate a physical headset's GPU, performance, thermal behavior, tracking quality, or native multiview implementation. Passing these checks does not replace device testing for those properties.

## Proof record

- `e2e/browser-xr.spec.ts`: focused Compose-backed run passed 1/1. It exercised ordinary native mode, opt-in/reload, a fresh tab, a real Chromium WebXR session with `local-floor`, both eye viewport pixel readbacks, headset/controller poses, trigger selection events, session end, and disable/reload reset.
- Focused server unit checks passed 35/35, including the seven XR unit/contract checks in `server/src/test/unit/browser-xr.test.ts`. The final full server unit run passed 3,117, failed 0, and skipped 3 of 3,120.
- The final full E2E run passed 81/81. The Compose build passed all 3 build items; lint and formatting checks passed.
- The built Playwright MCP image passed the same browser behavior proof through an actual MCP `browser_run_code_unsafe` call in headless Chromium with software WebGL2. It observed native default, reload opt-in, left/right framebuffer pixels, the requested headset/controller poses, right-trigger `selectstart`/`select`/`selectend`, successful session end, a fresh tab in native mode, and native reset after disable/reload.
- The built server image passed the same behavior proof through an external Playwright CDP attachment to Chromium started by `browser/start-chromium.mjs`. It observed both eye pixels, headset/controller poses, trigger selection events, the session end event, a fresh tab in native mode, and native reset. This exercises the server launch path independently of the MCP browser.
- Physical Quest hardware checks for GPU/performance behavior were not run; they remain necessary for properties the software emulator does not cover.
