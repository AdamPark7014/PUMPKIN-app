'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  downloadEgressOverviewCsv,
  getEgressOverview,
  type EgressOverviewResponse,
  type EgressOverviewVenue,
} from '@/lib/platform-api';
import platform from '../../_styles/platform.module.scss';
import styles from './egress.module.scss';

type StatusFilter = 'all' | EgressOverviewVenue['status'];

const STATUS_LABEL: Record<EgressOverviewVenue['status'], string> = {
  ok: 'OK',
  warn: 'Alerta',
  critical: 'Crítico',
  'no-network': 'Sin red',
  empty: 'Vacío',
};

function fmtNum(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function statusClass(status: EgressOverviewVenue['status']) {
  if (status === 'ok') return styles.badgeOk;
  if (status === 'warn') return styles.badgeWarn;
  if (status === 'critical') return styles.badgeCritical;
  if (status === 'no-network') return styles.badgeNetwork;
  return styles.badgeEmpty;
}

export default function EgressOverviewPage() {
  const [data, setData] = useState<EgressOverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    const token = localStorage.getItem('boletera_token');
    if (!token) {
      setError('Inicia sesión para ver el dashboard');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      setData(await getEgressOverview(token));
    } catch {
      setError('No se pudo cargar el resumen de egress');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const list = data?.venues ?? [];
    if (filter === 'all') return list;
    return list.filter((v) => v.status === filter);
  }, [data, filter]);

  const counts = data?.counts;

  return (
    <div className={styles.wrap}>
      <header className={platform.pageHeader}>
        <div>
          <h1>Egress por venue</h1>
          <p>Salud de circulación y vaciado en todos los venues de la organización</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={platform.ghostBtn} onClick={() => void load()} disabled={loading}>
            Actualizar
          </button>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={exporting || !data}
            onClick={async () => {
              const token = localStorage.getItem('boletera_token');
              if (!token) return;
              try {
                setExporting(true);
                await downloadEgressOverviewCsv(token);
              } catch {
                setError('No se pudo exportar el CSV');
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.kpis}>
        <article>
          <span>OK</span>
          <strong>{counts?.ok ?? '—'}</strong>
        </article>
        <article className={styles.kpiWarn}>
          <span>Alertas</span>
          <strong>{counts?.warn ?? '—'}</strong>
        </article>
        <article className={styles.kpiCritical}>
          <span>Críticos</span>
          <strong>{counts?.critical ?? '—'}</strong>
        </article>
        <article>
          <span>Sin red / vacío</span>
          <strong>
            {counts == null ? '—' : (counts.noNetwork ?? 0) + (counts.empty ?? 0)}
          </strong>
        </article>
      </section>

      <div className={styles.filters}>
        {(
          [
            ['all', 'Todos'],
            ['critical', 'Críticos'],
            ['warn', 'Alertas'],
            ['ok', 'OK'],
            ['no-network', 'Sin red'],
            ['empty', 'Vacíos'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? styles.tabOn : styles.tab}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className={platform.panel}>
        {loading ? (
          <p className={styles.muted}>Analizando layouts…</p>
        ) : (
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Estado</th>
                <th>Venue</th>
                <th>Secciones</th>
                <th>Sin acceso</th>
                <th>Vaciado (min)</th>
                <th>Ruta máx.</th>
                <th>Bottleneck</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.venueId}>
                  <td>
                    <span className={`${styles.badge} ${statusClass(v.status)}`}>
                      {STATUS_LABEL[v.status]}
                    </span>
                    <div className={styles.reason}>{v.statusReason}</div>
                  </td>
                  <td>
                    <strong>{v.venueName}</strong>
                  </td>
                  <td>{v.sections}</td>
                  <td>{v.unreachable}</td>
                  <td>{fmtNum(v.clearanceMinutes)}</td>
                  <td>{fmtNum(v.maxPathLength, 0)}</td>
                  <td>
                    {v.topBottleneckUtilization != null
                      ? `${Math.round(v.topBottleneckUtilization * 100)}%`
                      : '—'}
                    {v.topBottleneckKind ? (
                      <span className={styles.muted}> · {v.topBottleneckKind}</span>
                    ) : null}
                  </td>
                  <td>
                    <Link href={`/venues/${v.venueId}/map`} className={platform.ghostBtn}>
                      Abrir mapa
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className={styles.muted}>
                    No hay venues en este filtro
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
        {data?.generatedAt ? (
          <p className={styles.footer}>
            Generado {new Date(data.generatedAt).toLocaleString('es-MX')}
          </p>
        ) : null}
      </section>
    </div>
  );
}
