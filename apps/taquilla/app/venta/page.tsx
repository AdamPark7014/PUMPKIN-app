'use client';

import { useState, Suspense, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getTaquillaToken } from '@/lib/auth';
import { PosSeatMap } from '@/components/PosSeatMap';
import { PosShell } from '@/components/PosShell';
import { enqueueSale } from '@/lib/offline-queue';
import {
  createPosHold,
  ensurePosSession,
  fetchReceipt,
  getCashierId,
  posCheckout,
  printReceipt,
  releasePosHolds,
  reserveLocalQuota,
  resolveOrgId,
  saveLastReceipt,
  syncInventoryCache,
  type OfflinePosPayload,
  type PosReceipt,
} from '@/lib/pos';
import styles from './venta.module.scss';

type Offer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

type MapData = {
  sections: { name?: string; zone?: string; price?: number; seats: { id: string; x: number; y: number; label?: string }[] }[];
};

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function VentaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const eventId = params.get('eventId') ?? '';
  const offerFromUrl = params.get('offerId') ?? '';
  const priceFromUrl = params.get('unitPrice');
  const compMode = params.get('comp') === '1';

  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'COMP'>(compMode ? 'COMP' : 'CASH');
  const [loading, setLoading] = useState(false);
  const [offerId, setOfferId] = useState(offerFromUrl);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [eventTitle, setEventTitle] = useState('');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [holdIds, setHoldIds] = useState<string[]>([]);
  const [holdExpiresAt, setHoldExpiresAt] = useState<Date | null>(null);
  const [ttlLeft, setTtlLeft] = useState(0);
  const [unitPrice, setUnitPrice] = useState(() => {
    const p = priceFromUrl ? Number(priceFromUrl) : 0;
    return Number.isFinite(p) && p > 0 ? p : 0;
  });
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [compReason, setCompReason] = useState('house');
  const [promoCode, setPromoCode] = useState('');
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [cardWaiting, setCardWaiting] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const holdRef = useRef<string[]>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!eventId) return;
    apiFetch('/discovery/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((events: { id: string; title: string; offers?: Offer[] }[]) => {
        const ev = events.find((e) => e.id === eventId);
        if (!ev) return;
        setEventTitle(ev.title);
        const list = (ev.offers || []).filter((o) => o.isAvailable !== false);
        setOffers(list);
        const fromUrl = offerFromUrl ? list.find((o) => o.id === offerFromUrl) : undefined;
        const selected = fromUrl || list[0];
        if (selected) {
          setOfferId(selected.id);
          setUnitPrice(Number(selected.basePrice));
        }
      })
      .catch((e: unknown) => {
        showToast(e instanceof Error ? e.message : 'No se pudieron cargar eventos');
      });

    apiFetch(`/inventory/${eventId}/map`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMapData(data))
      .catch((e: unknown) => {
        setMapData(null);
        showToast(e instanceof Error ? e.message : 'No se pudo cargar el mapa');
      });

    void syncInventoryCache(eventId);
  }, [eventId, offerFromUrl]);

  useEffect(() => {
    holdRef.current = holdIds;
  }, [holdIds]);

  useEffect(() => {
    return () => {
      if (holdRef.current.length) void releasePosHolds(holdRef.current);
    };
  }, []);

  useEffect(() => {
    if (!holdExpiresAt) {
      setTtlLeft(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((+holdExpiresAt - Date.now()) / 1000));
      setTtlLeft(left);
      if (left === 0 && holdIds.length) {
        setHoldIds([]);
        setHoldExpiresAt(null);
        showToast('Hold expirado');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, holdIds.length]);

  const seatMode = Boolean(mapData?.sections?.length);
  const ticketCount = seatMode ? selectedSeats.length || 0 : qty;
  const subtotal = ticketCount * unitPrice;
  const receivedNum = Number(cashReceived);
  const change =
    method === 'CASH' && Number.isFinite(receivedNum) && receivedNum >= subtotal
      ? receivedNum - subtotal
      : 0;
  const cashOk =
    method === 'COMP' ||
    method !== 'CASH' ||
    (Number.isFinite(receivedNum) && receivedNum >= subtotal && subtotal >= 0);

  async function ensureHolds() {
    if (holdIds.length) return holdIds;
    if (!seatMode || !selectedSeats.length) return [];
    const orgId = resolveOrgId();
    const { terminalId, sessionId } = await ensurePosSession(orgId, getCashierId());
    const hold = await createPosHold({
      terminalId,
      sessionId,
      eventId,
      offerId,
      seatIds: selectedSeats,
    });
    setHoldIds(hold.holdIds);
    setHoldExpiresAt(new Date(hold.expiresAt));
    return hold.holdIds;
  }

  const clearHolds = useCallback(async () => {
    if (holdIds.length) await releasePosHolds(holdIds);
    setHoldIds([]);
    setHoldExpiresAt(null);
  }, [holdIds]);

  const sell = useCallback(async () => {
    if (!eventId) {
      showToast('Selecciona un evento');
      router.push('/eventos');
      return;
    }
    if (!offerId) {
      showToast('Selecciona una zona');
      return;
    }
    if (seatMode && selectedSeats.length === 0) {
      showToast('Selecciona asientos');
      return;
    }
    if (method === 'CASH' && !cashOk) {
      showToast('Monto recibido insuficiente');
      return;
    }
    if (method === 'COMP' && !managerPin) {
      showToast('PIN de gerente requerido para cortesía');
      return;
    }

    setLoading(true);
    setReceipt(null);
    if (method === 'CARD') setCardWaiting(true);

    const clientSaleId = crypto.randomUUID();

    try {
      const orgId = resolveOrgId();
      const { terminalId, sessionId } = await ensurePosSession(orgId, getCashierId());
      let holds = holdIds;
      if (seatMode && !holds.length) {
        holds = await ensureHolds();
      }

      if (method === 'CARD') {
        await new Promise((r) => setTimeout(r, 800));
      }

      const result = await posCheckout({
        terminalId,
        sessionId,
        eventId,
        offerId,
        quantity: seatMode ? undefined : qty,
        seatIds: seatMode ? selectedSeats : undefined,
        holdIds: holds.length ? holds : undefined,
        paymentMethod: method,
        cashierId: getCashierId(),
        buyerName: buyerName.trim() || undefined,
        buyerEmail: buyerEmail.trim() || undefined,
        buyerPhone: buyerPhone.trim() || undefined,
        isComp: method === 'COMP',
        compReason,
        managerPin: method === 'COMP' ? managerPin : undefined,
        discountCode: promoCode || undefined,
        clientSaleId,
      });

      if (result.status !== 'COMPLETED' && method === 'CARD') {
        showToast(`Pago tarjeta pendiente: ${result.status}`);
      }

      setHoldIds([]);
      setHoldExpiresAt(null);
      const rec = await fetchReceipt(result.orderId, terminalId);
      setReceipt(rec);
      saveLastReceipt(rec);
      await printReceipt(rec);
      setCashReceived('');
      setSelectedSeats([]);
      } catch {
      if (!navigator.onLine) {
        const qtyNeeded = seatMode ? selectedSeats.length : qty;
        if (!reserveLocalQuota(eventId, qtyNeeded || 1)) {
          showToast('Sin cupo offline local — sincroniza inventario');
          setLoading(false);
          setCardWaiting(false);
          return;
        }
        try {
          const orgId = resolveOrgId();
          const { terminalId, sessionId } = await ensurePosSession(orgId, getCashierId());
          const payload: OfflinePosPayload = {
            type: 'pos',
            terminalId,
            sessionId,
            clientSaleId,
            checkoutData: {
              eventId,
              offerId,
              quantity: seatMode ? undefined : qty,
              seatIds: seatMode ? selectedSeats : undefined,
              paymentMethod: method === 'COMP' ? 'CASH' : method,
              cashierId: getCashierId(),
              buyerName: buyerName.trim() || undefined,
              buyerEmail: buyerEmail.trim() || undefined,
              buyerPhone: buyerPhone.trim() || undefined,
              clientSaleId,
            },
          };
          await enqueueSale(payload);
          showToast('Venta en cola offline');
          router.push('/');
        } catch {
          showToast('No se pudo registrar la venta');
        }
      } else {
        showToast('No se pudo registrar la venta');
      }
    } finally {
      setLoading(false);
      setCardWaiting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eventId,
    offerId,
    seatMode,
    selectedSeats,
    qty,
    method,
    cashOk,
    managerPin,
    holdIds,
    buyerName,
    buyerEmail,
    buyerPhone,
    compReason,
    promoCode,
    router,
    showToast,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (cardWaiting) {
          setCardWaiting(false);
          setLoading(false);
          showToast('Pago con tarjeta cancelado');
          return;
        }
        void clearHolds();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key !== 'F8' && e.key !== 'F9' && e.key !== 'F5') return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setMethod('CASH');
        void sell();
      } else if (e.key === 'F9') {
        e.preventDefault();
        setMethod('CARD');
        void sell();
      } else if (e.key === 'F5') {
        e.preventDefault();
        setMethod('COMP');
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void sell();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardWaiting, clearHolds, sell, showToast]);

  function toggleSeat(id: string) {
    setSelectedSeats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    void clearHolds();
  }

  return (
    <PosShell
      title={eventTitle || 'Cobrar'}
      eyebrow={`POS · ${seatMode ? 'Asientos' : 'Zona GA'}`}
      online={online}
      backHref="/eventos"
      wide
    >
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      {holdExpiresAt && ttlLeft > 0 && (
        <div className={styles.holdBanner}>
          Hold activo · {Math.floor(ttlLeft / 60)}:{String(ttlLeft % 60).padStart(2, '0')} ·{' '}
          <button type="button" onClick={() => void clearHolds()}>
            Liberar Esc
          </button>
        </div>
      )}

      {cardWaiting && (
        <div className={styles.cardWait} role="alertdialog" aria-live="assertive" aria-label="Esperando tarjeta">
          <div className={styles.cardWaitInner}>
            <span className={styles.cardPulse} aria-hidden />
            <strong>Terminal de tarjeta</strong>
            <p>Acerque, inserte o deslice la tarjeta Banorte…</p>
            <button
              type="button"
              className={styles.cardCancel}
              onClick={() => {
                setCardWaiting(false);
                setLoading(false);
                showToast('Pago con tarjeta cancelado');
              }}
            >
              Cancelar Esc
            </button>
          </div>
        </div>
      )}

      <div className={styles.grid3}>
        <section className={styles.col}>
          <h2>Zona</h2>
          <div className={styles.offerGrid}>
            {offers.map((o) => (
              <button
                key={o.id}
                type="button"
                className={offerId === o.id ? styles.offerActive : styles.offerBtn}
                onClick={() => {
                  setOfferId(o.id);
                  setUnitPrice(Number(o.basePrice));
                  void clearHolds();
                }}
              >
                <strong>{o.name || o.zone || 'General'}</strong>
                <span>
                  {money(Number(o.basePrice))}
                  {o.remainingQuantity != null ? ` · ${o.remainingQuantity}` : ''}
                </span>
              </button>
            ))}
          </div>

          {!seatMode && (
            <div className={styles.qtyRow}>
              <button type="button" onClick={() => setQty(Math.max(1, qty - 1))}>
                −
              </button>
              <div className={styles.qtyDisplay}>
                <strong>{qty}</strong>
              </div>
              <button type="button" onClick={() => setQty(qty + 1)}>
                +
              </button>
            </div>
          )}

          <div className={styles.buyerFields}>
            <input placeholder="Nombre" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            <input placeholder="Email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
            <input
              placeholder="Promo code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
            />
          </div>
        </section>

        <section className={styles.col}>
          <h2>{seatMode ? 'Mapa' : 'Cantidad'}</h2>
          {seatMode ? (
            <PosSeatMap
              eventId={eventId}
              mapData={mapData}
              selected={selectedSeats}
              onToggle={toggleSeat}
              offers={offers.map((o) => ({
                id: o.id,
                zone: o.zone || '',
                name: o.name,
                basePrice: o.basePrice,
              }))}
            />
          ) : (
            <p className={styles.focusHint}>Evento sin mapa — venta por oferta/zona.</p>
          )}
          {seatMode && selectedSeats.length > 0 && (
            <button type="button" className={styles.holdBtn} onClick={() => void ensureHolds()}>
              Reservar selección ({selectedSeats.length})
            </button>
          )}
        </section>

        <section className={styles.colTender}>
          <h2>Cobro</h2>
          <div className={styles.methods}>
            {(
              [
                { id: 'CASH' as const, label: 'Efectivo', hot: 'F8' },
                { id: 'CARD' as const, label: 'Tarjeta', hot: 'F9' },
                { id: 'COMP' as const, label: 'Cortesía', hot: 'F5' },
              ]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                className={method === m.id ? styles.methodActive : styles.method}
                onClick={() => setMethod(m.id)}
              >
                {m.label} <kbd>{m.hot}</kbd>
              </button>
            ))}
          </div>

          {method === 'CASH' && (
            <div className={styles.tender}>
              <label>
                <small>Recibido</small>
                <input
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
              </label>
              <div className={styles.changeBox}>
                <span>Cambio</span>
                <strong>{money(change)}</strong>
              </div>
            </div>
          )}

          {method === 'COMP' && (
            <div className={styles.buyerFields}>
              <select value={compReason} onChange={(e) => setCompReason(e.target.value)}>
                <option value="house">House</option>
                <option value="press">Press</option>
                <option value="artist">Artist</option>
              </select>
              <input
                type="password"
                placeholder="PIN gerente"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
              />
            </div>
          )}

          <div className={styles.summaryLines}>
            <div>
              <span>Boletos</span>
              <strong>× {ticketCount}</strong>
            </div>
            <div className={styles.total}>
              <span>TOTAL</span>
              <strong>{method === 'COMP' ? money(0) : money(subtotal)}</strong>
            </div>
          </div>

          <button
            type="button"
            className={styles.cobrar}
            disabled={loading || !eventId || !offerId || ticketCount < 1}
            onClick={() => void sell()}
          >
            {loading ? 'Procesando…' : 'Cobrar'}
          </button>

          {receipt && (
            <div className={styles.receipt}>
              <strong>✓ {receipt.receiptNumber}</strong>
              <p>
                {money(receipt.total)} · {receipt.quantity} boletos
              </p>
              <button type="button" onClick={() => void printReceipt(receipt)}>
                Reimprimir
              </button>
            </div>
          )}
        </section>
      </div>
    </PosShell>
  );
}

export default function VentaPage() {
  return (
    <Suspense>
      <VentaForm />
    </Suspense>
  );
}
