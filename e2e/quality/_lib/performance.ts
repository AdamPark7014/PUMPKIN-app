import type { Page } from '@playwright/test';
import { environment } from '../../support/environment';

export type NavigationTiming = {
  readonly transferSize: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly domContentLoaded: number;
  readonly loadEventEnd: number;
  readonly type: string;
};

export type LcpObservation = {
  readonly value: number;
  readonly size: number;
  readonly url: string | null;
  readonly element: string | null;
};

export type PerformanceSample = {
  readonly navigation: NavigationTiming;
  readonly lcp: LcpObservation | null;
};

export const performanceBudgets = environment.performance;

type LcpEntry = {
  value: number;
  size: number;
  url: string | null;
  element: string | null;
};

type ProbeState = {
  entries: LcpEntry[];
  observer: { disconnect(): void } | null;
};

/**
 * Instala un observador de Largest Contentful Paint *antes* de navegar.
 * Se llama en `addInitScript` para no perder entradas emitidas durante la
 * carga inicial.
 */
export async function installLcpProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: ProbeState = { entries: [], observer: null };
    Object.defineProperty(window, '__boleteraLcp', {
      value: state,
      configurable: true,
      writable: true,
    });

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const lcp = entry as PerformanceEntry & {
            size?: number;
            url?: string;
            element?: Element | null;
          };
          const element = lcp.element ?? null;
          state.entries.push({
            value: entry.startTime,
            size: typeof lcp.size === 'number' ? lcp.size : 0,
            url: typeof lcp.url === 'string' ? lcp.url : null,
            element:
              element === null
                ? null
                : `${element.tagName.toLowerCase()}${
                    element.id.length > 0 ? `#${element.id}` : ''
                  }`,
          });
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      state.observer = observer;
    } catch {
      // El navegador no soporta LCP; `readPerformanceSample` lo reportará.
    }
  });
}

/**
 * Espera a que la navegación haya emitido `load` y a que el hilo principal
 * esté quieto un instante. No usa `sleep` fijo: `requestIdleCallback` (o su
 * fallback con `requestAnimationFrame`) se resuelve cuando el runtime lo
 * permite, y `waitForFunction` sale en cuanto el observador de LCP ha
 * registrado al menos una entrada o ha pasado el presupuesto.
 */
export async function settleForMetrics(
  page: Page,
  budgetMs: number,
): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const finish = (): void => resolve();
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => finish(), { timeout: 1_500 });
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => finish()));
    });
  });

  // Si LCP aún no ha llegado, damos hasta el presupuesto para que el
  // observador lo registre; si nunca llega, `readPerformanceSample` lo dirá.
  await page
    .waitForFunction(
      () => {
        const state = (
          window as unknown as { __boleteraLcp?: { entries: unknown[] } }
        ).__boleteraLcp;
        return (state?.entries.length ?? 0) > 0;
      },
      undefined,
      { timeout: Math.max(500, budgetMs) },
    )
    .catch(() => undefined);
}

export async function readPerformanceSample(page: Page): Promise<PerformanceSample> {
  return page.evaluate(() => {
    const navigationEntry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;

    const navigation = {
      transferSize: navigationEntry?.transferSize ?? 0,
      responseStart: navigationEntry?.responseStart ?? 0,
      responseEnd: navigationEntry?.responseEnd ?? 0,
      domContentLoaded: navigationEntry?.domContentLoadedEventEnd ?? 0,
      loadEventEnd: navigationEntry?.loadEventEnd ?? 0,
      type: navigationEntry?.type ?? 'unknown',
    };

    const state = (window as unknown as { __boleteraLcp?: ProbeState }).__boleteraLcp;
    state?.observer?.disconnect();
    const last = state?.entries[state.entries.length - 1] ?? null;

    return {
      navigation,
      lcp: last,
    };
  });
}

export function formatPerformanceSample(
  sample: PerformanceSample,
  budgets: typeof performanceBudgets,
): string {
  const load = sample.navigation.loadEventEnd;
  const lcp = sample.lcp?.value ?? Number.NaN;
  const lcpDetail =
    sample.lcp === null
      ? 'LCP no observado'
      : `LCP=${Math.round(lcp)}ms (size=${sample.lcp.size}, el=${sample.lcp.element ?? 'n/a'})`;
  return [
    `nav.type=${sample.navigation.type}`,
    `TTFB=${Math.round(sample.navigation.responseStart)}ms`,
    `responseEnd=${Math.round(sample.navigation.responseEnd)}ms`,
    `DCL=${Math.round(sample.navigation.domContentLoaded)}ms`,
    `loadEventEnd=${Math.round(load)}ms (presupuesto=${budgets.documentLoadMs}ms)`,
    `${lcpDetail} (presupuesto=${budgets.largestContentfulPaintMs}ms)`,
    `transferSize=${sample.navigation.transferSize}B`,
  ].join(' | ');
}
