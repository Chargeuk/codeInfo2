type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type OpenAiFunctionTool = {
  type?: string;
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  strict?: unknown;
};

type OpenAiNamespaceTool = OpenAiFunctionTool & {
  type: 'namespace';
  tools?: unknown;
};

const isNamespaceTool = (value: unknown): value is OpenAiNamespaceTool =>
  isRecord(value) && value.type === 'namespace';

const cloneTool = (tool: JsonRecord): JsonRecord => ({ ...tool });

type NamespaceToolCallTarget = {
  name: string;
  namespace: string;
};

const FLATTENED_NAMESPACE_TOOL_PREFIX = 'codexns_';

const encodeFlattenedNamespaceToolName = (
  namespaceName: string,
  nestedName: string,
) =>
  `${FLATTENED_NAMESPACE_TOOL_PREFIX}${Buffer.from(namespaceName, 'utf8').toString('base64url')}_${Buffer.from(nestedName, 'utf8').toString('base64url')}`;

export type CodexFlattenedNamespaceToolMap = Record<
  string,
  NamespaceToolCallTarget
>;

export type FlattenedCodexToolPayload = {
  bodyText: string | undefined;
  namespaceToolCallMap: CodexFlattenedNamespaceToolMap;
};

const flattenNamespaceTool = (
  tool: OpenAiNamespaceTool,
): {
  flattenedTools: JsonRecord[];
  namespaceToolCallMap: CodexFlattenedNamespaceToolMap;
} => {
  const namespaceName =
    typeof tool.name === 'string' && tool.name.length > 0 ? tool.name : null;
  const nestedTools = Array.isArray(tool.tools) ? tool.tools : [];
  if (!namespaceName || nestedTools.length === 0) {
    return {
      flattenedTools: [],
      namespaceToolCallMap: {},
    };
  }

  const flattenedTools: JsonRecord[] = [];
  const namespaceToolCallMap: CodexFlattenedNamespaceToolMap = {};
  for (const nestedTool of nestedTools) {
    if (!isRecord(nestedTool)) continue;
    const nestedName =
      typeof nestedTool.name === 'string' && nestedTool.name.length > 0
        ? nestedTool.name
        : null;
    if (!nestedName) continue;
    const flattenedName = encodeFlattenedNamespaceToolName(
      namespaceName,
      nestedName,
    );
    flattenedTools.push({
      ...cloneTool(nestedTool),
      type: 'function',
      name: flattenedName,
    });
    namespaceToolCallMap[flattenedName] = {
      namespace: namespaceName,
      name: nestedName,
    };
  }

  return {
    flattenedTools,
    namespaceToolCallMap,
  };
};

export function flattenCodexNamespaceToolsForCustomProvider(
  rawBodyText: string | undefined,
): FlattenedCodexToolPayload {
  if (!rawBodyText) {
    return {
      bodyText: rawBodyText,
      namespaceToolCallMap: {},
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBodyText);
  } catch {
    return {
      bodyText: rawBodyText,
      namespaceToolCallMap: {},
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) {
    return {
      bodyText: rawBodyText,
      namespaceToolCallMap: {},
    };
  }

  let changed = false;
  const namespaceToolCallMap: CodexFlattenedNamespaceToolMap = {};
  const flattenedTools = parsed.tools.flatMap((tool) => {
    if (isNamespaceTool(tool)) {
      changed = true;
      const flattenedNamespaceTool = flattenNamespaceTool(tool);
      Object.assign(
        namespaceToolCallMap,
        flattenedNamespaceTool.namespaceToolCallMap,
      );
      return flattenedNamespaceTool.flattenedTools;
    }
    if (isRecord(tool)) {
      return [cloneTool(tool)];
    }
    return [tool];
  });

  if (!changed) {
    return {
      bodyText: rawBodyText,
      namespaceToolCallMap: {},
    };
  }

  return {
    bodyText: JSON.stringify({
      ...parsed,
      tools: flattenedTools,
    }),
    namespaceToolCallMap,
  };
}

export function restoreCodexNamespaceToolCallsFromCustomProviderResponse(
  rawBodyText: string,
  namespaceToolCallMap: CodexFlattenedNamespaceToolMap,
): string {
  if (Object.keys(namespaceToolCallMap).length === 0) return rawBodyText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBodyText);
  } catch {
    return rawBodyText;
  }

  let changed = false;
  const rewriteValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => rewriteValue(entry));
    }
    if (!isRecord(value)) {
      return value;
    }

    const next: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = rewriteValue(entry);
    }

    if (next.type !== 'function_call' || typeof next.name !== 'string') {
      return next;
    }

    const namespaceTarget = namespaceToolCallMap[next.name];
    if (!namespaceTarget) {
      return next;
    }

    changed = true;
    return {
      ...next,
      name: namespaceTarget.name,
      namespace: namespaceTarget.namespace,
    };
  };

  const rewritten = rewriteValue(parsed);

  if (!changed) return rawBodyText;

  return JSON.stringify(rewritten);
}
