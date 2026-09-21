import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadStartupEnv, resolveAgentProviderFallbackOrder, resolveCodeinfoEnvResolutions, resolveExternalOpenAiCompatEndpoints, resolveOpenAiEmbeddingCapabilityState, } from '../../config/startupEnv.js';
import { resolveConfig } from '../../ingest/config.js';
import { createOpenAiEmbeddingProvider } from '../../ingest/providers/index.js';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const createServerRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codeinfo2-env-loading-'));
const writeEnvFile = (root: string, name: '.env' | '.env.local', body: string) => {
    fs.writeFileSync(path.join(root, name), body, 'utf8');
};
const legacyServerEnv = (...parts: string[]) => parts.join('_');
const assertDefinedString = (value: string | undefined) => {
    assert.equal(typeof value, 'string');
};
test('loads renamed CODEINFO env keys with .env.local override precedence', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', [
        'CODEINFO_OPENAI_EMBEDDING_KEY=from-env',
        'CODEINFO_CHAT_DEFAULT_PROVIDER=codex',
        '',
    ].join('\n'));
    writeEnvFile(serverRoot, '.env.local', ['CODEINFO_OPENAI_EMBEDDING_KEY=from-env-local', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, 'from-env-local');
    assert.equal(targetEnv.CODEINFO_CHAT_DEFAULT_PROVIDER, 'codex');
    assert.deepEqual(result.orderedFiles, ['server/.env', 'server/.env.local']);
    assert.deepEqual(result.loadedFiles, ['server/.env', 'server/.env.local']);
    assert.equal(result.overrideApplied, true);
    assert.equal(result.valueSources.CODEINFO_OPENAI_EMBEDDING_KEY, 'server/.env.local');
    assert.equal(result.valueSources.CODEINFO_CHAT_DEFAULT_PROVIDER, 'server/.env');
});
test('preseeded process env keeps winning over server/.env.local and server/.env', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {
        CODEINFO_LOG_LEVEL: 'warn',
    };
    writeEnvFile(serverRoot, '.env', ['CODEINFO_LOG_LEVEL=info', ''].join('\n'));
    writeEnvFile(serverRoot, '.env.local', ['CODEINFO_LOG_LEVEL=debug', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    assert.equal(targetEnv.CODEINFO_LOG_LEVEL, 'warn');
    assert.equal(result.valueSources.CODEINFO_LOG_LEVEL, 'preseeded');
    assert.deepEqual(result.loadedFiles, ['server/.env', 'server/.env.local']);
});
test('optional renamed CODEINFO env keys stay absent and defaults can still resolve', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', ['CODEINFO_SERVER_PORT=5010', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    assert.equal(targetEnv.CODEINFO_LOG_LEVEL, undefined);
    assert.deepEqual(result.loadedFiles, ['server/.env']);
    assert.equal(result.overrideApplied, false);
    assert.equal(resolveOpenAiEmbeddingCapabilityState(targetEnv).enabled, false);
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_LOG_LEVEL')?.source, 'absent');
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_DEFAULT_PROVIDER')
        ?.defined, false);
});
test('machine-local runtime endpoints no longer claim tracked ownership through server/.env', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', [
        'CODEINFO_CHAT_DEFAULT_PROVIDER=codex',
        'CODEINFO_LOG_LEVEL=info',
        '',
    ].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    for (const name of [
        'CODEINFO_LMSTUDIO_BASE_URL',
        'CODEINFO_CHROMA_URL',
        'CODEINFO_MONGO_URI',
    ] as const) {
        assert.equal(targetEnv[name], undefined);
        assert.equal(resolutions.find((entry) => entry.name === name)?.source, 'absent');
        assert.equal(resolutions.find((entry) => entry.name === name)?.defined, false);
    }
});
test('runtime server env rename inventory is surfaced through startup env resolution', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', [
        'CODEINFO_SERVER_PORT=5510',
        'CODEINFO_MONGO_URI=mongodb://example/db',
        'CODEINFO_CHROMA_URL=http://example:8000',
        'CODEINFO_CHAT_MCP_PORT=5511',
        'CODEINFO_AGENTS_MCP_PORT=5512',
        'CODEINFO_WEB_MCP_PORT=5513',
        'CODEINFO_HOST_INGEST_DIR=/host/base',
        'CODEINFO_OPENAI_INGEST_MAX_RETRIES=8',
        'CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE=16',
        'CODEINFO_INGEST_OPENAI_MAX_INFLIGHT=8',
        'CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE=1',
        'CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT=3',
        'CODEINFO_INGEST_MAX_QUEUE_SIZE=5',
        '',
    ].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    for (const name of [
        'CODEINFO_SERVER_PORT',
        'CODEINFO_MONGO_URI',
        'CODEINFO_CHROMA_URL',
        'CODEINFO_CHAT_MCP_PORT',
        'CODEINFO_AGENTS_MCP_PORT',
        'CODEINFO_WEB_MCP_PORT',
        'CODEINFO_HOST_INGEST_DIR',
        'CODEINFO_OPENAI_INGEST_MAX_RETRIES',
        'CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE',
        'CODEINFO_INGEST_OPENAI_MAX_INFLIGHT',
        'CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE',
        'CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT',
        'CODEINFO_INGEST_MAX_QUEUE_SIZE',
    ] as const) {
        assertDefinedString(targetEnv[name]);
        assert.equal(resolutions.find((entry) => entry.name === name)?.source, 'server/.env');
        assert.equal(resolutions.find((entry) => entry.name === name)?.defined, true);
        assert.equal(resolutions.find((entry) => entry.name === name)?.nonEmpty, true);
    }
});
test('runtime startup env resolution also surfaces CODEINFO_CHAT_MCP_PORT when it is defined', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', ['CODEINFO_CHAT_MCP_PORT=6511', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    assert.equal(targetEnv.CODEINFO_CHAT_MCP_PORT, '6511');
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_MCP_PORT')
        ?.defined, true);
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_MCP_PORT')
        ?.source, 'server/.env');
});
test('runtime startup env resolution also surfaces CODEINFO_WEB_MCP_PORT when it is defined', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', ['CODEINFO_WEB_MCP_PORT=6513', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    assert.equal(targetEnv.CODEINFO_WEB_MCP_PORT, '6513');
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_WEB_MCP_PORT')
        ?.defined, true);
    assert.equal(resolutions.find((entry) => entry.name === 'CODEINFO_WEB_MCP_PORT')?.source, 'server/.env');
});
test('ignores fully blank CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS segments', () => {
    const resolved = resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: ';; https://example.com/v1|responses ;;',
        },
    });
    assert.deepEqual(resolved.endpoints.map((endpoint) => endpoint.endpointId), ['https://example.com/v1']);
    assert.deepEqual(resolved.warnings, []);
});
test('ignores whitespace-only CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS segments after trimming', () => {
    const resolved = resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: ' https://example.com/v1|responses ;   ; https://example.com/alt/v1|completions ',
        },
    });
    assert.deepEqual(resolved.endpoints.map((endpoint) => endpoint.endpointId), ['https://example.com/v1', 'https://example.com/alt/v1']);
    assert.deepEqual(resolved.warnings, []);
});
test('keeps the first normalized external endpoint and warns on later duplicates', () => {
    const resolved = resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: 'https://example.com/v1|responses;https://example.com/v1/|completions;https://example.com/alt/v1|responses',
        },
    });
    assert.deepEqual(resolved.endpoints.map((endpoint) => endpoint.endpointId), ['https://example.com/v1', 'https://example.com/alt/v1']);
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0] ?? '', /duplicates normalized endpoint https:\/\/example\.com\/v1; keeping first entry/);
});
test('matches labeled external endpoints with raw keys using shared label normalization', () => {
    const resolved = resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: 'Open Router,https://example.com/v1|responses;Legacy,https://example.com/alt/v1|responses',
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: 'open-router,sk-test',
        },
    });
    assert.equal(resolved.endpoints[0]?.displayLabel, 'Open Router');
    assert.equal(resolved.endpoints[0]?.authLookupKey, 'open-router');
    assert.equal(resolved.apiKeysByEndpointId.get('https://example.com/v1'), 'sk-test');
    assert.equal(resolved.apiKeysByAuthLookupKey.get('open-router'), 'sk-test');
    assert.equal(resolved.endpoints[1]?.displayLabel, 'Legacy');
    assert.equal(resolved.apiKeysByEndpointId.get('https://example.com/alt/v1'), undefined);
    assert.deepEqual(resolved.warnings, []);
});
test('fails clearly when CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS contains duplicate normalized labels', () => {
    assert.throws(() => resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: 'Open Router,https://example.com/v1|responses',
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: 'open-router,sk-a;Open Router,sk-b',
        },
    }), /duplicate normalized endpoint label "open-router"/);
});
test('warns when CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS contains an unmatched label', () => {
    const resolved = resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: 'https://example.com/v1|responses',
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: 'openrouter,sk-a',
        },
    });
    assert.equal(resolved.apiKeysByEndpointId.get('https://example.com/v1'), undefined);
    assert.equal(resolved.apiKeysByAuthLookupKey.get('openrouter'), 'sk-a');
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0] ?? '', /does not match any labeled external endpoint/);
});
test('fails clearly when CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS contains a malformed endpoint string', () => {
    assert.throws(() => resolveExternalOpenAiCompatEndpoints({
        env: {
            CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: 'https://example.com/v1|responses;not-a-url|completions',
        },
    }), /RUNTIME_CONFIG_INVALID: CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS\[2\]: expected an explicit http or https \/v1 base URL/);
});
test('blank CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER falls back to the checked-in default order', () => {
    const resolved = resolveAgentProviderFallbackOrder({
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: '   ',
    });
    assert.deepEqual(resolved.normalizedProviders, ['codex', 'copilot']);
    assert.equal(resolved.usedDefault, true);
});
test('trims whitespace-padded CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER entries without changing order', () => {
    const resolved = resolveAgentProviderFallbackOrder({
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: ' codex , lmstudio ',
    });
    assert.deepEqual(resolved.normalizedProviders, ['codex', 'lmstudio']);
    assert.equal(resolved.usedDefault, false);
});
test('drops duplicate CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER providers while preserving first surviving order', () => {
    const resolved = resolveAgentProviderFallbackOrder({
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'copilot,codex,copilot,lmstudio,codex',
    });
    assert.deepEqual(resolved.normalizedProviders, [
        'copilot',
        'codex',
        'lmstudio',
    ]);
    assert.equal(resolved.warnings.some((warning) => warning.includes('duplicate')), true);
});
test('ignores unknown fallback providers with warnings and falls back to the default order when none survive', () => {
    const resolved = resolveAgentProviderFallbackOrder({
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'unknown-one,unknown-two',
    });
    assert.deepEqual(resolved.normalizedProviders, ['codex', 'copilot']);
    assert.equal(resolved.usedDefault, true);
    assert.equal(resolved.warnings.some((warning) => warning.includes('unknown-one')), true);
    assert.equal(resolved.warnings.some((warning) => warning.includes('unknown-two')), true);
});
test('large-text threshold env resolves through startup env loading with default and invalid fallback', () => {
    const previousThreshold = process.env.CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES;
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', ['CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES=77777', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    assert.equal(targetEnv.CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES, '77777');
    assert.equal(resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    }).find((entry) => entry.name === 'CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES')?.source, 'server/.env');
    try {
        clearScopedTestEnvValue("CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES");
        assert.equal(resolveConfig().largeTextThresholdBytes, 65536);
        setScopedTestEnvValue("CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES", 'not-a-number');
        assert.equal(resolveConfig().largeTextThresholdBytes, 65536);
        setScopedTestEnvValue("CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES", '77777');
        assert.equal(resolveConfig().largeTextThresholdBytes, 77777);
    }
    finally {
        if (previousThreshold === undefined) {
            clearScopedTestEnvValue("CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES");
        }
        else {
            setScopedTestEnvValue("CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES", previousThreshold);
        }
    }
});
test('provider dispatch env vars load through the startup env whitelist', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {};
    writeEnvFile(serverRoot, '.env', [
        'CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE=24',
        'CODEINFO_INGEST_OPENAI_MAX_INFLIGHT=6',
        'CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE=1',
        'CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT=4',
        'CODEINFO_INGEST_MAX_QUEUE_SIZE=9',
        '',
    ].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    const resolutions = resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    });
    for (const name of [
        'CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE',
        'CODEINFO_INGEST_OPENAI_MAX_INFLIGHT',
        'CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE',
        'CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT',
        'CODEINFO_INGEST_MAX_QUEUE_SIZE',
    ] as const) {
        assertDefinedString(targetEnv[name]);
        assert.equal(resolutions.find((entry) => entry.name === name)?.source, 'server/.env');
    }
});
test('runtime pre-seeded renamed CODEINFO values override file defaults', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {
        CODEINFO_OPENAI_EMBEDDING_KEY: 'from-runtime',
        CODEINFO_CHAT_DEFAULT_PROVIDER: 'copilot',
    };
    writeEnvFile(serverRoot, '.env', [
        'CODEINFO_OPENAI_EMBEDDING_KEY=from-env',
        'CODEINFO_CHAT_DEFAULT_PROVIDER=codex',
        '',
    ].join('\n'));
    writeEnvFile(serverRoot, '.env.local', ['CODEINFO_CHAT_DEFAULT_PROVIDER=lmstudio', ''].join('\n'));
    const result = loadStartupEnv({ serverRoot, targetEnv });
    assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, 'from-runtime');
    assert.equal(targetEnv.CODEINFO_CHAT_DEFAULT_PROVIDER, 'copilot');
    assert.equal(result.valueSources.CODEINFO_OPENAI_EMBEDDING_KEY, 'preseeded');
    assert.equal(result.valueSources.CODEINFO_CHAT_DEFAULT_PROVIDER, 'preseeded');
});
test('required renamed CODEINFO key errors still fire when the key is missing', () => {
    assert.throws(() => createOpenAiEmbeddingProvider({ apiKey: undefined }), /CODEINFO_OPENAI_EMBEDDING_KEY/);
});
test('pre-cutover-only env values fail deterministically instead of silently succeeding', () => {
    const serverRoot = createServerRoot();
    const targetEnv: Record<string, string | undefined> = {
        [legacyServerEnv('OPENAI', 'EMBEDDING', 'KEY')]: 'legacy-only',
    };
    const result = loadStartupEnv({ serverRoot, targetEnv });
    assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, undefined);
    assert.equal(resolveOpenAiEmbeddingCapabilityState(targetEnv).enabled, false);
    assert.equal(resolveCodeinfoEnvResolutions({
        env: targetEnv,
        loadResult: result,
    }).find((entry) => entry.name === 'CODEINFO_OPENAI_EMBEDDING_KEY')?.source, 'absent');
    assert.throws(() => createOpenAiEmbeddingProvider({
        apiKey: targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY,
    }), /CODEINFO_OPENAI_EMBEDDING_KEY/);
});
test('checked-in defaults and wrappers seed only renamed CODEINFO server env names', () => {
    const files = [
        'server/.env',
        'server/.env.e2e',
        'docker-compose.yml',
        'docker-compose.local.yml',
        'docker-compose.e2e.yml',
        'scripts/test-summary-server-unit-env.mjs',
        'scripts/test-summary-server-cucumber.mjs',
        'server/package.json',
    ];
    const legacyNames = [
        legacyServerEnv('SERVER', 'PORT'),
        legacyServerEnv('MONGO', 'URI'),
        legacyServerEnv('CHROMA', 'URL'),
        legacyServerEnv('MCP', 'PORT'),
        legacyServerEnv('AGENTS', 'MCP', 'PORT'),
        legacyServerEnv('HOST', 'INGEST', 'DIR'),
        legacyServerEnv('OPENAI', 'INGEST', 'MAX', 'RETRIES'),
        legacyServerEnv('LMSTUDIO', 'BASE', 'URL'),
        legacyServerEnv('OPENAI', 'EMBEDDING', 'KEY'),
        legacyServerEnv('CHAT', 'DEFAULT', 'PROVIDER'),
        legacyServerEnv('CHAT', 'DEFAULT', 'MODEL'),
        legacyServerEnv('INGEST', 'INCLUDE'),
        legacyServerEnv('INGEST', 'EXCLUDE'),
        legacyServerEnv('INGEST', 'FLUSH', 'EVERY'),
        legacyServerEnv('INGEST', 'LARGE', 'TEXT', 'THRESHOLD', 'BYTES'),
        legacyServerEnv('INGEST', 'OPENAI', 'MAX', 'BATCH', 'SIZE'),
        legacyServerEnv('INGEST', 'OPENAI', 'MAX', 'INFLIGHT'),
        legacyServerEnv('INGEST', 'LMSTUDIO', 'MAX', 'BATCH', 'SIZE'),
        legacyServerEnv('INGEST', 'LMSTUDIO', 'MAX', 'INFLIGHT'),
        legacyServerEnv('INGEST', 'MAX', 'QUEUE', 'SIZE'),
        legacyServerEnv('INGEST', 'COLLECTION'),
        legacyServerEnv('INGEST', 'ROOTS', 'COLLECTION'),
        legacyServerEnv('INGEST', 'TEST', 'GIT', 'PATHS'),
        legacyServerEnv('LOG', 'FILE', 'PATH'),
        legacyServerEnv('LOG', 'LEVEL'),
        legacyServerEnv('LOG', 'BUFFER', 'MAX'),
        legacyServerEnv('LOG', 'MAX', 'CLIENT', 'BYTES'),
        legacyServerEnv('LOG', 'INGEST', 'WS', 'THROTTLE', 'MS'),
        legacyServerEnv('LOG', 'FILE', 'ROTATE'),
    ];
    for (const relativePath of files) {
        const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
        assert.match(text, /CODEINFO_/);
        for (const legacyName of legacyNames) {
            assert.equal(new RegExp(`\\b${legacyName}\\b`).test(text), false, `${relativePath} should not seed pre-cutover env ${legacyName}`);
        }
    }
});
