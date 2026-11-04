import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Serialized into the browser's main world, before application scripts.
function initializeXR(loadRuntime) {
  if (window.__codeinfoXR) return;

  const storageKey = 'codeinfo.xr.metaQuest3';
  const control = {
    mode: 'native',
    device: null,
    setEnabledForReload(enabled) {
      if (enabled) window.sessionStorage.setItem(storageKey, 'true');
      else window.sessionStorage.removeItem(storageKey);
      return { reloadRequired: true };
    },
  };
  window.__codeinfoXR = control;

  // Opaque origins (including the initial about:blank) may deny storage.
  let enabled = false;
  try {
    enabled = window.sessionStorage.getItem(storageKey) === 'true';
  } catch {
    return;
  }
  if (!enabled) return;

  const { XRDevice, metaQuest3 } = loadRuntime();
  const device = new XRDevice(metaQuest3);
  device.stereoEnabled = true;
  // Chromium exposes navigator.xr even without a headset. Only an explicit
  // opt-in may replace it; IWER 2.7 otherwise preserves the native runtime.
  device.installRuntime({ forceInstall: true });
  control.device = device;
  control.mode = 'metaQuest3';
}

export function createXRInitScript() {
  const runtime = readFileSync(
    new URL('./vendor/iwer-2.7.0/iwer.min.js', import.meta.url),
    'utf8',
  );
  // Use the published UMD CommonJS seam to keep IWER out of application globals.
  // The runtime factory is never called in ordinary 2D sessions.
  return `(${initializeXR.toString()})(() => {
    const exports = {};
    const module = { exports };
    ${runtime}
    return exports;
  });`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(createXRInitScript());
}
