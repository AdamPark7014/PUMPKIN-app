'use client';

import { useEffect, useState } from 'react';
import {
  listWaitlistByOrg,
  notifyWaitlistBatch,
  type WaitlistRow,
} from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

export default function WaitlistPage() {
  const orgId = useOrgId();
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    listWaitlistByOrg(token, orgId).then(setRows).catch(() => setRows([]));
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  const byEvent = rows.reduce<Record<string, WaitlistRow[]>>((acc, r) => {
    const id = r.event.id;
    if (!acc[id]) acc[id] = [];
    acc[id].push(r);
    return acc;
  }, {});

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Lista de espera</h1>
          <p>Fans en cola cuando el evento está agotado — notificación masiva al liberar cupo</p>
        </div>
      </header>

      {Object.entries(byEvent).map(([eventId, entries]) => (
        <section key={eventId} className={platform.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>{entries[0]?.event.title}</h2>
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={busy === eventId}
              onClick={async () => {
                const token = localStorage.getItem('boletera_token')!;
                setBusy(eventId);
                try {
                  await notifyWaitlistBatch(token, eventId);
                  reload();
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === eventId ? 'Enviando…' : 'Notificar lote'}
            </button>
          </div>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.email}</td>
                  <td>{e.quantity}</td>
                  <td>{e.status}</td>
                  <td>{new Date(e.createdAt).toLocaleString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {!rows.length && (
        <p style={{ color: '#737373' }}>Sin registros en lista de espera para tu organización.</p>
      )}
    </div>
  );
}
