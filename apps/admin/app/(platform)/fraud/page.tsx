'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { resolveFraudFlag } from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

interface FraudFlag {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
}

export default function FraudPage() {
  const [flags, setFlags] = useState<FraudFlag[]>([]);

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    adminApi<{ data: FraudFlag[] } | FraudFlag[]>('/fraud/flags?limit=50', token)
      .then((r) => setFlags(Array.isArray(r) ? r : (r.data ?? [])))
      .catch(() => {});
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Fraude y compliance</h1>
          <p>Alertas, revisión manual y resolución</p>
        </div>
      </header>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Severidad</th>
              <th>Score</th>
              <th>Estado</th>
              <th>Motivo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id}>
                <td>{f.type}</td>
                <td>{f.severity}</td>
                <td>{f.score}</td>
                <td>{f.status}</td>
                <td>{f.reason}</td>
                <td>
                  {f.status !== 'RESOLVED' && (
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      onClick={async () => {
                        const token = localStorage.getItem('boletera_token')!;
                        await resolveFraudFlag(token, f.id, 'Revisado y aprobado por admin');
                        reload();
                      }}
                    >
                      Resolver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!flags.length && <p style={{ marginTop: '1rem', color: '#737373' }}>Sin alertas activas.</p>}
      </section>
    </div>
  );
}
