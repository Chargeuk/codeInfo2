#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { encoding_for_model, get_encoding } from 'tiktoken';

const DEFAULT_MODEL = 'gpt-4o';

function printUsage() {
  console.log(`Usage:
  node ./server/scripts/count-tool-tokens.mjs --input <payload.json> [--model <model>]
  node ./server/scripts/count-tool-tokens.mjs --input <payload.json> [--encoding <encoding>]
  cat payload.json | node ./server/scripts/count-tool-tokens.mjs --stdin [--json]

Options:
  --input <path>       Read the payload JSON from a file.
  --stdin              Read the payload JSON from stdin.
  --model <name>       Tokenizer model for encoding_for_model(). Default: ${DEFAULT_MODEL}
  --encoding <name>    Explicit encoding override, e.g. cl100k_base or o200k_base.
  --json               Emit machine-readable JSON instead of a text report.
  --help               Show this help text.

Accepted JSON shapes:
  - [tool, tool, ...]
  - { "tools": [...] }
  - { "functions": [...] }
  - { "functionDeclarations": [...] }`);
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    readFromStdin: false,
    model: DEFAULT_MODEL,
    encoding: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--stdin') {
      options.readFromStdin = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--input') {
      options.inputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      options.model = argv[index + 1] ?? DEFAULT_MODEL;
      index += 1;
      continue;
    }
    if (arg === '--encoding') {
      options.encoding = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }
  return chunks.join('');
}

function extractTools(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.tools)) {
      return payload.tools;
    }
    if (Array.isArray(payload.functions)) {
      return payload.functions;
    }
    if (Array.isArray(payload.functionDeclarations)) {
      return payload.functionDeclarations;
    }
  }

  throw new Error(
    'Unsupported payload shape. Expected an array or an object containing tools, functions, or functionDeclarations.',
  );
}

function getToolName(tool, index) {
  const candidates = [
    tool?.name,
    tool?.function?.name,
    tool?.recipient_name,
    tool?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return `tool_${index + 1}`;
}

function splitTransport(name) {
  const dotIndex = name.indexOf('.');
  if (dotIndex === -1) {
    return { transport: 'unscoped', localName: name };
  }

  return {
    transport: name.slice(0, dotIndex),
    localName: name.slice(dotIndex + 1),
  };
}

function inferNamespace(localName) {
  if (localName.includes('__')) {
    const parts = localName.split('__');
    if (parts.length > 1) {
      return parts.slice(0, -1).join('__');
    }
  }

  if (localName.includes('.')) {
    return localName.slice(0, localName.lastIndexOf('.'));
  }

  if (localName.includes('/')) {
    return localName.slice(0, localName.lastIndexOf('/'));
  }

  return localName;
}

function serialize(value) {
  return JSON.stringify(value);
}

function createCounter({ model, encoding }) {
  const tokenizer = encoding
    ? get_encoding(encoding)
    : encoding_for_model(model);

  return {
    count(value) {
      return tokenizer.encode(value).length;
    },
    free() {
      tokenizer.free();
    },
    encodingName:
      encoding ??
      (typeof tokenizer.name === 'string' && tokenizer.name
        ? tokenizer.name
        : 'model-selected'),
  };
}

function increment(map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortDescending(entries) {
  return [...entries].sort((left, right) => right[1] - left[1]);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function buildTextReport(report) {
  const lines = [];
  lines.push(`Input: ${report.inputLabel}`);
  lines.push(`Model: ${report.model}`);
  lines.push(`Encoding: ${report.encoding}`);
  lines.push(`Tool count: ${formatNumber(report.toolCount)}`);
  lines.push(
    `Raw input text tokens: ${formatNumber(report.rawInputTextTokens)}`,
  );
  lines.push(
    `Normalized payload tokens: ${formatNumber(report.normalizedPayloadTokens)}`,
  );
  lines.push(`Summed per-tool tokens: ${formatNumber(report.sumOfToolTokens)}`);
  lines.push(
    `Outer payload overhead: ${formatNumber(report.outerPayloadOverhead)}`,
  );
  lines.push('');
  lines.push('By transport:');
  for (const [name, tokens] of report.byTransport) {
    lines.push(`  ${name}: ${formatNumber(tokens)}`);
  }
  lines.push('');
  lines.push('By namespace:');
  for (const [name, tokens] of report.byNamespace.slice(0, 20)) {
    lines.push(`  ${name}: ${formatNumber(tokens)}`);
  }
  if (report.byNamespace.length > 20) {
    lines.push(
      `  ... ${formatNumber(report.byNamespace.length - 20)} more namespace entries`,
    );
  }
  lines.push('');
  lines.push('Top tools:');
  for (const tool of report.tools.slice(0, 25)) {
    lines.push(
      `  ${tool.name}: ${formatNumber(tool.tokens)} (${tool.transport} / ${tool.namespace})`,
    );
  }
  if (report.tools.length > 25) {
    lines.push(`  ... ${formatNumber(report.tools.length - 25)} more tools`);
  }
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.readFromStdin && !options.inputPath) {
    throw new Error('Pass --input <path> or --stdin.');
  }

  const inputText = options.readFromStdin
    ? await readAllStdin()
    : await fs.readFile(options.inputPath, 'utf8');
  const payload = JSON.parse(inputText);
  const tools = extractTools(payload);

  const counter = createCounter({
    model: options.model,
    encoding: options.encoding,
  });

  try {
    const rawInputTextTokens = counter.count(inputText);
    const normalizedPayload = serialize(payload);
    const normalizedPayloadTokens = counter.count(normalizedPayload);

    const byTransport = new Map();
    const byNamespace = new Map();
    const toolReports = tools.map((tool, index) => {
      const name = getToolName(tool, index);
      const { transport, localName } = splitTransport(name);
      const namespace = inferNamespace(localName);
      const toolTokens = counter.count(serialize(tool));

      increment(byTransport, transport, toolTokens);
      increment(byNamespace, namespace, toolTokens);

      return {
        index,
        name,
        transport,
        namespace,
        tokens: toolTokens,
      };
    });

    toolReports.sort((left, right) => right.tokens - left.tokens);
    const sumOfToolTokens = toolReports.reduce(
      (sum, tool) => sum + tool.tokens,
      0,
    );

    const report = {
      inputLabel: options.readFromStdin
        ? 'stdin'
        : path.resolve(options.inputPath),
      model: options.model,
      encoding: counter.encodingName,
      toolCount: tools.length,
      rawInputTextTokens,
      normalizedPayloadTokens,
      sumOfToolTokens,
      outerPayloadOverhead: normalizedPayloadTokens - sumOfToolTokens,
      byTransport: sortDescending(byTransport.entries()),
      byNamespace: sortDescending(byNamespace.entries()),
      tools: toolReports,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(buildTextReport(report));
  } finally {
    counter.free();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
