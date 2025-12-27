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
  it('renders mermaid diagrams and strips script tags', async () => {
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

    render(<Markdown content={markdown} data-testid="assistant-markdown" />);

    const markdownBox = await screen.findByTestId('assistant-markdown');

    await waitFor(() => {
      const svg = markdownBox.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    const script = markdownBox.querySelector('script');
    expect(script).toBeNull();
  });
});

