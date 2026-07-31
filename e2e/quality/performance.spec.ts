import { test, expect } from '@playwright/test';
import { openScreen } from './_lib/navigate';
import {
  formatPerformanceSample,
  performanceBudgets,
  readPerformanceSample,
  settleForMetrics,
} from './_lib/performance';
import { appDownMessage, appIsUp, screens, type Screen } from './_lib/targets';

/**
 * Presupuestos tomados de `e2e/support/environment.ts`:
 * - document load (`loadEventEnd`) ≤ `performance.documentLoadMs` (3s)
 * - Largest Contentful Paint ≤ `performance.largestContentfulPaintMs` (4s)
 *
 * Sólo se miden pantallas públicas (sin auth) para no mezclar el coste del
 * login API con la carga del documento.
 */
const performanceScreens: readonly Screen[] = screens.filter(
  (screen) => !screen.auth,
);

for (const screen of performanceScreens) {
  test.describe(`performance · ${screen.app}`, () => {
    test.beforeEach(async () => {
      test.skip(!(await appIsUp(screen.app)), appDownMessage(screen.app));
    });

    test(`${screen.id} · navigation timing y LCP bajo presupuesto`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);

      await openScreen(page, screen, { withLcpProbe: true });
      await settleForMetrics(page, performanceBudgets.largestContentfulPaintMs);

      const sample = await readPerformanceSample(page);
      const narrative = formatPerformanceSample(sample, performanceBudgets);
      await testInfo.attach(`perf-${screen.id}.txt`, {
        body: narrative,
        contentType: 'text/plain',
      });
      await testInfo.attach(`perf-${screen.id}.json`, {
        body: JSON.stringify(sample, null, 2),
        contentType: 'application/json',
      });

      expect(
        sample.navigation.loadEventEnd,
        `document load supera el presupuesto de ${performanceBudgets.documentLoadMs}ms — ${narrative}`,
      ).toBeLessThanOrEqual(performanceBudgets.documentLoadMs);

      expect(
        sample.lcp,
        `LCP no se observó antes del presupuesto de ${performanceBudgets.largestContentfulPaintMs}ms — ${narrative}`,
      ).not.toBeNull();

      if (sample.lcp !== null) {
        expect(
          sample.lcp.value,
          `LCP supera el presupuesto de ${performanceBudgets.largestContentfulPaintMs}ms — ${narrative}`,
        ).toBeLessThanOrEqual(performanceBudgets.largestContentfulPaintMs);
      }
    });
  });
}

test.describe('performance · meta', () => {
  test('los presupuestos se leen de environment.performance', () => {
    expect(performanceBudgets.documentLoadMs).toBe(
      Number(process.env.E2E_DOCUMENT_LOAD_BUDGET_MS ?? 3_000),
    );
    expect(performanceBudgets.largestContentfulPaintMs).toBe(
      Number(process.env.E2E_LCP_BUDGET_MS ?? 4_000),
    );
  });
});
