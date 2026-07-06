import { hasActiveTestOverrideScope } from '../test/support/testOverrideScope.js';
import {
  enterTestOverrideScope,
  getScopedCodexDetectionOverride,
} from '../test/support/testOverrideScope.js';

export type CodexDetection = {
  available: boolean;
  cliPath?: string;
  authPresent: boolean;
  configPresent: boolean;
  reason?: string;
};

let detection: CodexDetection = {
  available: false,
  authPresent: false,
  configPresent: false,
  reason: 'not detected',
};

export function setCodexDetection(value: CodexDetection) {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({ codexDetection: value });
    return;
  }
  detection = value;
}

export function updateCodexDetection(value: CodexDetection): CodexDetection {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({ codexDetection: value });
    return value;
  }
  detection = value;
  return detection;
}

export function getCodexDetection(): CodexDetection {
  const scoped = getScopedCodexDetectionOverride();
  if (scoped) {
    return scoped;
  }
  return detection;
}
