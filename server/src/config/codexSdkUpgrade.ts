export const DEV_0000037_T01_EVENT = 'codex_sdk_upgraded';
export const DEV_0000037_T01_REQUIRED_VERSION = '0.106.0';
const DEV_0000037_T01_PREFIX = '[DEV-0000037][T01]';

type LogFn = (message: string) => void;

const isStableSemver = (value: string): boolean =>
  /^\d+\.\d+\.\d+$/.test(value);

export const validateAndLogCodexSdkUpgrade = (
  version: string | undefined,
  options?: {
    logger?: LogFn;
    errorLogger?: LogFn;
  },
): boolean => {
  const logger = options?.logger ?? console.info;
  const errorLogger = options?.errorLogger ?? console.error;
  const normalizedVersion = typeof version === 'string' ? version.trim() : '';
  const stable = isStableSemver(normalizedVersion);
  const matchesRequired =
    normalizedVersion === DEV_0000037_T01_REQUIRED_VERSION;

  if (stable && matchesRequired) {
    logger(
      `${DEV_0000037_T01_PREFIX} event=${DEV_0000037_T01_EVENT} result=success version=${normalizedVersion}`,
    );
    return true;
  }

  const reason =
    normalizedVersion.length === 0
      ? 'missing_version'
      : !stable
        ? 'non_stable_version'
        : 'version_mismatch';
  errorLogger(
    `${DEV_0000037_T01_PREFIX} event=${DEV_0000037_T01_EVENT} result=error version=${normalizedVersion || 'missing'} reason=${reason}`,
  );
  return false;
};
