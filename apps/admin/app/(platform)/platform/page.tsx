'use client';

import { useEffect, useState } from 'react';
import { getSaasCapabilities, type SaasCapabilities } from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

export default function PlatformCapabilitiesPage() {
  const orgId = useOrgId();
  const [data, setData] = useState<SaasCapabilities | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    getSaasCapabilities(token, orgId).then(setData).catch(() => {});
  }, [orgId]);

  const modules = data ? Object.entries(data.modules) : [];
  const active = modules.filter(([, v]) => v).length;

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Plataforma Boletera</h1>
          <p>
            Matriz de capacidades vs Palco4 · Pasco · NewTicket — {data?.organization.name ?? '…'}
          </p>
        </div>
        {data && (
          <div className={platform.kpiRow}>
            <div className={platform.kpi}>
              <span>Módulos activos</span>
              <strong>
                {active}/{modules.length}
              </strong>
            </div>
            <div className={platform.kpi}>
              <span>Waitlist pendiente</span>
              <strong>{data.metrics.waitlistPending}</strong>
            </div>
            <div className={platform.kpi}>
              <span>API keys</span>
              <strong>{data.metrics.apiKeys}</strong>
            </div>
          </div>
        )}
      </header>

      <section className={platform.panel}>
        <h2>Módulos habilitados</h2>
        <div className={platform.chipGrid}>
          {modules.map(([key, on]) => (
            <span key={key} className={on ? platform.chipOn : platform.chipOff}>
              {key.replace(/([A-Z])/g, ' $1').trim()}
            </span>
          ))}
        </div>
      </section>

      <section className={platform.panel} style={{ marginTop: '1.25rem' }}>
        <h2>Roadmap (supera competencia)</h2>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Estado</th>
              <th>Prioridad</th>
            </tr>
          </thead>
          <tbody>
            {(data?.roadmap ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{r.status}</td>
                <td>{r.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
