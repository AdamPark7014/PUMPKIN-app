'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, getStoredToken } from '@/lib/api';
import { CameraScanner } from './CameraScanner';
import styles from './scanner.module.scss';

const QUEUE_KEY = 'boletera_offline_scans';

type QueuedScan = { id: string; raw: string; at: string };

function readQueue(): QueuedScan[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as QueuedScan[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedScan[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export default function ScannerPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{
    success: boolean;
    ticket?: { code: string; eventTitle: string };
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);

  const flushQueue = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !navigator.onLine) return;
    const items = readQueue();
    if (!items.length) return;
    const remaining: QueuedScan[] = [];
    for (const item of items) {
      try {
        const payload = item.raw.trim().startsWith('{')
          ? { qrPayload: item.raw.trim() }
          : { ticketCode: item.raw.trim() };
        await adminApi('/access/scan', token, {
          method: 'POST',
          body: JSON.stringify({ ...payload, scannedBy: 'admin-scanner', channel: 'ADMIN' }),
        });
      } catch {
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    setQueued(remaining.length);
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQueue().length);
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    if (navigator.onLine) void flushQueue();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue]);

  const runScan = useCallback(
    async (raw: string) => {
      const token = getStoredToken();
      if (!token || !raw.trim()) return;
      setLoading(true);
      setError('');
      setResult(null);

      if (!navigator.onLine) {
        const q = readQueue();
        q.push({ id: crypto.randomUUID(), raw: raw.trim(), at: new Date().toISOString() });
        writeQueue(q);
        setQueued(q.length);
        setResult({ success: true, ticket: { code: raw.trim(), eventTitle: 'En cola offline' } });
        setCode('');
        setLoading(false);
        return;
      }

      try {
        const payload = raw.trim().startsWith('{')
          ? { qrPayload: raw.trim() }
          : { ticketCode: raw.trim() };
        const res = await adminApi<{
          success: boolean;
          ticket?: { code: string; eventTitle: string };
        }>('/access/scan', token, {
          method: 'POST',
          body: JSON.stringify({ ...payload, scannedBy: 'admin-scanner', channel: 'ADMIN' }),
        });
        setResult(res);
        setCode('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Escaneo rechazado');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  async function scan() {
    await runScan(code);
  }

  return (
    <div className={styles.page}>
      <h1>Scanner de acceso</h1>
      <p className={styles.hint}>
        {online ? 'En línea' : 'Offline — los escaneos se encolan'}
        {queued > 0 ? ` · ${queued} en cola` : ''}
      </p>
      <CameraScanner onScan={runScan} disabled={loading} />
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Código BLT-… o payload JSON del QR"
        rows={4}
      />
      <button type="button" onClick={scan} disabled={loading || !code.trim()}>
        {loading ? 'Validando…' : 'Validar entrada'}
      </button>
      {queued > 0 && online && (
        <button type="button" onClick={() => void flushQueue()} style={{ marginLeft: 8 }}>
          Sincronizar cola
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
      {result?.success && (
        <div className={styles.ok}>
          <strong>✓ Acceso permitido</strong>
          <p>{result.ticket?.eventTitle}</p>
          <code>{result.ticket?.code}</code>
        </div>
      )}
    </div>
  );
}
