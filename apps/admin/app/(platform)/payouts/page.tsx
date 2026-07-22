'use client';

import { useEffect, useState } from 'react';
import { adminApi, getStoredToken } from '@/lib/api';
import styles from '../table.module.scss';
import platform from '../_styles/platform.module.scss';

type PayoutPayload = {
  byChannel: {
    channel: string;
    currency: string;
    _sum: { totalAmount: string | null; commissionAmount: string | null };
    _count: number;
  }[];
  payouts: {
    id: string;
    periodStart: string;
    periodEnd: string;
    grossRevenue: string | number;
    commission: string | number;
    netAmount: string | number;
    status: string;
    referenceId: string | null;
  }[];
};

export default function PayoutsPage() {
  const [data, setData] = useState<PayoutPayload>({ byChannel: [], payouts: [] });
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    const token = getStoredToken();
    if (!token) return;
    adminApi<PayoutPayload>('/admin/payouts', token).then(setData).catch(() => {});
  }

  useEffect(() => {
    reload();
  }, []);

  async function complete(id: string) {
    const token = getStoredToken();
    if (!token) return;
    const referenceId = window.prompt('Referencia SPEI / transferencia bancaria');
    if (!referenceId) return;
    setBusy(id);
    try {
      await adminApi(`/admin/payouts/${id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ referenceId }),
      });
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Liquidaciones</h1>
      <p className={styles.muted}>
        Ventas por canal y liquidaciones `PromoterPayout` (marcar COMPLETED solo tras SPEI real).
      </p>

      <h2 style={{ marginTop: '1.5rem' }}>Por canal</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Canal</th>
            <th>Moneda</th>
            <th>Órdenes</th>
            <th>Bruto</th>
            <th>Comisión</th>
            <th>Neto estimado</th>
          </tr>
        </thead>
        <tbody>
          {data.byChannel.map((r) => {
            const gross = Number(r._sum.totalAmount ?? 0);
            const comm = Number(r._sum.commissionAmount ?? 0);
            return (
              <tr key={`${r.channel}-${r.currency}`}>
                <td>{r.channel}</td>
                <td>{r.currency}</td>
                <td>{r._count}</td>
                <td>${gross.toLocaleString('es-MX')}</td>
                <td>${comm.toLocaleString('es-MX')}</td>
                <td>${(gross - comm).toLocaleString('es-MX')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ marginTop: '2rem' }}>Payouts a promotor</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Periodo</th>
            <th>Bruto</th>
            <th>Comisión</th>
            <th>Neto</th>
            <th>Estado</th>
            <th>Ref</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.payouts.map((p) => (
            <tr key={p.id}>
              <td>
                {new Date(p.periodStart).toLocaleDateString('es-MX')} –{' '}
                {new Date(p.periodEnd).toLocaleDateString('es-MX')}
              </td>
              <td>${Number(p.grossRevenue).toLocaleString('es-MX')}</td>
              <td>${Number(p.commission).toLocaleString('es-MX')}</td>
              <td>${Number(p.netAmount).toLocaleString('es-MX')}</td>
              <td>{p.status}</td>
              <td>{p.referenceId ?? '—'}</td>
              <td>
                {p.status !== 'COMPLETED' && (
                  <button
                    type="button"
                    className={platform.primaryBtn}
                    disabled={busy === p.id}
                    onClick={() => complete(p.id)}
                  >
                    Marcar pagado
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!data.payouts.length && (
            <tr>
              <td colSpan={7}>
                Sin payouts. Genera uno desde Analytics → settlement del mes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
