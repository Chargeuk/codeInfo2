import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
  },
];

const EXECUTE_PROMPT_INSTRUCTION_TEMPLATE =
  'Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>';

function okJson(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: (() => {
      const headers = new Headers();
      headers.append('content-type', 'application/json');
      return headers;
    })(),
    json: async () => payload,
  } as Response);
}

function setupExecutePromptFetch(params?: {
  agents?: Array<{ name: string }>;
  runResponse?:
    | { status: 202; payload?: Record<string, unknown> }
    | { status: number; payload: Record<string, unknown> };
  prompt?: { relativePath: string; fullPath: string };
  promptsByAgent?: Record<
    string,
    Array<{ relativePath: string; fullPath: string }>
  >;
}) {
  const runBodies: Record<string, unknown>[] = [];
  const runUrls: string[] = [];
  const commandRunUrls: string[] = [];

  const prompt =
    params?.prompt ??
    ({
      relativePath: 'onboarding/start.md',
      fullPath: '/workspace/.github/prompts/onboarding/start.md',
    } as const);

  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();
    const promptsMatch = target.match(/\/agents\/([^/]+)\/prompts(?:\?|$)/);
    const commandRunMatch = target.match(
      /\/agents\/([^/]+)\/commands\/run(?:\?|$)/,
    );
    const runMatch = target.match(/\/agents\/([^/]+)\/run(?:\?|$)/);

    if (target.includes('/health')) return okJson({ mongoConnected: true });
    if (
      target.includes('/agents') &&
      !target.includes('/commands') &&
      !target.includes('/run') &&
      !target.includes('/prompts')
    ) {
      return okJson({ agents: params?.agents ?? [{ name: 'coding_agent' }] });
    }
    if (/\/agents\/[^/]+\/commands(?:\?|$)/.test(target)) {
      return okJson({ commands: [] });
    }
    if (target.includes('/conversations')) return okJson({ items: [] });
    if (promptsMatch) {
      const agentName = promptsMatch[1];
      const prompts = params?.promptsByAgent?.[agentName] ?? [prompt];
      return okJson({ prompts });
    }
    if (commandRunMatch) {
      commandRunUrls.push(target);
      return okJson({ status: 'started' });
    }
    if (runMatch) {
      runUrls.push(target);
      if (init?.body) {
        runBodies.push(JSON.parse(init.body.toString()));
      }
      if (params?.runResponse && params.runResponse.status !== 202) {
        return Promise.resolve({
          ok: false,
          status: params.runResponse.status,
          headers: { get: () => 'application/json' },
          json: async () => params.runResponse?.payload ?? {},
        } as Response);
      }
      return okJson(
        {
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i1',
          modelId: 'gpt-5.3-codex',
          ...(params?.runResponse?.payload ?? {}),
        },
        { status: 202 },
      );
    }
    return okJson({});
  });

  return { runBodies, runUrls, commandRunUrls, prompt };
}

async function mountAgentsPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
  render(<RouterProvider router={router} />);

  await waitFor(() => {
    const registry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { readyState: number } | null };
      }
    ).__wsMock;
    expect(registry?.last()?.readyState).toBe(1);
  });

  await screen.findByRole('combobox', { name: /agent/i });
}

async function commitWorkingFolderByBlur(value: string) {
  const workingFolder = (await screen.findByTestId(
    'agent-working-folder',
  )) as HTMLInputElement;
  fireEvent.change(workingFolder, { target: { value } });
  fireEvent.blur(workingFolder);
}

