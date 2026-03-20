import { render, screen } from '@testing-library/react';
import { createElement, useEffect, useRef, useState } from 'react';
import {
  installTranscriptMeasurementHarness,
  TranscriptMeasurementHarnessError,
} from './support/transcriptMeasurementHarness';

function MeasurementProbe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (
      !containerRef.current ||
      !rowRef.current ||
      !globalThis.ResizeObserver
    ) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setEvents(
        entries.map((entry) => (entry.target as HTMLElement).dataset.id ?? ''),
      );
    });
    observer.observe(containerRef.current);
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);

  return createElement(
    'div',
    null,
    createElement(
      'div',
      {
        ref: containerRef,
        'data-id': 'container',
        'data-testid': 'probe-container',
      },
      createElement(
        'div',
        {
          ref: rowRef,
          'data-id': 'row',
          'data-testid': 'probe-row',
        },
        'row',
      ),
    ),
    createElement(
      'output',
      { 'data-testid': 'probe-events' },
      events.join(','),
    ),
  );
}

describe('transcriptMeasurementHarness', () => {
  it('drives transcript-style resize callbacks through an explicit helper import', () => {
    const harness = installTranscriptMeasurementHarness();
    render(createElement(MeasurementProbe));

    const container = screen.getByTestId('probe-container');
    const row = screen.getByTestId('probe-row');

    harness.setContainerMetrics(container, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 640,
      scrollTop: 24,
    });
    harness.setElementRect(row, { width: 640, height: 48 });

    harness.triggerResize(container);
    expect(screen.getByTestId('probe-events')).toHaveTextContent('container');

    harness.triggerResize(row);
    expect(screen.getByTestId('probe-events')).toHaveTextContent('row');

    harness.restore();
  });

  it('raises an explicit misuse error when the measurement target is missing', () => {
    const harness = installTranscriptMeasurementHarness();

    expect(() =>
      harness.setContainerMetrics(undefined, { height: 200 }),
    ).toThrow(TranscriptMeasurementHarnessError);
    expect(() => harness.triggerResize(null)).toThrow(
      'Expected measurement target to be an HTMLElement.',
    );

    harness.restore();
  });
});
