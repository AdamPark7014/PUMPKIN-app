export type Finding = {
  /** Criterio incumplido, p. ej. `WCAG 1.4.3 contraste`. */
  readonly rule: string;
  /** Elemento afectado, expresado como ruta DOM o como nodo del árbol ARIA. */
  readonly target: string;
  /** Datos medidos que justifican el hallazgo. */
  readonly detail: string;
};

export function finding(rule: string, target: string, detail: string): Finding {
  return { rule, target, detail };
}

/**
 * Mensaje de fallo legible: siempre incluye el total real de hallazgos aunque
 * la lista se recorte, para que el reporte no esconda el tamaño del problema.
 */
export function formatFindings(
  headline: string,
  findings: readonly Finding[],
  limit = 15,
): string {
  if (findings.length === 0) return headline;
  const shown = findings.slice(0, limit);
  const lines = shown.map(
    (item, index) =>
      `  ${index + 1}. [${item.rule}] ${item.target}\n     ${item.detail}`,
  );
  const omitted = findings.length - shown.length;
  const tail = omitted > 0 ? `\n  … y ${omitted} hallazgo(s) más.` : '';
  return `${headline} (${findings.length}):\n${lines.join('\n')}${tail}`;
}
