import { render, screen, within } from '@testing-library/react';
import UserTranscriptBubble from './UserTranscriptBubble';

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
    expect(window.getComputedStyle(surface).maxWidth).not.toBe('100%');

    expect(within(bubble).queryByTestId('bubble-info')).toBeNull();
    expect(window.getComputedStyle(footer).flexWrap).toBe('nowrap');
    expect(within(footer).getAllByRole('img').length).toBeGreaterThan(0);
    expect(completionTime).toHaveTextContent(/\d+h ago|10:21 AM|May 23, 2026/i);
    expect(copyButton).toHaveTextContent('Copy');
  });
});