async function selectPrompt(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  const promptsSelect = await screen.findByRole('combobox', {
    name: /prompts/i,
  });
  await user.click(promptsSelect);
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('Agents page - execute prompt', () => {
  it('sends exact canonical preamble with selected fullPath replacement only', async () => {
    const user = userEvent.setup();
    const { runBodies, prompt } = setupExecutePromptFetch();
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace');
    await selectPrompt(user, prompt.relativePath);

    await user.click(await screen.findByTestId('agent-prompt-execute'));

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toMatchObject({
      instruction: EXECUTE_PROMPT_INSTRUCTION_TEMPLATE.replace(
        '<full path of markdown file>',
        prompt.fullPath,
      ),
    });
  });

  it('injects runtime fullPath (not relativePath) into execute-prompt instruction', async () => {
    const user = userEvent.setup();
    const { runBodies, prompt } = setupExecutePromptFetch({
      prompt: {
        relativePath: 'persona/start.md',
        fullPath: '/runtime/agents/.github/prompts/persona/start.md',
      },
    });
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/runtime/agents');
    await selectPrompt(user, prompt.relativePath);
    await user.click(await screen.findByTestId('agent-prompt-execute'));

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(String(runBodies[0].instruction)).toContain(prompt.fullPath);
    expect(String(runBodies[0].instruction)).not.toContain(
      `Here is the file: ${prompt.relativePath}`,
    );
  });

  it('forwards committed working_folder in execute-prompt run payload', async () => {
    const user = userEvent.setup();
    const { runBodies, prompt } = setupExecutePromptFetch();
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace/committed-folder');
    await selectPrompt(user, prompt.relativePath);
    await user.click(await screen.findByTestId('agent-prompt-execute'));

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toHaveProperty(
      'working_folder',
      '/workspace/committed-folder',
    );
  });

  it('keeps Execute Prompt disabled until a valid prompt is selected', async () => {
    const user = userEvent.setup();
    const { prompt } = setupExecutePromptFetch();
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace');
    const executePromptButton = await screen.findByTestId(
      'agent-prompt-execute',
    );
    expect(executePromptButton).toBeDisabled();

    await selectPrompt(user, prompt.relativePath);
    expect(executePromptButton).toBeEnabled();
  });

  it('surfaces RUN_IN_PROGRESS conflict UX for execute-prompt path', async () => {
    const user = userEvent.setup();
    const { prompt } = setupExecutePromptFetch({
      runResponse: {
        status: 409,
        payload: {
          error: 'conflict',
          code: 'RUN_IN_PROGRESS',
          message: 'busy',
        },
      },
    });
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace');
    await selectPrompt(user, prompt.relativePath);
    await user.click(await screen.findByTestId('agent-prompt-execute'));

    const banner = await screen.findByTestId('agents-run-error');
    expect(banner).toHaveTextContent(
      /This conversation already has a run in progress in another tab\/window/i,
    );
  });

  it('surfaces generic execute-prompt error when prompt file is moved/deleted before run', async () => {
    const user = userEvent.setup();
    const { prompt } = setupExecutePromptFetch({
      runResponse: {
        status: 404,
        payload: {
          error: 'not_found',
          code: 'PROMPT_FILE_NOT_FOUND',
          message: 'Prompt file no longer exists',
        },
      },
    });
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace');
    await selectPrompt(user, prompt.relativePath);
    await user.click(await screen.findByTestId('agent-prompt-execute'));

    const banner = await screen.findByTestId('agents-run-error');
    expect(banner).toHaveTextContent('Prompt file no longer exists');
  });

  it('uses instruction run endpoint for execute prompt and never command-run endpoint', async () => {
    const user = userEvent.setup();
    const { runUrls, commandRunUrls, prompt } = setupExecutePromptFetch();
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace');
    await selectPrompt(user, prompt.relativePath);
    await user.click(await screen.findByTestId('agent-prompt-execute'));

    await waitFor(() => expect(runUrls.length).toBe(1));
    expect(commandRunUrls).toHaveLength(0);
  });

  it('clears execute-prompt context when agent changes and requires re-selection', async () => {
    const user = userEvent.setup();
    setupExecutePromptFetch({
      agents: [{ name: 'coding_agent' }, { name: 'review_agent' }],
      promptsByAgent: {
        coding_agent: [
          {
            relativePath: 'coding/start.md',
            fullPath: '/workspace/coding/start.md',
          },
        ],
        review_agent: [
          {
            relativePath: 'review/start.md',
            fullPath: '/workspace/review/start.md',
          },
        ],
      },
    });
    await mountAgentsPage();

    await commitWorkingFolderByBlur('/workspace/coding');
    await selectPrompt(user, 'coding/start.md');
    expect(await screen.findByTestId('agent-prompt-execute')).toBeEnabled();

    const agentSelect = await screen.findByRole('combobox', { name: /agent/i });
    await user.click(agentSelect);
    await user.click(
      await screen.findByRole('option', { name: 'review_agent' }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId('agent-prompts-row')).not.toBeInTheDocument(),
    );

    await commitWorkingFolderByBlur('/workspace/review');
    const executeButton = await screen.findByTestId('agent-prompt-execute');
    expect(
      await screen.findByRole('combobox', { name: /prompts/i }),
    ).toHaveTextContent('No prompt selected');
    expect(executeButton).toBeDisabled();
  });
});
