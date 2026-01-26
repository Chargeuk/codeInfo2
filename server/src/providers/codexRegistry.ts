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
  detection = value;
}

export function updateCodexDetection(value: CodexDetection): CodexDetection {
  detection = value;
  return detection;
}

export function getCodexDetection(): CodexDetection {
  return detection;
}
