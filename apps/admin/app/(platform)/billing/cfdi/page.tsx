'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  getFiscalProfile,
  listCfdiInvoices,
  stampCfdi,
  upsertFiscalProfile,
} from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

export default function CfdiBillingPage() {
  const orgId = useOrgId();
  const [rfc, setRfc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cp, setCp] = useState('');
  const [invoices, setInvoices] = useState<
    {
      id: string;
      uuid: string | null;
      serie: string;
      folio: number;
      status: string;
      receptorRfc: string;
      total: string | number;
      stampedAt: string | null;
    }[]
  >([]);
  const [orderId, setOrderId] = useState('');
  const [receptorRfc, setReceptorRfc] = useState('XAXX010101000');
  const [receptorNombre, setReceptorNombre] = useState('PUBLICO EN GENERAL');
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    getFiscalProfile(token, orgId)
      .then((p) => {
        if (!p) return;
        setRfc(p.rfc);
        setLegalName(p.legalName);
        setCp(p.codigoPostal);
      })
      .catch(() => {});
    listCfdiInvoices(token, orgId).then(setInvoices).catch(() => setInvoices([]));
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    await upsertFiscalProfile(token, orgId, {
      rfc,
      legalName,
      codigoPostal: cp,
      pacMode: 'sandbox',
    });
    setMsg('Perfil fiscal guardado (modo sandbox)');
    reload();
  }

  async function onStamp(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    const res = await stampCfdi(token, orgId, {
      orderId,
      receptorRfc,
      receptorNombre,
    });
    setMsg(`CFDI timbrado: ${(res as { uuid?: string }).uuid ?? 'ok'} (sandbox)`);
    reload();
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>CFDI 4.0</h1>
          <p>Perfil fiscal del emisor y timbrado sandbox por orden completada</p>
        </div>
      </header>

      {msg && (
        <section className={platform.panel}>
          <p>{msg}</p>
        </section>
      )}

      <section className={platform.panel}>
        <h2>Perfil fiscal (emisor)</h2>
        <form onSubmit={saveProfile} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
          <input
            value={rfc}
            onChange={(e) => setRfc(e.target.value)}
            placeholder="RFC"
            required
          />
          <input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Razón social"
            required
          />
          <input
            value={cp}
            onChange={(e) => setCp(e.target.value)}
            placeholder="Código postal"
            required
          />
          <button type="submit" className={platform.primaryBtn}>
            Guardar perfil
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <h2>Timbrar orden</h2>
        <form onSubmit={onStamp} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Order ID (cuid)"
            required
          />
          <input
            value={receptorRfc}
            onChange={(e) => setReceptorRfc(e.target.value)}
            placeholder="RFC receptor"
            required
          />
          <input
            value={receptorNombre}
            onChange={(e) => setReceptorNombre(e.target.value)}
            placeholder="Nombre receptor"
            required
          />
          <button type="submit" className={platform.primaryBtn}>
            Timbrar (sandbox)
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <h2>Facturas recientes</h2>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Folio</th>
              <th>UUID</th>
              <th>Receptor</th>
              <th>Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  {inv.serie}-{inv.folio}
                </td>
                <td style={{ fontSize: '0.75rem' }}>{inv.uuid}</td>
                <td>{inv.receptorRfc}</td>
                <td>{String(inv.total)}</td>
                <td>{inv.status}</td>
              </tr>
            ))}
            {!invoices.length && (
              <tr>
                <td colSpan={5}>Sin CFDIs aún</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
