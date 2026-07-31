import type { Page } from '@playwright/test';
import { ensureAuthenticated } from './auth';
import { installLcpProbe } from './performance';
import { waitForScreenReady } from './readiness';
import { appIsUp, appDownMessage, screenUrl, type Screen } from './targets';

export type OpenOptions = {
  /** Instala el observador de LCP antes de navegar (suite de rendimiento). */
  readonly withLcpProbe?: boolean;
};

/**
 * Abre una pantalla principal: comprueba que la app esté arriba, autentica si
 * hace falta, navega y espera señales de listo basadas en roles ARIA.
 */
export async function openScreen(
  page: Page,
  screen: Screen,
  options: OpenOptions = {},
): Promise<void> {
  if (!(await appIsUp(screen.app))) {
    throw new Error(appDownMessage(screen.app));
  }

  if (options.withLcpProbe === true) {
    await installLcpProbe(page);
  }

  if (screen.auth) {
    await ensureAuthenticated(page, screen.app);
  }

  await page.goto(screenUrl(screen), { waitUntil: 'domcontentloaded' });
  await waitForScreenReady(page, screen);
}
