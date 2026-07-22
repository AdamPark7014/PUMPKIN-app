'use client';

import { useEffect, useState } from 'react';
import {
  listEvents,
  listCampaigns,
  createCampaign,
  publishCampaignApi,
  exportPresaleCodes,
} from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

export default function CampaignsPage() {
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [campaigns, setCampaigns] = useState<
    { id: string; name: string; type: string; status: string; allocation: number; discountValue: number }[]
  >([]);
  const [form, setForm] = useState({
    name: '',
    type: 'presale',
    discountValue: 15,
    allocation: 100,
    quantityPerUser: 4,
    startsAt: '',
    endsAt: '',
  });

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    listEvents(token).then((list) => {
      setEvents(list);
      if (list[0]) setEventId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    listCampaigns(token, eventId).then(setCampaigns);
  }, [eventId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    const org = localStorage.getItem('boletera_org');
    if (!token || !org || !eventId) return;
    await createCampaign(token, org, eventId, {
      ...form,
      discountType: 'percentage',
      startsAt: new Date(form.startsAt),
      endsAt: new Date(form.endsAt),
    });
    listCampaigns(token, eventId).then(setCampaigns);
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Campañas y presales</h1>
          <p>Presale, early bird, VIP — códigos y promociones por evento</p>
        </div>
      </header>

      <section className={platform.panel}>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Evento
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            style={{ display: 'block', marginTop: '0.35rem', width: '100%', maxWidth: 400 }}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </select>
        </label>

        <form className={platform.formGrid} onSubmit={handleCreate}>
          <label className={platform.full}>
            Nombre
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Tipo
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="presale">Presale</option>
              <option value="early_bird">Early bird</option>
              <option value="vip">VIP</option>
              <option value="group">Grupal</option>
            </select>
          </label>
          <label>
            Descuento %
            <input
              type="number"
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
            />
          </label>
          <label>
            Cupo
            <input
              type="number"
              value={form.allocation}
              onChange={(e) => setForm({ ...form, allocation: Number(e.target.value) })}
            />
          </label>
          <label>
            Inicio
            <input
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </label>
          <label>
            Fin
            <input
              type="datetime-local"
              required
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          <div className={platform.full}>
            <button type="submit" className={platform.primaryBtn}>
              Crear campaña
            </button>
          </div>
        </form>
      </section>

      <section className={platform.panel}>
        <h2>Campañas activas</h2>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Cupo</th>
              <th>Desc.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.type}</td>
                <td>{c.status}</td>
                <td>{c.allocation}</td>
                <td>{c.discountValue}%</td>
                <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {c.status === 'DRAFT' && (
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      onClick={async () => {
                        const token = localStorage.getItem('boletera_token')!;
                        await publishCampaignApi(token, c.id);
                        listCampaigns(token, eventId).then(setCampaigns);
                      }}
                    >
                      Publicar
                    </button>
                  )}
                  {c.type === 'presale' && (
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      onClick={async () => {
                        const token = localStorage.getItem('boletera_token')!;
                        const csv = await exportPresaleCodes(token, c.id);
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `presale-${c.id}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      CSV códigos
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: '#737373' }}>
                  Sin campañas para este evento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
