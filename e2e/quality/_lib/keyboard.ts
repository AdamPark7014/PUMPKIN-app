import type { Page } from '@playwright/test';
import { finding, type Finding } from './findings';

type FocusProbe = {
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly path: string;
  readonly outlineWidth: string;
  readonly outlineStyle: string;
  readonly boxShadow: string;
  readonly ringOk: boolean;
};

/**
 * Recorre el orden de tabulación real del documento. Se envía `Tab` y se lee
 * `document.activeElement` tras cada pulsación (condition wait implícito de
 * Playwright sobre la acción). No se inspeccionan clases CSS: la evidencia de
 * foco visible es el estilo computado `outline` / `box-shadow`.
 */
export async function auditKeyboardFocus(
  page: Page,
  maxStops = 24,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];

  // Empieza desde el body para no heredar el foco que dejó un test anterior.
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.focus({ preventScroll: true });
  });

  const seen = new Set<string>();
  let stalled = 0;

  for (let index = 0; index < maxStops; index += 1) {
    await page.keyboard.press('Tab');

    const probe = await page.evaluate((): FocusProbe | null => {
      const element = document.activeElement;
      if (
        !(element instanceof HTMLElement) ||
        element === document.body ||
        element === document.documentElement
      ) {
        return null;
      }

      function domPath(node: Element): string {
        const parts: string[] = [];
        let current: Element | null = node;
        while (current !== null && parts.length < 5) {
          const tag = current.tagName.toLowerCase();
          const id = current.getAttribute('id');
          if (id !== null && id.length > 0) {
            parts.unshift(`${tag}#${id}`);
            break;
          }
          const parent: Element | null = current.parentElement;
          let part = tag;
          if (parent !== null) {
            const twins = Array.from(parent.children).filter(
              (child) => child.tagName === current?.tagName,
            );
            if (twins.length > 1) {
              part += `:nth-of-type(${twins.indexOf(current) + 1})`;
            }
          }
          parts.unshift(part);
          current = parent;
        }
        return parts.join(' > ');
      }

      const style = window.getComputedStyle(element);
      const outlineWidth = style.outlineWidth;
      const outlineStyle = style.outlineStyle;
      const boxShadow = style.boxShadow;
      const outlinePx = Number.parseFloat(outlineWidth);
      let ringOk =
        (outlineStyle !== 'none' && Number.isFinite(outlinePx) && outlinePx > 0) ||
        (boxShadow !== 'none' && boxShadow.length > 0);

      // Patrón :focus-within: el anillo vive en un ancestro (p. ej. label
      // envolvente) mientras el foco real está en el input.
      if (!ringOk) {
        let ancestor: Element | null = element.parentElement;
        for (let depth = 0; depth < 4 && ancestor !== null; depth += 1) {
          const parentStyle = window.getComputedStyle(ancestor);
          const borderWidth = Number.parseFloat(parentStyle.borderTopWidth);
          const borderColor = parentStyle.borderTopColor;
          const parentShadow = parentStyle.boxShadow;
          const parentOutlinePx = Number.parseFloat(parentStyle.outlineWidth);
          const hasBorder =
            Number.isFinite(borderWidth) &&
            borderWidth > 0 &&
            borderColor !== 'rgba(0, 0, 0, 0)' &&
            borderColor !== 'transparent';
          const hasOutline =
            parentStyle.outlineStyle !== 'none' &&
            Number.isFinite(parentOutlinePx) &&
            parentOutlinePx > 0;
          const hasShadow = parentShadow !== 'none' && parentShadow.length > 0;
          if (hasBorder || hasOutline || hasShadow) {
            ringOk = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }

      const ariaLabel = (element.getAttribute('aria-label') ?? '').trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      let labelledText = '';
      if (labelledBy !== null) {
        labelledText = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      }
      const name =
        ariaLabel ||
        labelledText ||
        (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.getAttribute('name') ||
        '';

      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        name,
        path: domPath(element),
        outlineWidth,
        outlineStyle,
        boxShadow: boxShadow.slice(0, 120),
        ringOk,
      };
    });

    if (probe === null) {
      stalled += 1;
      if (stalled >= 2) break;
      continue;
    }
    stalled = 0;

    const key = `${probe.path}|${probe.name}|${probe.role ?? ''}`;
    if (seen.has(key)) {
      // Ciclo de tabulación completo: no hay más destinos nuevos.
      break;
    }
    seen.add(key);

    if (!probe.ringOk) {
      findings.push(
        finding(
          'WCAG 2.4.7 foco visible',
          probe.path,
          `${probe.tag}${probe.role ? `[role=${probe.role}]` : ''} "${probe.name}" ` +
            `sin outline ni box-shadow al recibir foco ` +
            `(outline=${probe.outlineStyle} ${probe.outlineWidth}, box-shadow=${probe.boxShadow || 'none'})`,
        ),
      );
    }
  }

  if (seen.size === 0) {
    findings.push(
      finding(
        'WCAG 2.1.1 teclado',
        '(documento)',
        'Tras varias pulsaciones de Tab, document.activeElement no se movió a ningún control enfocable',
      ),
    );
  }

  return findings;
}
