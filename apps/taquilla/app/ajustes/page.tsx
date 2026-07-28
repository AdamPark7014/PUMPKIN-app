'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOrgId, getTaquillaToken, apiFetch } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { connectSerialPrinter, getSerialPort, isSerialSupported } from '@/lib/thermal';
import styles from './ajustes.module.scss';

export default function AjustesPage() {
  const router = useRouter();
  const [serialOk, setSerialOk] = useState(false);
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
    setSerialOk(Boolean(getSerialPort()));
  }, [router]);

  async function connectPrinter() {
    const ok = await connectSerialPrinter();
    setSerialOk(ok);
    setMsg(ok ? 'Impresora conectada' : 'No se pudo conectar (Chrome + USB)');
  }

  async function savePin() {
    const orgId = getOrgId();
    if (!orgId || !pin) return;
    const res = await apiFetch('/taquilla/manager-pin', {
      method: 'POST',
      body: JSON.stringify({ organizationId: orgId, pin, currentPin: currentPin || undefined }),
    });
    setMsg(res.ok ? 'PIN actualizado' : await res.text());
  }

  return (
    <PosShell title="Ajustes" eyebrow="Terminal" backHref="/">
      {msg && <p className={styles.msg}>{msg}</p>}

      <section className={styles.section}>
        <h2>Impresora térmica</h2>
        <p>Web Serial {isSerialSupported() ? 'disponible' : 'no disponible en este navegador'}.</p>
        <p>Estado: {serialOk ? 'conectada' : 'sin puerto'}</p>
        <button type="button" onClick={() => void connectPrinter()}>
          Conectar impresora USB
        </button>
      </section>

      <section className={styles.section}>
        <h2>PIN de gerente</h2>
        <p>Requerido para anulaciones, cortesías y diferencias mayores a $50.</p>
        <input
          type="password"
          placeholder="PIN actual"
          value={currentPin}
          onChange={(e) => setCurrentPin(e.target.value)}
        />
        <input
          type="password"
          placeholder="Nuevo PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button type="button" onClick={() => void savePin()}>
          Guardar PIN
        </button>
      </section>
    </PosShell>
  );
}
