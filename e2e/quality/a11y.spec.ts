import { test, expect } from '@playwright/test';
import { assertNoA11yFindings, runA11yAudit } from './_lib/a11y-audit';
import { parseAriaSnapshot, ROLES_REQUIRING_NAME } from './_lib/aria';
import { formatFindings } from './_lib/findings';
import { openScreen } from './_lib/navigate';
import { appDownMessage, appIsUp, screens, type Screen } from './_lib/targets';

/**
 * Suite de accesibilidad de las pantallas principales.
 *
 * Selectores: roles ARIA y nombres accesibles (nunca texto visible frágil ni
 * clases CSS). El contraste se calcula en el documento con `page.evaluate`.
 * Los hallazgos se adjuntan al reporte de Playwright como JSON.
 */
for (const screen of screens) {
  test.describe(`a11y · ${screen.app}`, () => {
    test.beforeEach(async () => {
      test.skip(!(await appIsUp(screen.app)), appDownMessage(screen.app));
    });

    test(`${screen.id} · landmarks, nombres, labels, teclado y contraste`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await openScreen(page, screen);

      const report = await runA11yAudit(page, screen);
      await testInfo.attach(`a11y-${screen.id}.json`, {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      assertNoA11yFindings(report);
    });
  });
}

test.describe('a11y · meta', () => {
  test('el catálogo cubre las tres aplicaciones', () => {
    const apps = new Set(screens.map((screen: Screen) => screen.app));
    expect([...apps].sort()).toEqual(['admin', 'taquilla', 'web']);
  });

  test('formatFindings resume el total aunque se recorte la lista', () => {
    const message = formatFindings(
      'demo',
      [
        { rule: 'r', target: 'a', detail: '1' },
        { rule: 'r', target: 'b', detail: '2' },
        { rule: 'r', target: 'c', detail: '3' },
      ],
      2,
    );
    expect(message).toContain('(3)');
    expect(message).toContain('1 hallazgo(s) más');
  });

  test('parseAriaSnapshot entiende roles, nombres y levels', () => {
    const nodes = parseAriaSnapshot(`
- banner:
  - link "BOLETERA"
  - navigation "Principal":
    - link "Conciertos"
- main:
  - heading "Cartelera" [level=1]
  - button
  - textbox "Email"
`);
    expect(nodes.map((node) => node.role)).toEqual([
      'banner',
      'link',
      'navigation',
      'link',
      'main',
      'heading',
      'button',
      'textbox',
    ]);
    expect(nodes.find((node) => node.role === 'heading')?.attributes['level']).toBe(
      '1',
    );
    expect(nodes.find((node) => node.role === 'button')?.name).toBeNull();
    expect(ROLES_REQUIRING_NAME.has('button')).toBe(true);
  });
});
