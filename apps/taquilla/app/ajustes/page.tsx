'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOrgId, getTaquillaToken, apiFetch } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import {
  connectSerialPrinter,
  getBridgeUrl,
  getSerialPort,
  isSerialSupported,
  printJobSafe,
  probeBridge,
  setBridgeUrl,
} from '@/lib/thermal';
import { buildTicketsJob } from '@/lib/ticket-print';
import styles from './ajustes.module.scss';

/** Boleto de prueba: valida QR, acentos y corte sin tocar ventas reales. */
function buildTestJob() {
  return buildTicketsJob(
    {
      receiptNumber: 'PRUEBA',
      timestamp: new Date().toISOString(),
      terminalId: 'test',
      eventName: 'Pumpkin Zone · Impresión de prueba',
      quantity: 1,
      subtotal: 0,
      fees: 0,
      taxes: 0,
      total: 0,
      paymentMethod: 'CASH',
      ticketCodes: [{ barcode: 'PRUEBA-QR-Ñ-ÁÉÍÓÚ', seatInfo: 'Entrada General' }],
    },
    { reprint: true, kickDrawer: false, withReceipt: false },
  );
}

export default function AjustesPage() {
  const router = useRouter();
  const [serialOk, setSerialOk] = useState(false);
  const [bridge, setBridge] = useState('');
  const [bridgeState, setBridgeState] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
    setSerialOk(Boolean(getSerialPort()));
    setBridge(getBridgeUrl() || 'http://127.0.0.1:9631');
  }, [router]);

  async function connectPrinter() {
    const ok = await connectSerialPrinter();
    setSerialOk(ok);
    setMsg(ok ? 'Impresora conectada' : 'No se pudo conectar (Chrome + USB)');
  }

  async function saveAndProbeBridge() {
    setBridgeUrl(bridge);
    setBridgeState('Probando…');
    const res = await probeBridge();
    if (res.ok && res.reachable) {
      setBridgeState('Puente e impresora en línea ✓');
    } else if (res.ok) {
      setBridgeState(
        'Puente responde, pero NO ve la impresora (revisa PRINTER_HOST y que esté encendida)',
      );
    } else {
      setBridgeState(
        `Sin conexión con el puente: ${res.error ?? 'verifica que esté corriendo en esta PC'}`,
      );
    }
  }

  async function testPrint() {
    setMsg('Imprimiendo prueba…');
    const job = buildTestJob();
    try {
      const via = await printJobSafe(job.bytes, job.fallbackText);
      setMsg(
        via === 'popup'
          ? 'Salió por ventana de respaldo (sin impresora térmica conectada)'
          : `Boleto de prueba impreso vía ${via === 'bridge' ? 'puente de red' : 'USB serial'} ✓`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo imprimir la prueba');
    }
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
        <p>
          Dos formas de conectar: <strong>puente de red</strong> (recomendada — impresora
          Ethernet y el programa puente corriendo en esta PC) o <strong>USB serial</strong>. Al
          imprimir se intenta USB, luego el puente, y al final una ventana de respaldo.
        </p>

        <h3>Puente de red (Epson Ethernet)</h3>
        <input
          type="url"
          placeholder="http://127.0.0.1:9631"
          value={bridge}
          onChange={(e) => setBridge(e.target.value)}
          aria-label="URL del puente de impresión"
        />
        <button type="button" onClick={() => void saveAndProbeBridge()}>
          Guardar y probar puente
        </button>
        {bridgeState && <p>{bridgeState}</p>}

        <h3>USB serial</h3>
        <p>Web Serial {isSerialSupported() ? 'disponible' : 'no disponible en este navegador'}.</p>
        <p>Estado: {serialOk ? 'conectada' : 'sin puerto'}</p>
        <button type="button" onClick={() => void connectPrinter()}>
          Conectar impresora USB
        </button>

        <h3>Prueba</h3>
        <p>Imprime un boleto de prueba con QR y acentos. No toca ninguna venta.</p>
        <button type="button" onClick={() => void testPrint()}>
          Imprimir boleto de prueba
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
