export type VersionInfo = {
  app: string;
  version: string;
};

export function getAppInfo(app: string, version: string): VersionInfo {
  return { app, version };
}
