import { render, screen, waitFor, within } from '@testing-library/react';
import UserTranscriptBubble from './UserTranscriptBubble';
import { installTranscriptMeasurementHarness } from '../../test/support/transcriptMeasurementHarness';

const log = () => undefined;

describe('UserTranscriptBubble', () => {
  it('renders a dark right-aligned user bubble with the required footer controls', () => {
    render(
      <UserTranscriptBubble
        message={{
          id: 'user-1',
          role: 'user',
          content: 'User message.',
          optimistic: false,
          createdAt: '2026-05-23T10:21:00.000Z',
        }}
        log={log}
      />,
    );

    const bubble = screen.getByTestId('chat-bubble');
    const surface = within(bubble).getByTestId('user-transcript-bubble');
    const footer = within(bubble).getByTestId('user-transcript-footer');
    const completionTime = within(bubble).getByTestId('bubble-completion-time');
    const copyButton = within(bubble).getByTestId('bubble-copy');

    expect(window.getComputedStyle(surface).backgroundColor).toBe(
      'rgb(17, 24, 39)',
    );
    expect(window.getComputedStyle(surface).color).toBe('rgb(255, 255, 255)');
    expect(surface).toHaveStyle({ width: 'fit-content' });

    expect(within(bubble).queryByTestId('bubble-info')).toBeNull();
    expect(window.getComputedStyle(footer).flexWrap).toBe('nowrap');
    expect(within(footer).getAllByRole('img').length).toBeGreaterThan(0);
    expect(completionTime).toHaveTextContent(/\d+h ago|10:21 AM|May 23, 2026/i);
    expect(copyButton).toHaveTextContent('Copy');
  });

  it('switches to an inline footer when the rendered user message fits on one line', async () => {
    const harness = installTranscriptMeasurementHarness();
    render(
      <UserTranscriptBubble
        message={{
          id: 'user-inline',
          role: 'user',
          content: 'Short note',
          optimistic: false,
          createdAt: '2026-05-23T10:21:00.000Z',
        }}
        log={log}
      />,
    );

    const surface = screen.getByTestId('user-transcript-bubble');
    const content = screen.getByTestId('user-transcript-content');
    const footer = screen.getByTestId('user-transcript-footer');

    harness.setElementRect(surface.parentElement, { width: 400, height: 48 });
    harness.setElementRect(surface, { width: 220, height: 48 });
    harness.setElementRect(content, { width: 90, height: 18 });
    Object.defineProperty(content, 'scrollWidth', {
      configurable: true,
      value: 90,
    });
    Object.defineProperty(footer, 'scrollWidth', {
      configurable: true,
      value: 120,
    });
    harness.triggerResize(surface);
    harness.triggerResize(content);
    harness.triggerResize(footer);

    await waitFor(() =>
      expect(surface).toHaveAttribute('data-footer-layout', 'inline'),
    );

    harness.restore();
  });

  it('keeps the footer stacked when the rendered user message wraps beyond one line', async () => {
    const harness = installTranscriptMeasurementHarness();
    render(
      <UserTranscriptBubble
        message={{
          id: 'user-stacked',
          role: 'user',
          content:
            'This is a longer user message that needs to wrap onto multiple lines.',
          optimistic: false,
          createdAt: '2026-05-23T10:21:00.000Z',
        }}
        log={log}
      />,
    );

    const surface = screen.getByTestId('user-transcript-bubble');
    const content = screen.getByTestId('user-transcript-content');
    const footer = screen.getByTestId('user-transcript-footer');

    harness.setElementRect(surface.parentElement, { width: 400, height: 88 });
    harness.setElementRect(surface, { width: 420, height: 88 });
    harness.setElementRect(content, { width: 260, height: 48 });
    Object.defineProperty(content, 'scrollWidth', {
      configurable: true,
      value: 260,
    });
    Object.defineProperty(footer, 'scrollWidth', {
      configurable: true,
      value: 160,
    });
    harness.triggerResize(surface);
    harness.triggerResize(content);
    harness.triggerResize(footer);

    await waitFor(() =>
      expect(surface).toHaveAttribute('data-footer-layout', 'stacked'),
    );

    harness.restore();
  });
});
