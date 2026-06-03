import fs from 'node:fs';
import path from 'node:path';

export const CUCUMBER_SUPPORT_IMPORTS = [
  'src/test/support/chromaContainer.ts',
  'src/test/support/mongoContainer.ts',
];

export const normalizeServerPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  if (withoutDotPrefix.startsWith('server/')) {
    return withoutDotPrefix.slice('server/'.length);
  }
  return withoutDotPrefix;
};

export const deriveTargetedStepImports = (serverDir, features) => {
  const stepImports = [];

  for (const featurePath of features) {
    const match = featurePath.match(/^src\/test\/features\/(.+)\.feature$/u);
    if (!match) return [];

    const candidate = `src/test/steps/${match[1]}.steps.ts`;
    if (!fs.existsSync(path.join(serverDir, candidate))) return [];
    stepImports.push(candidate);
  }

  return [...new Set(stepImports)];
};

export const buildCucumberImportArgs = (serverDir, features) => {
  const normalizedFeatures = features.map((feature) => normalizeServerPath(feature));
  const targetedStepImports =
    normalizedFeatures.length > 0
      ? deriveTargetedStepImports(serverDir, normalizedFeatures)
      : [];

  if (targetedStepImports.length > 0) {
    return [
      ...CUCUMBER_SUPPORT_IMPORTS.flatMap((file) => ['--import', file]),
      ...targetedStepImports.flatMap((file) => ['--import', file]),
    ];
  }

  return [
    ...CUCUMBER_SUPPORT_IMPORTS.flatMap((file) => ['--import', file]),
    '--import',
    'src/test/steps/**/*.ts',
  ];
};
