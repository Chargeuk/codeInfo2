import { render, screen, waitFor, within } from '@testing-library/react';
import Markdown from '../components/Markdown';

describe('Chat markdown rendering', () => {
  it('renders lists and code blocks without escaping content', async () => {
    const markdown = [
      'Here is a list:',
      '- first item',
      '- second item',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      'Inline `code` sample.',
    ].join('\n');

    render(<Markdown content={markdown} data-testid="assistant-markdown" />);

    const markdownBox = await screen.findByTestId('assistant-markdown');

    await waitFor(() =>
      expect(markdownBox.textContent ?? '').toContain('Inline code sample.'),
    );

    const codeBlock = markdownBox.querySelector('pre code');
    expect(codeBlock?.textContent ?? '').toContain('const answer = 42;');

    await waitFor(() => {
      const items = within(markdownBox).getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'first item',
        'second item',
      ]);
    });
  });
});

