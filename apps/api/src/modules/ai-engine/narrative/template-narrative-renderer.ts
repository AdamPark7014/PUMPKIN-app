import type { AiNarrativeRenderer } from '@boletera/shared';

/**
 * Deterministic Spanish narrative renderer.
 * Future LLM adapters must implement AiNarrativeRenderer behind this boundary;
 * the default engine never calls external models.
 */
export class TemplateNarrativeRenderer implements AiNarrativeRenderer {
  render(input: {
    language: 'es-MX';
    facts: string[];
    highlights: string[];
    watchouts: string[];
  }): string {
    const parts: string[] = [];
    if (input.facts.length > 0) {
      parts.push(input.facts.join(' '));
    }
    if (input.highlights.length > 0) {
      parts.push(`Aspectos positivos: ${input.highlights.join(' ')}`);
    }
    if (input.watchouts.length > 0) {
      parts.push(`Puntos de atención: ${input.watchouts.join(' ')}`);
    }
    if (parts.length === 0) {
      return 'No hay datos suficientes en el periodo seleccionado para generar un resumen.';
    }
    return parts.join(' ');
  }
}
