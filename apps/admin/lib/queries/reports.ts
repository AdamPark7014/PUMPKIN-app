'use client';

import { useQuery } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

/**
 * Reporte de ventas del evento. La API devuelve dos vistas según el rol:
 *  - `promoter`: boletos y ventas a valor nominal (`gross`). Sin cargos.
 *  - `internal`: además `serviceFees` (ingreso de la plataforma) y `total`.
 * Los campos opcionales sólo existen en la vista interna.
 */
export type SalesBucket = {
  orders: number;
  tickets: number;
  gross: number;
  serviceFees?: number;
  total?: number;
};

export type SalesReport = {
  range: { from: string; to: string };
  view: 'promoter' | 'internal';
  totals: SalesBucket;
  byChannel: Array<SalesBucket & { channel: string }>;
  byPaymentMethod: Array<SalesBucket & { paymentMethod: string }>;
  byTerminal: Array<SalesBucket & { terminalId: string; terminalName: string }>;
  byDay: Array<SalesBucket & { date: string }>;
};

export type ZReport = {
  sessionId: string;
  terminalName?: string;
  cashierId: string;
  endedAt?: string;
  report?: unknown;
};

export function useSalesReport(range: { from: string; to: string }) {
  const qs = new URLSearchParams({ from: range.from, to: range.to }).toString();
  return useQuery({
    queryKey: [...queryKeys.reports.sales(), range.from, range.to],
    queryFn: ({ signal }) => http<SalesReport>(`/admin/reports/sales?${qs}`, { signal }),
  });
}

export function useZReports(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.reports.zReports(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<ZReport[]>(`/taquilla/z-reports?organizationId=${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function exportSalesReport(organizationId: string, signal?: AbortSignal) {
  return http<string>(`/reports/export/sales/${organizationId}`, {
    responseType: 'text',
    signal,
  });
}
