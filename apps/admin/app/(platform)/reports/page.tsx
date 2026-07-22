'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { getSettlementReport, type SettlementReport } from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

export default function ReportsPage() {
  const [rows, setRows] = useState<
    { channel: string; _sum: { totalAmount: string | null }; _count: number }[]
  >([]);
  const [settlement, setSettlement] = useState<SettlementReport | null>(null);
  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    adminApi<typeof rows>('/admin/reports/sales', token).then(setRows);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    const org = localStorage.getItem('boletera_org');
    if (!token || !org) return;
    getSettlementReport(token, org, period).then(setSettlement).catch(() => setSettlement(null));
  }, [period]);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Reportes</h1>
          <p>Ventas por canal y liquidación a promotores</p>
        </div>
        <button
          type="button"
          className={platform.primaryBtn}
          onClick={async () => {
            const token = localStorage.getItem('boletera_token');
            const org = localStorage.getItem('boletera_org');
            if (!token || !org) return;
            const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
            const res = await fetch(`${API}/reports/export/sales/${org}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const csv = await res.text();
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ventas-${org}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Exportar CSV
        </button>
      </header>

      <section className={platform.panel}>
        <h2>Ventas por canal</h2>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Canal</th>
              <th>Órdenes</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel}>
                <td>{r.channel}</td>
                <td>{r._count}</td>
                <td>${r._sum.totalAmount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={platform.panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0 }}>Liquidación</h2>
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="DAILY">Diaria</option>
            <option value="WEEKLY">Semanal</option>
            <option value="MONTHLY">Mensual</option>
          </select>
        </div>
        {settlement?.summary ? (
          <div className={platform.cardGrid} style={{ marginTop: '1rem' }}>
            <article className={platform.statCard}>
              <span>Bruto</span>
              <strong>${settlement.summary.grossRevenue?.toLocaleString() ?? 0}</strong>
            </article>
            <article className={platform.statCard}>
              <span>Comisión</span>
              <strong>${settlement.summary.commission?.toLocaleString() ?? 0}</strong>
            </article>
            <article className={platform.statCard}>
              <span>Neto</span>
              <strong>${settlement.summary.netRevenue?.toLocaleString() ?? 0}</strong>
            </article>
            <article className={platform.statCard}>
              <span>Órdenes</span>
              <strong>{settlement.summary.totalOrders ?? 0}</strong>
            </article>
          </div>
        ) : (
          <p style={{ color: '#737373', marginTop: '1rem' }}>Sin datos de liquidación para el periodo.</p>
        )}
        {settlement?.paymentMethods && (
          <table className={platform.table} style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Gateway</th>
                <th>Transacciones</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(settlement.paymentMethods).map(([gw, v]) => (
                <tr key={gw}>
                  <td>{gw}</td>
                  <td>{v.count}</td>
                  <td>${v.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}


