import { act } from '@testing-library/react';

type ElementRect = {
  width: number;
  height: number;
  top: number;
  left: number;
};

type ScrollMetrics = {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
};

type ResizeTarget = Element | null | undefined;

type HarnessResizeObserverInstance = {
  callback: ResizeObserverCallback;
  observedTargets: Set<Element>;
};

const DEFAULT_RECT: ElementRect = {
  width: 640,
  height: 0,
  top: 0,
  left: 0,
};

const rectMap = new WeakMap<Element, ElementRect>();
const scrollMetricsMap = new WeakMap<
  HTMLElement,
  Required<Pick<ScrollMetrics, 'clientHeight' | 'scrollHeight' | 'scrollTop'>>
>();
const observedInstances = new Set<HarnessResizeObserverInstance>();

export class TranscriptMeasurementHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptMeasurementHarnessError';
  }
}

function assertElement(
  target: ResizeTarget,
  label: string,
): asserts target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    throw new TranscriptMeasurementHarnessError(
      `Expected ${label} to be an HTMLElement.`,
    );
  }
}

function buildRect(rect: ElementRect): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function ensureRectGetter(target: HTMLElement) {
  const element = target as HTMLElement & {
    __transcriptMeasurementHarnessRectInstalled?: boolean;
  };
  if (element.__transcriptMeasurementHarnessRectInstalled) {
    return;
  }
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => buildRect(rectMap.get(element) ?? DEFAULT_RECT),
  });
  element.__transcriptMeasurementHarnessRectInstalled = true;
}

function ensureScrollMetrics(target: HTMLElement) {
  const element = target as HTMLElement & {
    __transcriptMeasurementHarnessScrollInstalled?: boolean;
  };
  if (element.__transcriptMeasurementHarnessScrollInstalled) {
    return;
  }

  const setMetricProperty = (
    property: 'clientHeight' | 'scrollHeight' | 'scrollTop',
  ) => {
    Object.defineProperty(element, property, {
      configurable: true,
      get: () => scrollMetricsMap.get(element)?.[property] ?? 0,
      set: (next: number) => {
        const current = scrollMetricsMap.get(element) ?? {
          clientHeight: 0,
          scrollHeight: 0,
          scrollTop: 0,
        };
        scrollMetricsMap.set(element, {
          ...current,
          [property]: Number.isFinite(next) ? Number(next) : current[property],
        });
      },
    });
  };

  setMetricProperty('clientHeight');
  setMetricProperty('scrollHeight');
  setMetricProperty('scrollTop');
  element.__transcriptMeasurementHarnessScrollInstalled = true;
}

function createResizeObserverEntry(target: HTMLElement): ResizeObserverEntry {
  const rect = rectMap.get(target) ?? DEFAULT_RECT;
  const contentRect = buildRect(rect);
  return {
    target,
    contentRect,
    borderBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
    contentBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
    devicePixelContentBoxSize: [
      { blockSize: rect.height, inlineSize: rect.width },
    ],
  } as unknown as ResizeObserverEntry;
}

export function installTranscriptMeasurementHarness() {
  const originalResizeObserver = globalThis.ResizeObserver;

  class HarnessResizeObserver implements ResizeObserver {
    callback: ResizeObserverCallback;
    observedTargets = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      observedInstances.add(this);
    }

    observe = (target: Element) => {
      this.observedTargets.add(target);
    };

    unobserve = (target: Element) => {
      this.observedTargets.delete(target);
    };

    disconnect = () => {
      this.observedTargets.clear();
      observedInstances.delete(this);
    };
  }

  globalThis.ResizeObserver =
    HarnessResizeObserver as unknown as typeof ResizeObserver;

  return {
    setElementRect(target: ResizeTarget, rect: Partial<ElementRect> = {}) {
      assertElement(target, 'measurement target');
      const nextRect = {
        ...(rectMap.get(target) ?? DEFAULT_RECT),
        ...rect,
      };
      rectMap.set(target, nextRect);
      ensureRectGetter(target);
    },
    setScrollMetrics(target: ResizeTarget, metrics: ScrollMetrics) {
      assertElement(target, 'scroll container');
      ensureScrollMetrics(target);
      const current = scrollMetricsMap.get(target) ?? {
        clientHeight: 0,
        scrollHeight: 0,
        scrollTop: 0,
      };
      scrollMetricsMap.set(target, {
        clientHeight: metrics.clientHeight ?? current.clientHeight,
        scrollHeight: metrics.scrollHeight ?? current.scrollHeight,
        scrollTop: metrics.scrollTop ?? current.scrollTop,
      });
    },
    setContainerMetrics(
      target: ResizeTarget,
      metrics: Partial<ElementRect> & ScrollMetrics,
    ) {
      assertElement(target, 'transcript container');
      this.setElementRect(target, metrics);
      this.setScrollMetrics(target, {
        clientHeight:
          metrics.clientHeight ??
          metrics.height ??
          scrollMetricsMap.get(target)?.clientHeight,
        scrollHeight:
          metrics.scrollHeight ??
          metrics.height ??
          scrollMetricsMap.get(target)?.scrollHeight,
        scrollTop: metrics.scrollTop,
      });
    },
    triggerResize(target: ResizeTarget) {
      assertElement(target, 'measurement target');
      const entry = createResizeObserverEntry(target);
      act(() => {
        observedInstances.forEach((observer) => {
          if (!observer.observedTargets.has(target)) {
            return;
          }
          observer.callback([entry], observer as unknown as ResizeObserver);
        });
      });
    },
    restore() {
      observedInstances.clear();
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        Reflect.deleteProperty(
          globalThis as typeof globalThis & Record<string, unknown>,
          'ResizeObserver',
        );
      }
    },
  };
}
