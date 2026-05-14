const DEFAULT_SERVER_PORT = '5010';
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65535;
const DIGITS_ONLY = /^\d+$/;

const readNonEmpty = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const assertValidPortString = (label: string, value: string): string => {
  if (!DIGITS_ONLY.test(value)) {
    throw new Error(
      `${label} must be a TCP port integer between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}`,
    );
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_TCP_PORT ||
    parsed > MAX_TCP_PORT
  ) {
    throw new Error(
      `${label} must be a TCP port integer between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}`,
    );
  }

  return String(parsed);
};

export const resolveServerPort = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const port =
    readNonEmpty(env.CODEINFO_SERVER_PORT) ??
    readNonEmpty(env.PORT) ??
    DEFAULT_SERVER_PORT;

  return assertValidPortString('CODEINFO_SERVER_PORT', port);
};

export { DEFAULT_SERVER_PORT, assertValidPortString };
