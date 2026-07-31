/// <reference lib="dom" />

import type { Page } from '@playwright/test';

export type DocumentBasics = {
  readonly lang: string;
  readonly title: string;
  readonly viewportContent: string | null;
  readonly duplicatedIds: readonly string[];
};

export type LabelIssue = {
  readonly path: string;
  readonly control: string;
  readonly reason: string;
};

export type AlternativeTextIssue = {
  readonly path: string;
  readonly reason: string;
};

export type ContrastSample = {
  readonly path: string;
  readonly text: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly threshold: number;
  readonly fontSizePx: number;
  readonly fontWeight: number;
};

export type ContrastReport = {
  readonly evaluated: number;
  readonly indeterminate: number;
  readonly violations: readonly ContrastSample[];
};

export async function readDocumentBasics(page: Page): Promise<DocumentBasics> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('[id]'))) {
      const id = element.getAttribute('id') ?? '';
      if (id.length === 0) continue;
      if (seen.has(id)) duplicated.add(id);
      seen.add(id);
    }
    const viewport = document.querySelector('meta[name="viewport"]');
    return {
      lang: document.documentElement.getAttribute('lang') ?? '',
      title: document.title,
      viewportContent: viewport?.getAttribute('content') ?? null,
      duplicatedIds: Array.from(duplicated),
    };
  });
}

/**
 * Comprueba la asociación programática etiqueta ↔ control (WCAG 3.3.2).
 * Es complementaria al nombre accesible: aquí interesa *cómo* se etiqueta, para
 * poder señalar el patrón exacto que falta en el código de la aplicación.
 */
export async function auditFormLabels(page: Page): Promise<readonly LabelIssue[]> {
  return page.evaluate(() => {
    function domPath(element: Element): string {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node !== null && parts.length < 6) {
        const tag = node.tagName.toLowerCase();
        const id = node.getAttribute('id');
        if (id !== null && id.length > 0) {
          parts.unshift(`${tag}#${id}`);
          break;
        }
        const parent: Element | null = node.parentElement;
        let part = tag;
        if (parent !== null) {
          const twins = Array.from(parent.children).filter(
            (child) => child.tagName === node?.tagName,
          );
          if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    }

    function textOf(element: Element | null): string {
      return (element?.textContent ?? '').trim();
    }

    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number.parseFloat(style.opacity) === 0) return false;
      return element.getClientRects().length > 0;
    }

    const selector = [
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      'select',
      'textarea',
    ].join(', ');

    const issues: { path: string; control: string; reason: string }[] = [];

    for (const control of Array.from(document.querySelectorAll(selector))) {
      if (control.closest('[aria-hidden="true"]') !== null) continue;
      if (!isVisible(control)) continue;

      const tag = control.tagName.toLowerCase();
      const type = control.getAttribute('type');
      const descriptor = type === null ? tag : `${tag}[type=${type}]`;

      const ariaLabel = (control.getAttribute('aria-label') ?? '').trim();
      if (ariaLabel.length > 0) continue;

      const labelledBy = control.getAttribute('aria-labelledby');
      if (labelledBy !== null) {
        const referenced = labelledBy
          .split(/\s+/)
          .filter((id) => id.length > 0)
          .map((id) => document.getElementById(id));
        const missing = referenced.filter((element) => element === null).length;
        if (missing > 0) {
          issues.push({
            path: domPath(control),
            control: descriptor,
            reason: `aria-labelledby="${labelledBy}" apunta a ${missing} id(s) inexistente(s)`,
          });
          continue;
        }
        if (referenced.some((element) => textOf(element).length > 0)) continue;
        issues.push({
          path: domPath(control),
          control: descriptor,
          reason: `aria-labelledby="${labelledBy}" referencia elementos sin texto`,
        });
        continue;
      }

      const id = control.getAttribute('id');
      const explicitLabel =
        id !== null && id.length > 0
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
          : null;
      if (textOf(explicitLabel).length > 0) continue;

      const wrappingLabel = control.closest('label');
      if (textOf(wrappingLabel).length > 0) continue;

      const title = (control.getAttribute('title') ?? '').trim();
      if (title.length > 0) continue;

      const placeholder = (control.getAttribute('placeholder') ?? '').trim();
      issues.push({
        path: domPath(control),
        control: descriptor,
        reason:
          placeholder.length > 0
            ? `sin <label>, aria-label ni aria-labelledby; sólo placeholder "${placeholder}"`
            : 'sin <label>, aria-label, aria-labelledby ni title',
      });
    }

    return issues;
  });
}

