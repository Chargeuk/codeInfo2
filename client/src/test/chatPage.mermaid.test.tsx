import { render, screen, waitFor } from '@testing-library/react';
import Markdown from '../components/Markdown';

beforeAll(() => {
  if (!('getBBox' in SVGElement.prototype)) {
    // @ts-expect-error jsdom SVGElement shim for mermaid layout
    SVGElement.prototype.getBBox = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  }
});

describe('Chat mermaid rendering', () => {
  it('renders equivalent mermaid diagrams and script stripping for assistant and user bubbles', async () => {
    const markdown = [
      'Here is a diagram:',
      '```mermaid',
      'graph TD',
      '  A[Start] --> B{Choice}',
      '  B -->|Yes| C[Render diagram]',
      '  B -->|No| D[Stop]',
      "  %% <script>alert('x')</script> should be stripped",
      '  D --> E[Done]',
      '```',
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
      expect(assistantMarkdown.querySelector('svg')).toBeTruthy();
      expect(userMarkdown.querySelector('svg')).toBeTruthy();
    });

    expect(assistantMarkdown.querySelector('script')).toBeNull();
    expect(userMarkdown.querySelector('script')).toBeNull();
  });

  it('shows equivalent safe fallback for malformed mermaid in assistant and user bubbles', async () => {
    const malformedMermaid = [
      '```mermaid',
      'this is not valid mermaid syntax',
      '```',
    ].join('\n');

    render(
      <>
        <Markdown content={malformedMermaid} data-testid="assistant-markdown" />
        <Markdown content={malformedMermaid} data-testid="user-markdown" />
      </>,
    );

    const assistantMarkdown = await screen.findByTestId('assistant-markdown');
    const userMarkdown = await screen.findByTestId('user-markdown');

    await waitFor(() => {
      expect(assistantMarkdown).toHaveTextContent('Diagram failed to render');
      expect(userMarkdown).toHaveTextContent('Diagram failed to render');
    });
  });
});
