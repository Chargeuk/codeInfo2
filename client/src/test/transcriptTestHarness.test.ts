import { render, screen } from '@testing-library/react';
import { createElement, useEffect, useState } from 'react';
import {
  installTranscriptMeasurementHarness,
  TranscriptMeasurementHarnessError,
} from './support/transcriptMeasurementHarness';

function MeasurementProbe() {
  const [containerElement, setContainerElement] =
    useState<HTMLDivElement | null>(null);
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (!containerElement || !rowElement || !globalThis.ResizeObserver) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setEvents(
        entries.map((entry) => (entry.target as HTMLElement).dataset.id ?? ''),
      );
    });
    observer.observe(containerElement);
    observer.observe(rowElement);
    return () => observer.disconnect();
  }, [containerElement, rowElement]);

  return createElement(
    'div',
    null,
    createElement(
      'div',
      {
        ref: setContainerElement,
        'data-id': 'container',
        'data-testid': 'probe-container',
      },
      createElement(
        'div',
        {
          ref: setRowElement,
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