/** WCAG 1.1.1: toda imagen necesita alternativa textual o marcarse decorativa. */
export async function auditAlternativeText(
  page: Page,
): Promise<readonly AlternativeTextIssue[]> {
  return page.evaluate(() => {
    function domPath(element: Element): string {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node !== null && parts.length < 6) {
        const tag = node.tagName.toLowerCase();
        const id = node.getAttribute('id');
        if (id !== null && id.length > 0) {
          parts.unshift(`${tag}#${id}`);
          break;
        }
        const parent: Element | null = node.parentElement;
        let part = tag;
        if (parent !== null) {
          const twins = Array.from(parent.children).filter(
            (child) => child.tagName === node?.tagName,
          );
          if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    }

    function isDecorative(element: Element): boolean {
      if (element.closest('[aria-hidden="true"]') !== null) return true;
      const role = element.getAttribute('role');
      return role === 'presentation' || role === 'none';
    }

    const issues: { path: string; reason: string }[] = [];

    for (const image of Array.from(document.querySelectorAll('img'))) {
      if (isDecorative(image)) continue;
      if (image.hasAttribute('alt')) continue;
      const source = image.getAttribute('src') ?? '(sin src)';
      issues.push({
        path: domPath(image),
        reason: `<img> sin atributo alt (src="${source.slice(0, 80)}")`,
      });
    }

    for (const svg of Array.from(document.querySelectorAll('svg[role="img"]'))) {
      if (isDecorative(svg)) continue;
      const hasLabel = (svg.getAttribute('aria-label') ?? '').trim().length > 0;
      const hasLabelledBy = svg.hasAttribute('aria-labelledby');
      const hasTitle = (svg.querySelector('title')?.textContent ?? '').trim().length > 0;
      if (hasLabel || hasLabelledBy || hasTitle) continue;
      issues.push({
        path: domPath(svg),
        reason: 'svg[role="img"] sin <title>, aria-label ni aria-labelledby',
      });
    }

    return issues;
  });
}

/**
 * WCAG 1.4.3. El contraste se calcula en la página: se compone el color de
 * fondo real recorriendo los ancestros (alfa premultiplicado y `opacity`
 * incluidos) y se aplica la fórmula de luminancia relativa de la WCAG.
 * Cuando el fondo depende de una imagen o gradiente, el par no es calculable de
 * forma determinista y se cuenta como indeterminado en vez de inventar un valor.
 */
export async function auditContrast(page: Page): Promise<ContrastReport> {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };

    function domPath(element: Element): string {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node !== null && parts.length < 6) {
        const tag = node.tagName.toLowerCase();
        const id = node.getAttribute('id');
        if (id !== null && id.length > 0) {
          parts.unshift(`${tag}#${id}`);
          break;
        }
        const parent: Element | null = node.parentElement;
        let part = tag;
        if (parent !== null) {
          const twins = Array.from(parent.children).filter(
            (child) => child.tagName === node?.tagName,
          );
          if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    }

    function parseColor(value: string): Rgba | null {
      const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
      if (match === null) return null;
      const raw = (match[1] ?? '').split(/[\s,/]+/).filter((part) => part.length > 0);
      if (raw.length < 3) return null;
      const channel = (input: string | undefined): number | null => {
        if (input === undefined) return null;
        const numeric = Number.parseFloat(input);
        if (!Number.isFinite(numeric)) return null;
        return input.endsWith('%') ? (numeric / 100) * 255 : numeric;
      };
      const r = channel(raw[0]);
      const g = channel(raw[1]);
      const b = channel(raw[2]);
      if (r === null || g === null || b === null) return null;
      let alpha = 1;
      if (raw.length >= 4) {
        const rawAlpha = raw[3] ?? '1';
        const numeric = Number.parseFloat(rawAlpha);
        if (!Number.isFinite(numeric)) return null;
        alpha = rawAlpha.endsWith('%') ? numeric / 100 : numeric;
      }
      return { r, g, b, a: Math.min(1, Math.max(0, alpha)) };
    }

    function over(source: Rgba, backdrop: Rgba): Rgba {
      const a = source.a + backdrop.a * (1 - source.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const mix = (s: number, b: number): number =>
        (s * source.a + b * backdrop.a * (1 - source.a)) / a;
      return {
        r: mix(source.r, backdrop.r),
        g: mix(source.g, backdrop.g),
        b: mix(source.b, backdrop.b),
        a,
      };
    }

    function toCss(color: Rgba): string {
      const round = (value: number): number => Math.round(value);
      return `rgb(${round(color.r)}, ${round(color.g)}, ${round(color.b)})`;
    }

    function luminance(color: Rgba): number {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      return (
        0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
      );
    }

    function ratioBetween(a: Rgba, b: Rgba): number {
      const first = luminance(a);
      const second = luminance(b);
      const lighter = Math.max(first, second);
      const darker = Math.min(first, second);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function ownText(element: Element): string {
      let text = '';
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === 3) text += node.textContent ?? '';
      }
      return text.replace(/\s+/g, ' ').trim();
    }

    function isRendered(element: Element, style: CSSStyleDeclaration): boolean {
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number.parseFloat(style.opacity) === 0) return false;
      // Texto sólo para AT (clip / 1×1): no participa en contraste visual.
      const width = Number.parseFloat(style.width);
      const height = Number.parseFloat(style.height);
      if (
        style.position === 'absolute' &&
        ((Number.isFinite(width) && width <= 1 && Number.isFinite(height) && height <= 1) ||
          style.clip === 'rect(0px, 0px, 0px, 0px)' ||
          style.clip === 'rect(0, 0, 0, 0)' ||
          style.clipPath === 'inset(50%)')
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    /** Devuelve el fondo compuesto o `null` si no es determinable. */
    function resolveBackground(element: Element): Rgba | null {
      let accumulated: Rgba = { r: 0, g: 0, b: 0, a: 0 };
      let node: Element | null = element;
      while (node !== null) {
        const style = window.getComputedStyle(node);
        if (style.backgroundImage !== 'none') return null;
        const webkitBackdrop = (style as CSSStyleDeclaration & {
          webkitBackdropFilter?: string;
        }).webkitBackdropFilter;
        const backdrop = style.backdropFilter || webkitBackdrop;
        if (backdrop !== undefined && backdrop !== 'none' && backdrop.length > 0) {
          // El color efectivo depende de lo que hay detrás del blur.
          return null;
        }
        const own = parseColor(style.backgroundColor);
        if (own === null) return null;
        const opacity = Number.parseFloat(style.opacity);
        const effective: Rgba = {
          ...own,
          a: own.a * (Number.isFinite(opacity) ? opacity : 1),
        };
        // Sticky/fixed con alpha bajo (p. ej. header sobre hero): el fondo
        // visual es el contenido que queda detrás, no los ancestros del DOM.
        if (
          (style.position === 'fixed' || style.position === 'sticky') &&
          effective.a < 0.95
        ) {
          return null;
        }
        if (effective.a > 0) {
          accumulated = over(accumulated, effective);
          if (accumulated.a >= 0.999) return accumulated;
        }
        node = node.parentElement;
      }
      return over(accumulated, { r: 255, g: 255, b: 255, a: 1 });
    }

    const violations: {
      path: string;
      text: string;
      foreground: string;
      background: string;
      ratio: number;
      threshold: number;
      fontSizePx: number;
      fontWeight: number;
    }[] = [];
    let evaluated = 0;
    let indeterminate = 0;
    const skippedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION']);

    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (skippedTags.has(element.tagName)) continue;
      const text = ownText(element);
      if (text.length === 0) continue;
      if (element.closest('[aria-hidden="true"]') !== null) continue;
      if (element.closest(':disabled') !== null) continue;

      const style = window.getComputedStyle(element);
      if (!isRendered(element, style)) continue;

      // Texto pintado con gradiente: el color efectivo no es el `color` CSS.
      if (style.webkitTextFillColor === 'rgba(0, 0, 0, 0)') {
        indeterminate += 1;
        continue;
      }

      const foreground = parseColor(style.color);
      const background = resolveBackground(element);
      if (foreground === null || background === null) {
        indeterminate += 1;
        continue;
      }

      const opacity = Number.parseFloat(style.opacity);
      const blendedForeground = over(
        { ...foreground, a: foreground.a * (Number.isFinite(opacity) ? opacity : 1) },
        background,
      );

      const fontSizePx = Number.parseFloat(style.fontSize);
      const parsedWeight = Number.parseInt(style.fontWeight, 10);
      const fontWeight = Number.isFinite(parsedWeight)
        ? parsedWeight
        : style.fontWeight === 'bold'
          ? 700
          : 400;
      const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
      const threshold = isLarge ? 3 : 4.5;

      evaluated += 1;
      const ratio = ratioBetween(blendedForeground, background);
      if (ratio + 0.005 < threshold) {
        violations.push({
          path: domPath(element),
          text: text.slice(0, 60),
          foreground: toCss(blendedForeground),
          background: toCss(background),
          ratio: Math.round(ratio * 100) / 100,
          threshold,
          fontSizePx: Math.round(fontSizePx * 10) / 10,
          fontWeight,
        });
      }
    }

    violations.sort((first, second) => first.ratio - second.ratio);
    return { evaluated, indeterminate, violations };
  });
}
