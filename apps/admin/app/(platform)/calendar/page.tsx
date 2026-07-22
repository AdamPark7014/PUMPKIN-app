'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEventCalendar } from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

export default function CalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [calendar, setCalendar] = useState<Record<string, { id: string; title: string; startTime: string; venue: string; status: string }[]>>({});
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    getEventCalendar(token, month, year).then((data) => {
      setCalendar(data.calendar as typeof calendar);
      setTotal(data.totalEvents);
    });
  }, [month, year]);

  const days = Object.keys(calendar).sort();

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Calendario</h1>
          <p>{total} eventos en el mes</p>
        </div>
        <Link href="/events/new" className={platform.primaryBtn}>
          + Programar
        </Link>
      </header>

      <section className={platform.panel}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i).toLocaleString('es-MX', { month: 'long' })}
              </option>
            ))}
          </select>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>

        {days.length === 0 ? (
          <p style={{ color: '#737373' }}>Sin eventos este mes.</p>
        ) : (
          days.map((day) => (
            <div key={day} style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '0.875rem', color: '#102a43', marginBottom: '0.5rem' }}>{day}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {calendar[day].map((ev) => (
                  <li
                    key={ev.id}
                    style={{
                      padding: '0.5rem 0.75rem',
                      border: '1px solid #e5e5e5',
                      borderRadius: 8,
                      marginBottom: '0.35rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      <strong>{ev.startTime}</strong> — {ev.title} @ {ev.venue}
                    </span>
                    <Link href={`/events/${ev.id}`} className={platform.ghostBtn}>
                      Abrir
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
