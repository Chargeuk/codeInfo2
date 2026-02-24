const DEFAULT_SERVER_PORT = '5010';

const readNonEmpty = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveServerPort = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  return (
    readNonEmpty(env.SERVER_PORT) ??
    readNonEmpty(env.PORT) ??
    DEFAULT_SERVER_PORT
  );
};

export { DEFAULT_SERVER_PORT };
