import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import DirectoryPickerDialog from './DirectoryPickerDialog';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('DirectoryPickerDialog', () => {
  it('wraps long current and child paths instead of clipping them', async () => {
    mockFetch.mockImplementation(() =>
      mockJsonResponse({
        base: '/Users/danielstapleton/Documents/dev/codeinfo2',
        path: '/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/components/workspace',
        dirs: ['composer', 'mobile-layout-contracts-and-very-long-paths'],
      }),
    );

    render(
      <DirectoryPickerDialog
        open
        path="/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/components/workspace"
        onClose={() => undefined}
        onPick={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('directory-picker-current-path')).toHaveTextContent(
        '/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/components/workspace',
      ),
    );

    expect(screen.getByTestId('directory-picker-base-path')).toHaveStyle({
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    });
    expect(screen.getByTestId('directory-picker-current-path')).toHaveStyle({
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    });

    const childPaths = await screen.findAllByTestId(
      'directory-picker-child-path',
    );
    childPaths.forEach((childPath) => {
      expect(childPath).toHaveStyle({
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      });
    });
  });
});
