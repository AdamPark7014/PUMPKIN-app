'use client';

import { useEffect, useState } from 'react';
import { getAuditLog } from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export default function AuditPage() {
  const orgId = useOrgId();
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    getAuditLog(token, orgId).then(setRows).catch(() => setRows([]));
  }, [orgId]);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Auditoría</h1>
          <p>Trail inmutable de acciones críticas — compliance y forensics</p>
        </div>
      </header>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString('es-MX')}</td>
                <td>{r.action}</td>
                <td>{r.entityType}</td>
                <td>
                  <code style={{ fontSize: '0.75rem' }}>{r.entityId.slice(0, 12)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p style={{ marginTop: '1rem', color: '#737373' }}>Sin eventos aún.</p>}
      </section>
    </div>
  );
}
