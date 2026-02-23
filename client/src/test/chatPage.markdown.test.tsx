import { render, screen, waitFor, within } from '@testing-library/react';
import Markdown from '../components/Markdown';

describe('Chat markdown rendering', () => {
  it('renders equivalent list and code markdown for assistant and user bubbles', async () => {
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

    render(
      <>
        <Markdown content={markdown} data-testid="assistant-markdown" />
        <Markdown content={markdown} data-testid="user-markdown" />
      </>,
    );

    const assistantMarkdown = await screen.findByTestId('assistant-markdown');
    const userMarkdown = await screen.findByTestId('user-markdown');

    await waitFor(() =>
      expect(assistantMarkdown.textContent ?? '').toContain(
        'Inline code sample.',
      ),
    );
    await waitFor(() =>
      expect(userMarkdown.textContent ?? '').toContain('Inline code sample.'),
    );

    const assistantCode = assistantMarkdown.querySelector('pre code');
    const userCode = userMarkdown.querySelector('pre code');
    expect(assistantCode?.textContent ?? '').toContain('const answer = 42;');
    expect(userCode?.textContent ?? '').toContain('const answer = 42;');

    await waitFor(() => {
      const assistantItems = within(assistantMarkdown).getAllByRole('listitem');
      const userItems = within(userMarkdown).getAllByRole('listitem');
      expect(assistantItems.map((item) => item.textContent)).toEqual([
        'first item',
        'second item',
      ]);
      expect(userItems.map((item) => item.textContent)).toEqual([
        'first item',
        'second item',
      ]);
    });
  });

  it('applies equivalent sanitization behavior for assistant and user bubbles', async () => {
    const markdown = [
      'Unsafe payload should not execute:',
      "<script>alert('x')</script>",
      '',
      '<div>safe wrapper</div>',
    ].join('\n');

    render(
      <>
        <Markdown content={markdown} data-testid="assistant-markdown" />
        <Markdown content={markdown} data-testid="user-markdown" />
      </>,
    );

    const assistantMarkdown = await screen.findByTestId('assistant-markdown');
    const userMarkdown = await screen.findByTestId('user-markdown');

    await waitFor(() => {
      expect(assistantMarkdown.querySelector('script')).toBeNull();
      expect(userMarkdown.querySelector('script')).toBeNull();
    });

    await waitFor(() => {
      expect(assistantMarkdown.textContent ?? '').toContain('safe wrapper');
      expect(userMarkdown.textContent ?? '').toContain('safe wrapper');
    });

    await waitFor(() => {
      const assistantItems =
        within(assistantMarkdown).queryAllByRole('listitem');
      const userItems = within(userMarkdown).queryAllByRole('listitem');
      expect(assistantItems).toHaveLength(0);
      expect(userItems).toHaveLength(0);
    });
  });
});
