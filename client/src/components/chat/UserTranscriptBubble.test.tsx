import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ChatMessage } from '../../hooks/useChatStream';
import { installTranscriptMeasurementHarness } from '../../test/support/transcriptMeasurementHarness';
import UserTranscriptBubble from './UserTranscriptBubble';

const log = () => undefined;

describe('UserTranscriptBubble', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-23T10:22:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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

    expect(within(bubble).getByTestId('bubble-info')).toHaveTextContent('Info');
    expect(window.getComputedStyle(footer).flexWrap).toBe('nowrap');
    expect(within(footer).getAllByRole('img').length).toBeGreaterThan(0);
    expect(completionTime).toHaveTextContent(
      /\d+h ago|1m ago|10:21 AM|May 23, 2026/i,
    );
    expect(copyButton).toHaveTextContent('Copy');
  });

  it('refreshes visible relative footer timestamps on the shared interval', async () => {
    render(
      <UserTranscriptBubble
        message={{
          id: 'user-refresh',
          role: 'user',
          content: 'Recently sent.',
          optimistic: false,
          createdAt: '2026-05-23T10:21:01.000Z',
        }}
        log={log}
      />,
    );

    expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
      '59s ago',
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
      '1m ago',
    );
  });

  it('crosses the 90-minute boundary on the existing shared tick', () => {
    const createdAt = '2026-05-23T08:52:01.000Z';
    render(
      <UserTranscriptBubble
        message={{ id: 'boundary', role: 'user', content: 'Hello', createdAt }}
        log={log}
      />,
    );
    expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
      '1h ago',
    );

    act(() => jest.advanceTimersByTime(30_000));

    expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(createdAt)),
    );
  });

  it('opens exact Info for an ordinary user and preserves additional metadata', async () => {
    const createdAt = '2026-05-23T10:21:37.000Z';
    render(
      <UserTranscriptBubble
        message={{ id: 'ordinary', role: 'user', content: 'Hello', createdAt }}
        log={log}
        renderMetadataContent={() => <span>Existing flow ancestry</span>}
      />,
    );
    expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
      '23s ago',
    );

    const infoButton = screen.getByRole('button', {
      name: 'Show message details',
    });
    expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {
      fireEvent.click(infoButton);
    });

    const popover = await screen.findByTestId('bubble-info-popover');
    expect(infoButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(popover).getByTestId('bubble-info-time')).toHaveTextContent(
      `Time: ${new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(createdAt))}`,
    );
    expect(within(popover).getByText('Existing flow ancestry')).toBeVisible();
    expect(
      within(popover).queryByTestId('bubble-info-first-update'),
    ).toBeNull();
    expect(within(popover).queryByTestId('bubble-info-last-update')).toBeNull();
    expect(screen.getByTestId('bubble-copy')).toBeEnabled();
  });

  it.each([undefined, 'invalid-date'])(
    'does not invent user metadata for an unavailable legacy date: %s',
    (createdAt) => {
      render(
        <UserTranscriptBubble
          message={{ id: 'legacy', role: 'user', content: 'Hello', createdAt }}
          log={log}
        />,
      );
      expect(screen.queryByTestId('bubble-info')).toBeNull();
      expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
        '—',
      );
    },
  );

  it('keeps actual user metadata available even when the creation date is missing', async () => {
    render(
      <UserTranscriptBubble
        message={{
          id: 'legacy-with-metadata',
          role: 'user',
          content: 'Hello',
          model: 'gpt-5',
        }}
        log={log}
      />,
    );

    const infoButton = screen.getByRole('button', {
      name: 'Show message details',
    });
    await act(async () => {
      fireEvent.click(infoButton);
    });

    const popover = await screen.findByTestId('bubble-info-popover');
    expect(infoButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(popover).getByTestId('bubble-info-model')).toHaveTextContent(
      'Model: gpt-5',
    );
    expect(within(popover).queryByTestId('bubble-info-time')).toBeNull();
  });

  it.each<{
    deliveryStatus: ChatMessage['deliveryStatus'];
    optimistic?: boolean;
    expectedStatus: string;
    color: string;
  }>([
    {
      deliveryStatus: 'requested',
      optimistic: false,
      expectedStatus: 'requested',
      color: 'rgb(215, 222, 231)',
    },
    {
      deliveryStatus: 'dispatched',
      optimistic: false,
      expectedStatus: 'dispatched',
      color: 'rgb(215, 222, 231)',
    },
    {
      deliveryStatus: 'acknowledged',
      optimistic: true,
      expectedStatus: 'acknowledged',
      color: 'rgb(47, 128, 237)',
    },
    {
      deliveryStatus: undefined,
      expectedStatus: 'acknowledged',
      color: 'rgb(47, 128, 237)',
    },
    {
      deliveryStatus: undefined,
      optimistic: true,
      expectedStatus: 'dispatched',
      color: 'rgb(215, 222, 231)',
    },
  ])(
    'renders delivery $expectedStatus for explicit=$deliveryStatus optimistic=$optimistic',
    ({ deliveryStatus, optimistic, expectedStatus, color }) => {
      render(
        <UserTranscriptBubble
          message={{
            id: 'delivery',
            role: 'user',
            content: 'Hello',
            deliveryStatus,
            optimistic,
          }}
          log={log}
        />,
      );
      const tick = screen.getByRole('img', {
        name: `Message ${expectedStatus}`,
      });
      expect(tick).toHaveAttribute('data-delivery-status', expectedStatus);
      expect(window.getComputedStyle(tick).color).toBe(color);
    },
  );

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
