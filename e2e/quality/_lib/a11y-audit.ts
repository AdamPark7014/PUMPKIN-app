import { expect, type Page } from '@playwright/test';
import {
  LANDMARK_ROLES,
  ROLES_REQUIRING_NAME,
  headingLevel,
  nodeEvidence,
  parseAriaSnapshot,
  type AriaNode,
} from './aria';
import {
  auditAlternativeText,
  auditContrast,
  auditFormLabels,
  readDocumentBasics,
} from './dom-audit';
import { finding, formatFindings, type Finding } from './findings';
import { auditKeyboardFocus } from './keyboard';
import type { Screen } from './targets';

export type A11yReport = {
  readonly screen: Screen;
  readonly findings: readonly Finding[];
  readonly summary: {
    readonly landmarks: readonly string[];
    readonly interactiveUnnamed: number;
    readonly contrastEvaluated: number;
    readonly contrastIndeterminate: number;
    readonly contrastViolations: number;
    readonly keyboardStopsMissingRing: number;
  };
};

function collectLandmarkFindings(nodes: readonly AriaNode[]): Finding[] {
  const findings: Finding[] = [];
  const mains = nodes.filter((node) => node.role === 'main');
  if (mains.length === 0) {
    findings.push(
      finding(
        'WCAG 1.3.1 landmarks',
        '(documento)',
        'No hay ningún nodo con rol main; los lectores de pantalla no pueden saltar al contenido',
      ),
    );
  } else if (mains.length > 1) {
    findings.push(
      finding(
        'WCAG 1.3.1 landmarks',
        mains.map(nodeEvidence).join(' · '),
        `Hay ${mains.length} landmarks main; debe haber exactamente uno`,
      ),
    );
  }

  for (const node of nodes) {
    if (!LANDMARK_ROLES.has(node.role)) continue;
    if (node.role === 'region' || node.role === 'form' || node.role === 'navigation') {
      if (node.name === null || node.name.trim().length === 0) {
        // Un único landmark del tipo puede vivir sin nombre; varios del mismo
        // tipo sin nombre son ambiguos (ARIA practices).
        const siblings = nodes.filter((candidate) => candidate.role === node.role);
        if (siblings.length > 1) {
          findings.push(
            finding(
              'WCAG 1.3.1 landmarks',
              nodeEvidence(node),
              `${siblings.length} landmarks "${node.role}" y éste no tiene nombre accesible`,
            ),
          );
        }
      }
    }
  }

  return findings;
}

function collectNameFindings(nodes: readonly AriaNode[]): Finding[] {
  const findings: Finding[] = [];
  for (const node of nodes) {
    if (!ROLES_REQUIRING_NAME.has(node.role)) continue;
    if (node.name !== null && node.name.trim().length > 0) continue;
    // Los botones/links cuyo contenido es solo icono a menudo llegan aquí.
    findings.push(
      finding(
        'WCAG 4.1.2 nombre accesible',
        nodeEvidence(node),
        `Rol "${node.role}" expuesto sin accessible name`,
      ),
    );
  }
  return findings;
}

function collectHeadingFindings(nodes: readonly AriaNode[]): Finding[] {
  const findings: Finding[] = [];
  const headings = nodes.filter((node) => node.role === 'heading');
  if (headings.length === 0) {
    findings.push(
      finding(
        'WCAG 1.3.1 headings',
        '(documento)',
        'No hay ningún heading en el árbol ARIA; la página no expone estructura de títulos',
      ),
    );
    return findings;
  }

  let previous = 0;
  for (const heading of headings) {
    const level = headingLevel(heading);
    if (level === null) continue;
    if (previous > 0 && level > previous + 1) {
      findings.push(
        finding(
          'WCAG 1.3.1 headings',
          nodeEvidence(heading),
          `Salto de heading h${previous} → h${level}`,
        ),
      );
    }
    previous = level;
  }
  return findings;
}

export async function runA11yAudit(page: Page, screen: Screen): Promise<A11yReport> {
  const findings: Finding[] = [];

  const basics = await readDocumentBasics(page);
  if (basics.lang.trim().length === 0) {
    findings.push(
      finding(
        'WCAG 3.1.1 idioma',
        'html',
        'El documento no declara lang; los lectores de pantalla usan el idioma del SO',
      ),
    );
  }
  if (basics.title.trim().length === 0) {
    findings.push(
      finding('WCAG 2.4.2 título', 'document.title', 'El documento no tiene <title>'),
    );
  }
  if (basics.duplicatedIds.length > 0) {
    findings.push(
      finding(
        'WCAG 4.1.1 ids',
        basics.duplicatedIds.map((id) => `#${id}`).join(', '),
        `Ids duplicados en el DOM: ${basics.duplicatedIds.join(', ')}`,
      ),
    );
  }

  const snapshot = await page.locator(':root').ariaSnapshot();
  const nodes = parseAriaSnapshot(snapshot);

  findings.push(...collectLandmarkFindings(nodes));
  findings.push(...collectNameFindings(nodes));
  findings.push(...collectHeadingFindings(nodes));

  for (const issue of await auditFormLabels(page)) {
    findings.push(
      finding('WCAG 3.3.2 etiquetas', issue.path, `${issue.control}: ${issue.reason}`),
    );
  }

  for (const issue of await auditAlternativeText(page)) {
    findings.push(finding('WCAG 1.1.1 texto alternativo', issue.path, issue.reason));
  }

  const contrast = await auditContrast(page);
  for (const sample of contrast.violations.slice(0, 25)) {
    findings.push(
      finding(
        'WCAG 1.4.3 contraste',
        sample.path,
        `"${sample.text}" ratio=${sample.ratio}:1 < ${sample.threshold}:1 ` +
          `(fg=${sample.foreground}, bg=${sample.background}, ` +
          `${sample.fontSizePx}px / weight ${sample.fontWeight})`,
      ),
    );
  }

  const keyboardFindings = await auditKeyboardFocus(page);
  findings.push(...keyboardFindings);

  return {
    screen,
    findings,
    summary: {
      landmarks: Array.from(
        new Set(
          nodes
            .filter((node) => LANDMARK_ROLES.has(node.role))
            .map((node) => (node.name ? `${node.role}:"${node.name}"` : node.role)),
        ),
      ),
      interactiveUnnamed: findings.filter((item) => item.rule.includes('nombre')).length,
      contrastEvaluated: contrast.evaluated,
      contrastIndeterminate: contrast.indeterminate,
      contrastViolations: contrast.violations.length,
      keyboardStopsMissingRing: keyboardFindings.filter((item) =>
        item.rule.includes('foco'),
      ).length,
    },
  };
}

export function assertNoA11yFindings(report: A11yReport): void {
  expect(
    report.findings,
    formatFindings(
      `A11y falló en ${report.screen.id} (${report.screen.path})`,
      report.findings,
    ),
  ).toEqual([]);
}
