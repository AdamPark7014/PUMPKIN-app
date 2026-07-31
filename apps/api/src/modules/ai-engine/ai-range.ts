import { BadRequestException } from '@nestjs/common';
import type { MetricsDateRange } from '@boletera/shared';

const MX_TZ = 'America/Mexico_City';

export type AiResolvedRange = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
};

export function resolveAiRange(from?: string, to?: string): AiResolvedRange {
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(end.getTime())) {
    throw new BadRequestException('Parámetro "to" inválido');
  }
  let start: Date;
  if (from) {
    start = new Date(from);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Parámetro "from" inválido');
    }
  } else {
    start = startOfMonthMexico(end);
  }
  if (start >= end) {
    throw new BadRequestException('"from" debe ser anterior a "to"');
  }
  const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxSpanMs) {
    throw new BadRequestException('El rango máximo permitido es 366 días');
  }
  const span = end.getTime() - start.getTime();
  const previousTo = new Date(start);
  const previousFrom = new Date(start.getTime() - span);
  return {
    from: start,
    to: end,
    previousFrom,
    previousTo,
    dateRange: { from: start.toISOString(), to: end.toISOString() },
    comparisonRange: {
      from: previousFrom.toISOString(),
      to: previousTo.toISOString(),
    },
  };
}

function startOfMonthMexico(ref: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MX_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ref);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  return new Date(Date.UTC(y, m - 1, 1, 6, 0, 0));
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
