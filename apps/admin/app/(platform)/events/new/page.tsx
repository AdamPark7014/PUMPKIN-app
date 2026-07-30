'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createEvent, createEventSeries, createResidency, listVenues } from '@/lib/platform-api';
import platform from '../../_styles/platform.module.scss';

const STEPS = ['Datos', 'Venue / mapa', 'Ofertas / precios', 'Publicar'] as const;

export default function NewEventPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'single' as 'single' | 'series' | 'residency',
    startDate: '',
    venueId: '',
    capacity: 5000,
    basePrice: 150,
    zoneName: 'General',
    publishNow: false,
    seriesCount: 3,
    residencyCount: 8,
    frequency: 'weekly' as 'daily' | 'weekly' | 'biweekly' | 'monthly',
  });

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    listVenues(token).then(setVenues).catch(() => setVenues([]));
  }, []);

  function canNext() {
    if (step === 0) return Boolean(form.title && form.startDate);
    if (step === 1) return Boolean(form.venueId && form.capacity > 0);
    if (step === 2) return form.basePrice >= 0 && Boolean(form.zoneName);
    return true;
  }

  async function submit() {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    setSaving(true);
    try {
      if (form.type === 'series') {
        const dates = Array.from({ length: form.seriesCount }, (_, i) => {
          const d = new Date(form.startDate);
          d.setDate(d.getDate() + i * 7);
          return {
            date: d.toISOString(),
            title: `${form.title} — fecha ${i + 1}`,
            capacity: form.capacity,
            basePrice: form.basePrice,
          };
        });
        const result = await createEventSeries(token, {
          seriesName: form.title,
          description: form.description,
          venueId: form.venueId,
          occurrences: dates,
        });
        setMsg(`Serie creada: ${result.totalEvents} eventos`);
        router.push('/events');
        return;
      }

      if (form.type === 'residency') {
        const result = await createResidency(token, {
          name: form.title,
          venueId: form.venueId,
          startDate: form.startDate,
          frequency: form.frequency,
          occurrenceCount: form.residencyCount,
          capacity: form.capacity,
          basePrice: form.basePrice,
        });
        setMsg(`Residencia creada: ${result.totalEvents} fechas`);
        router.push('/events');
        return;
      }

      const event = await createEvent(token, {
        title: form.title,
        description: form.description,
        type: form.type,
        startDate: form.startDate,
        venueId: form.venueId,
        capacity: form.capacity,
        basePrice: form.basePrice,
      });
      router.push(`/events/${event.id}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Nuevo evento</h1>
          <p>
            Paso {step + 1} de {STEPS.length}: {STEPS[step]}
          </p>
        </div>
        <Link href="/events" className={platform.ghostBtn}>
          ← Volver
        </Link>
      </header>

      {msg && (
        <p role="status" style={{ marginBottom: '1rem', color: '#9a3412' }}>
          {msg}
        </p>
      )}

      <ol
        style={{
          display: 'flex',
          gap: '0.5rem',
          listStyle: 'none',
          padding: 0,
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        {STEPS.map((label, i) => (
          <li
            key={label}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 999,
              fontSize: '0.8125rem',
              background: i === step ? '#18181b' : i < step ? '#3f3f46' : '#f4f4f5',
              color: i <= step ? '#fff' : '#71717a',
            }}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className={platform.panel}>
        <div className={platform.formGrid}>
          {step === 0 && (
            <>
              <label className={platform.full}>
                Título
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label className={platform.full}>
                Descripción
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label>
                Tipo
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value as typeof form.type })
                  }
                >
                  <option value="single">Single</option>
                  <option value="series">Serie (múltiples fechas)</option>
                  <option value="residency">Residencia (recurrente)</option>
                </select>
              </label>
              <label>
                Fecha inicio
                <input
                  type="datetime-local"
                  required
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </label>
              {form.type === 'series' && (
                <label>
                  Nº de fechas
                  <input
                    type="number"
                    min={2}
                    max={52}
                    value={form.seriesCount}
                    onChange={(e) => setForm({ ...form, seriesCount: Number(e.target.value) })}
                  />
                </label>
              )}
              {form.type === 'residency' && (
                <>
                  <label>
                    Frecuencia
                    <select
                      value={form.frequency}
                      onChange={(e) =>
                        setForm({ ...form, frequency: e.target.value as typeof form.frequency })
                      }
                    >
                      <option value="weekly">Semanal</option>
                      <option value="biweekly">Quincenal</option>
                      <option value="monthly">Mensual</option>
                      <option value="daily">Diaria</option>
                    </select>
                  </label>
                  <label>
                    Nº de funciones
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={form.residencyCount}
                      onChange={(e) => setForm({ ...form, residencyCount: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <label className={platform.full}>
                Venue
                <select
                  required
                  value={form.venueId}
                  onChange={(e) => setForm({ ...form, venueId: e.target.value })}
                >
                  <option value="">Seleccionar…</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Capacidad
                <input
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
                />
              </label>
              <p className={platform.full} style={{ color: '#737373', fontSize: '0.875rem' }}>
                El mapa de asientos se configura en el detalle del evento tras crearlo.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <label>
                Zona / oferta
                <input
                  value={form.zoneName}
                  onChange={(e) => setForm({ ...form, zoneName: e.target.value })}
                />
              </label>
              <label>
                Precio base (MXN)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.basePrice}
                  onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })}
                />
              </label>
            </>
          )}

          {step === 3 && (
            <div className={platform.full}>
              <h2 style={{ marginTop: 0 }}>Checklist antes de crear</h2>
              <ul style={{ lineHeight: 1.7 }}>
                <li>
                  <strong>{form.title || '—'}</strong> ({form.type})
                </li>
                <li>Inicio: {form.startDate || '—'}</li>
                <li>
                  Venue: {venues.find((v) => v.id === form.venueId)?.name || '—'} ·{' '}
                  {form.capacity} lugares
                </li>
                <li>
                  Oferta {form.zoneName}: ${form.basePrice} MXN
                </li>
              </ul>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.publishNow}
                  onChange={(e) => setForm({ ...form, publishNow: e.target.checked })}
                />
                Ir a configurar publicación al terminar
              </label>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          {step > 0 && (
            <button type="button" className={platform.ghostBtn} onClick={() => setStep((s) => s - 1)}>
              Atrás
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={!canNext()}
              onClick={() => setStep((s) => s + 1)}
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={saving || !canNext()}
              onClick={submit}
            >
              {saving ? 'Creando…' : 'Crear evento'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
