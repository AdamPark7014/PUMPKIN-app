'use client';

import {
  useState,
  Suspense,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useTransition,
  type FormEvent,
} from 'react';
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

type EventOption = {
  id: string;
  title: string;
  startsAt?: string;
  venueName?: string;
  offers?: Offer[];
};

type MapData = {
  sections: {
    name?: string;
    zone?: string;
    price?: number;
    seats: { id: string; x: number; y: number; label?: string }[];
  }[];
};

type PaymentMethod = 'CASH' | 'CARD' | 'COMP';
type ToastKind = 'info' | 'ok' | 'warn' | 'err';

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

function moneyShort(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatTtl(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function errMessage(e: unknown, fallback: string) {
  if (e instanceof Error && e.message.trim()) {
    const raw = e.message.trim();
    try {
      const parsed = JSON.parse(raw) as { message?: string | string[] };
      if (typeof parsed.message === 'string') return parsed.message;
      if (Array.isArray(parsed.message)) return parsed.message.join(', ');
    } catch {
      /* plain text */
    }
    return raw.slice(0, 240);
  }
  return fallback;
}

function VentaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const eventIdParam = params.get('eventId') ?? '';
  const offerFromUrl = params.get('offerId') ?? '';
  const priceFromUrl = params.get('unitPrice');
  const compMode = params.get('comp') === '1';

  const [eventId, setEventId] = useState(eventIdParam);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>(compMode ? 'COMP' : 'CASH');
  const [loading, setLoading] = useState(false);
  const [holding, setHolding] = useState(false);
  const [offerId, setOfferId] = useState(offerFromUrl);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [eventTitle, setEventTitle] = useState('');
  const [eventMeta, setEventMeta] = useState('');
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
  const [cardCancellable, setCardCancellable] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [, startTransition] = useTransition();

  const holdRef = useRef<string[]>([]);
  const holdingRef = useRef(false);
  const submittingRef = useRef(false);
  const selectionVersionRef = useRef(0);
  const paymentAttemptRef = useRef(0);
  const clientSaleIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string, kind: ToastKind = 'info') => {
    setToast({ msg, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      showToast('Conexión restaurada', 'ok');
    };
    const off = () => {
      setOnline(false);
      showToast('Sin conexión — ventas irán a cola offline', 'warn');
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [showToast]);

  useEffect(() => {
    if (eventIdParam) setEventId(eventIdParam);
  }, [eventIdParam]);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCatalogLoading(true);
    setLoadError(null);

    apiFetch('/discovery/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((raw: unknown) => {
        if (ac.signal.aborted) return;
        const list = (Array.isArray(raw) ? raw : []) as Array<{
          id: string;
          title: string;
          startsAt?: string;
          venue?: { name?: string };
          offers?: Offer[];
        }>;
        const mapped: EventOption[] = list.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          venueName: e.venue?.name,
          offers: e.offers,
        }));
        setEvents(mapped);

        const activeId = eventId || eventIdParam;
        if (!activeId) {
          setCatalogLoading(false);
          return;
        }
        const ev = mapped.find((e) => e.id === activeId);
        if (!ev) {
          setLoadError('Evento no encontrado en catálogo');
          setCatalogLoading(false);
          return;
        }
        setEventTitle(ev.title);
        const when = ev.startsAt
          ? new Date(ev.startsAt).toLocaleString('es-MX', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        setEventMeta([ev.venueName, when].filter(Boolean).join(' · '));
        const offerList = (ev.offers || []).filter(
          (o) => o.isAvailable !== false && o.remainingQuantity !== 0,
        );
        setOffers(offerList);
        const fromUrl = offerFromUrl ? offerList.find((o) => o.id === offerFromUrl) : undefined;
        const selected = fromUrl || offerList[0];
        if (selected) {
          setOfferId(selected.id);
          const nextPrice = Number(selected.basePrice);
          setUnitPrice(Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0);
        }
        setCatalogLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setCatalogLoading(false);
        setLoadError(errMessage(e, 'No se pudieron cargar eventos'));
        showToast(errMessage(e, 'No se pudieron cargar eventos'), 'err');
      });

    return () => ac.abort();
  }, [eventId, eventIdParam, offerFromUrl, showToast]);

  useEffect(() => {
    if (!eventId) {
      setMapData(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/inventory/${eventId}/map`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MapData | null) => {
        if (!cancelled) setMapData(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMapData(null);
        showToast(errMessage(e, 'No se pudo cargar el mapa'), 'warn');
      });
    void syncInventoryCache(eventId);
    return () => {
      cancelled = true;
    };
  }, [eventId, showToast]);

  useEffect(() => {
    holdRef.current = holdIds;
  }, [holdIds]);

  useEffect(() => {
    return () => {
      if (holdRef.current.length) void releasePosHolds(holdRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
      if (left === 0 && holdRef.current.length) {
        holdRef.current = [];
        setHoldIds([]);
        setHoldExpiresAt(null);
        showToast('Hold expirado — vuelve a reservar', 'warn');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, showToast]);

  const seatMode = Boolean(mapData?.sections?.some((s) => (s.seats?.length ?? 0) > 0));
  const ticketCount = seatMode ? selectedSeats.length : qty;
  const selectedOffer = useMemo(
    () => offers.find((o) => o.id === offerId) ?? null,
    [offers, offerId],
  );
  const remainingForOffer =
    selectedOffer?.remainingQuantity != null && Number.isFinite(selectedOffer.remainingQuantity)
      ? selectedOffer.remainingQuantity
      : null;
  const inventoryShortage =
    !seatMode && remainingForOffer != null && ticketCount > remainingForOffer;
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

  const mapOffers = useMemo(
    () =>
      offers.map((o) => ({
        id: o.id,
        zone: o.zone || '',
        name: o.name,
        basePrice: o.basePrice,
      })),
    [offers],
  );

  const quickCash = useMemo(() => {
    const base = [subtotal, Math.ceil(subtotal / 50) * 50, Math.ceil(subtotal / 100) * 100, 200, 500, 1000];
    const uniq = [...new Set(base.filter((n) => n > 0 && Number.isFinite(n)))].sort((a, b) => a - b);
    return uniq.slice(0, 5);
  }, [subtotal]);

  const clearHolds = useCallback(async () => {
    const ids = holdRef.current;
    holdRef.current = [];
    setHoldIds([]);
    setHoldExpiresAt(null);
    if (ids.length) {
      try {
        await releasePosHolds(ids);
      } catch {
        /* best-effort */
      }
    }
  }, []);

  const ensureHolds = useCallback(async () => {
    if (holdRef.current.length) return holdRef.current;
    if (!seatMode || !selectedSeats.length) return [];
    if (holdingRef.current) {
      throw new Error('La selección ya se está reservando');
    }
    const selectionVersion = selectionVersionRef.current;
    holdingRef.current = true;
    setHolding(true);
    try {
      const orgId = resolveOrgId();
      const { terminalId, sessionId } = await ensurePosSession(orgId, getCashierId());
      const hold = await createPosHold({
        terminalId,
        sessionId,
        eventId,
        offerId,
        seatIds: selectedSeats,
      });
      if (selectionVersion !== selectionVersionRef.current) {
        void releasePosHolds(hold.holdIds);
        throw new Error('La selección cambió durante el hold; vuelve a reservar');
      }
      setHoldIds(hold.holdIds);
      holdRef.current = hold.holdIds;
      setHoldExpiresAt(new Date(hold.expiresAt));
      showToast(`Hold · ${hold.holdIds.length} asiento(s)`, 'ok');
      return hold.holdIds;
    } catch (e: unknown) {
      showToast(errMessage(e, 'No se pudo crear hold'), 'err');
      throw e;
    } finally {
      holdingRef.current = false;
      setHolding(false);
    }
  }, [seatMode, selectedSeats, eventId, offerId, showToast]);

  const resetAfterSale = useCallback(() => {
    setCashReceived('');
    setSelectedSeats([]);
    setHoldIds([]);
    setHoldExpiresAt(null);
    holdRef.current = [];
    clientSaleIdRef.current = null;
    setManagerPin('');
  }, []);

  const sell = useCallback(async (requestedMethod?: PaymentMethod) => {
    if (submittingRef.current || loading) return;
    const activeMethod = requestedMethod ?? method;

    if (!eventId) {
      showToast('Selecciona un evento / función', 'warn');
      return;
    }
    if (!offerId) {
      showToast('Selecciona una zona', 'warn');
      return;
    }
    if (seatMode && selectedSeats.length === 0) {
      showToast('Selecciona asientos', 'warn');
      return;
    }
    if (!seatMode && qty < 1) {
      showToast('Cantidad inválida', 'warn');
      return;
    }
    if (inventoryShortage) {
      showToast(
        `Inventario insuficiente · quedan ${remainingForOffer ?? 0} en zona`,
        'warn',
      );
      return;
    }
    if (
      activeMethod === 'CASH' &&
      !(Number.isFinite(receivedNum) && receivedNum >= subtotal && subtotal >= 0)
    ) {
      showToast('Monto recibido insuficiente', 'warn');
      cashInputRef.current?.focus();
      return;
    }
    if (activeMethod === 'COMP' && !managerPin) {
      showToast('PIN de gerente requerido para cortesía', 'warn');
      return;
    }
    if (!online && activeMethod === 'CARD') {
      showToast('Tarjeta no disponible offline', 'err');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setReceipt(null);
    const paymentAttempt = ++paymentAttemptRef.current;
    if (activeMethod === 'CARD') {
      setCardCancellable(true);
      setCardWaiting(true);
    }

    const clientSaleId = clientSaleIdRef.current ?? crypto.randomUUID();
    clientSaleIdRef.current = clientSaleId;

    try {
      const orgId = resolveOrgId();
      const { terminalId, sessionId } = await ensurePosSession(orgId, getCashierId());
      let holds = holdRef.current;
      if (seatMode && !holds.length) {
        try {
          holds = await ensureHolds();
        } catch {
          return;
        }
      }

      if (activeMethod === 'CARD') {
        await new Promise<void>((r) => setTimeout(r, 800));
        if (paymentAttempt !== paymentAttemptRef.current) {
          clientSaleIdRef.current = null;
          return;
        }
        setCardCancellable(false);
      }

      const result = await posCheckout({
        terminalId,
        sessionId,
        eventId,
        offerId,
        quantity: seatMode ? undefined : qty,
        seatIds: seatMode ? selectedSeats : undefined,
        holdIds: holds.length ? holds : undefined,
        paymentMethod: activeMethod,
        cashierId: getCashierId(),
        buyerName: buyerName.trim() || undefined,
        buyerEmail: buyerEmail.trim() || undefined,
        buyerPhone: buyerPhone.trim() || undefined,
        isComp: activeMethod === 'COMP',
        compReason,
        managerPin: activeMethod === 'COMP' ? managerPin : undefined,
        discountCode: promoCode || undefined,
        clientSaleId,
      });

      if (result.status !== 'COMPLETED' && activeMethod === 'CARD') {
        showToast(`Pago pendiente (${result.status}). No repitas con otra venta.`, 'warn');
        return;
      }

      holdRef.current = [];
      setHoldIds([]);
      setHoldExpiresAt(null);
      const rec = await fetchReceipt(result.orderId, terminalId);
      setReceipt(rec);
      saveLastReceipt(rec);
      await printReceipt(rec);
      resetAfterSale();
      showToast(`Venta OK · ${rec.receiptNumber}`, 'ok');
    } catch (e: unknown) {
      if (!navigator.onLine && activeMethod !== 'CARD') {
        const qtyNeeded = seatMode ? selectedSeats.length : qty;
        if (!reserveLocalQuota(eventId, qtyNeeded || 1)) {
          showToast('Sin cupo offline local — sincroniza inventario', 'err');
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
              paymentMethod: activeMethod === 'COMP' ? 'CASH' : activeMethod,
              cashierId: getCashierId(),
              buyerName: buyerName.trim() || undefined,
              buyerEmail: buyerEmail.trim() || undefined,
              buyerPhone: buyerPhone.trim() || undefined,
              clientSaleId,
              isComp: activeMethod === 'COMP',
              compReason: activeMethod === 'COMP' ? compReason : undefined,
            },
          };
          await enqueueSale(payload);
          resetAfterSale();
          showToast('Venta en cola offline', 'warn');
          router.push('/');
        } catch (offlineErr: unknown) {
          showToast(errMessage(offlineErr, 'No se pudo encolar la venta'), 'err');
        }
      } else {
        showToast(
          activeMethod === 'CARD'
            ? 'No se confirmó la tarjeta. Reintenta: se conservará el mismo folio para evitar doble cobro.'
            : errMessage(e, 'No se pudo registrar la venta'),
          'err',
        );
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
      setCardWaiting(false);
      setCardCancellable(false);
    }
  }, [
    loading,
    eventId,
    offerId,
    seatMode,
    selectedSeats,
    qty,
    inventoryShortage,
    remainingForOffer,
    method,
    receivedNum,
    subtotal,
    managerPin,
    online,
    buyerName,
    buyerEmail,
    buyerPhone,
    compReason,
    promoCode,
    ensureHolds,
    resetAfterSale,
    router,
    showToast,
  ]);

  const cancelCard = useCallback(() => {
    if (!cardCancellable) return;
    paymentAttemptRef.current += 1;
    clientSaleIdRef.current = null;
    setCardCancellable(false);
    setCardWaiting(false);
    showToast('Lectura de tarjeta cancelada', 'warn');
  }, [cardCancellable, showToast]);

  const reserveSelection = useCallback(() => {
    void ensureHolds().catch(() => {
      /* ensureHolds reports the actionable error */
    });
  }, [ensureHolds]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (cardWaiting && cardCancellable) {
          cancelCard();
          return;
        }
        void clearHolds();
        return;
      }
      if (submittingRef.current || loading) return;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (inField && e.key !== 'F8' && e.key !== 'F9' && e.key !== 'F5' && e.key !== 'F6') return;

      if (e.key === 'F8') {
        e.preventDefault();
        setMethod('CASH');
        void sell('CASH');
      } else if (e.key === 'F9') {
        e.preventDefault();
        setMethod('CARD');
        void sell('CARD');
      } else if (e.key === 'F5') {
        e.preventDefault();
        setMethod('COMP');
      } else if (e.key === 'F6') {
        e.preventDefault();
        if (seatMode && selectedSeats.length) reserveSelection();
      } else if (e.key === 'Enter' && !inField) {
        e.preventDefault();
        void sell();
      } else if (e.key === '+' || e.key === '=') {
        if (!seatMode) {
          e.preventDefault();
          setQty((q) =>
            remainingForOffer != null ? Math.min(remainingForOffer, q + 1) : q + 1,
          );
        }
      } else if (e.key === '-' || e.key === '_') {
        if (!seatMode) {
          e.preventDefault();
          setQty((q) => Math.max(1, q - 1));
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    cardWaiting,
    cardCancellable,
    cancelCard,
    clearHolds,
    sell,
    loading,
    seatMode,
    selectedSeats.length,
    remainingForOffer,
    reserveSelection,
  ]);

  const toggleSeat = useCallback(
    (id: string) => {
      selectionVersionRef.current += 1;
      startTransition(() => {
        setSelectedSeats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      });
      void clearHolds();
    },
    [clearHolds],
  );

  const selectEvent = useCallback(
    (id: string) => {
      selectionVersionRef.current += 1;
      setEventId(id);
      setSelectedSeats([]);
      setOfferId('');
      setReceipt(null);
      void clearHolds();
      const url = new URLSearchParams({ eventId: id });
      router.replace(`/venta?${url.toString()}`);
    },
    [clearHolds, router],
  );

  const selectOffer = useCallback(
    (o: Offer) => {
      selectionVersionRef.current += 1;
      setOfferId(o.id);
      const nextPrice = Number(o.basePrice);
      setUnitPrice(Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0);
      void clearHolds();
    },
    [clearHolds],
  );

  const canCharge =
    Boolean(eventId && offerId && ticketCount >= 1) &&
    !loading &&
    !holding &&
    !inventoryShortage &&
    (online || method !== 'CARD') &&
    (method !== 'CASH' || cashOk) &&
    (method !== 'COMP' || Boolean(managerPin));

  const onSubmitGuard = (e: FormEvent) => {
    e.preventDefault();
    void sell();
  };

  return (
    <PosShell
      title={eventTitle || 'Cobrar'}
      eyebrow={`POS · ${seatMode ? 'Asientos' : 'Zona GA'}${online ? '' : ' · OFFLINE'}`}
      online={online}
      backHref="/eventos"
      wide
    >
      {toast && (
        <p
          className={`${styles.toast} ${styles[`toast_${toast.kind}`]}`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </p>
      )}

      {!online && (
        <div className={styles.offlineBanner} role="status">
          Modo offline — efectivo/cola local. Tarjeta deshabilitada.
        </div>
      )}

      {loadError && (
        <div className={styles.loadError} role="alert">
          {loadError}
        </div>
      )}

      {(holdExpiresAt && ttlLeft > 0) || holding ? (
        <div className={`${styles.holdBanner} ${holding ? styles.holdBusy : ''}`} role="status">
          {holding ? (
            <>Creando hold…</>
          ) : (
            <>
              Hold activo · {formatTtl(ttlLeft)} ·{' '}
              <button type="button" onClick={() => void clearHolds()}>
                Liberar Esc
              </button>
            </>
          )}
        </div>
      ) : null}

      {cardWaiting && (
        <div className={styles.cardWait} role="alertdialog" aria-live="assertive" aria-label="Esperando tarjeta">
          <div className={styles.cardWaitInner}>
            <span className={styles.cardPulse} aria-hidden />
            <strong>Terminal de tarjeta</strong>
            <p>
              {cardCancellable
                ? 'Acerque, inserte o deslice la tarjeta…'
                : 'Pago enviado. No cierres ni repitas el cobro.'}
            </p>
            {cardCancellable ? (
              <button type="button" className={styles.cardCancel} onClick={cancelCard}>
                Cancelar Esc
              </button>
            ) : (
              <span className={styles.paymentCommitted} role="status">
                Confirmando pago…
              </span>
            )}
          </div>
        </div>
      )}

      <form className={styles.grid3} onSubmit={onSubmitGuard} aria-busy={loading || holding}>
        <section className={styles.col} aria-label="Evento y zona">
          <h2>Evento / función</h2>
          {!eventId ? (
            <div className={styles.eventPick}>
              {catalogLoading ? (
                <p className={styles.focusHint}>Cargando funciones…</p>
              ) : events.length === 0 ? (
                <p className={styles.focusHint}>Sin eventos. Ve a Eventos.</p>
              ) : (
                <ul className={styles.eventList}>
                  {events.slice(0, 12).map((ev) => (
                    <li key={ev.id}>
                      <button type="button" className={styles.offerBtn} onClick={() => selectEvent(ev.id)}>
                        <strong>{ev.title}</strong>
                        <span>
                          {[
                            ev.venueName,
                            ev.startsAt
                              ? new Date(ev.startsAt).toLocaleString('es-MX', {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.eventChip}>
              <div>
                <strong>{eventTitle || 'Evento'}</strong>
                {eventMeta ? <span>{eventMeta}</span> : null}
              </div>
              <button
                type="button"
                className={styles.changeEvent}
                onClick={() => {
                  selectionVersionRef.current += 1;
                  setEventId('');
                  setOffers([]);
                  setMapData(null);
                  setSelectedSeats([]);
                  setOfferId('');
                  void clearHolds();
                  router.replace('/venta');
                }}
              >
                Cambiar
              </button>
            </div>
          )}

          <h2>Zona</h2>
          <div className={styles.offerGrid} role="listbox" aria-label="Zonas">
            {offers.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={offerId === o.id}
                aria-label={`${o.name || o.zone || 'General'}, ${money(Number(o.basePrice))}${
                  o.remainingQuantity != null ? `, ${o.remainingQuantity} disponibles` : ''
                }`}
                className={offerId === o.id ? styles.offerActive : styles.offerBtn}
                onClick={() => selectOffer(o)}
              >
                <strong>{o.name || o.zone || 'General'}</strong>
                <span>
                  {moneyShort(Number(o.basePrice))} MXN
                  {o.remainingQuantity != null
                    ? ` · ${o.remainingQuantity} disp.`
                    : ''}
                </span>
              </button>
            ))}
            {!catalogLoading && eventId && offers.length === 0 && (
              <p className={styles.focusHint}>Sin zonas disponibles</p>
            )}
          </div>

          {!seatMode && eventId && (
            <>
              <div className={styles.qtyRow} aria-label="Cantidad">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                >
                  −
                </button>
                <div className={styles.qtyDisplay}>
                  <strong>{qty}</strong>
                  <span>boletos</span>
                </div>
                <button
                  type="button"
                  aria-label="Más"
                  disabled={remainingForOffer != null && qty >= remainingForOffer}
                  onClick={() =>
                    setQty((q) =>
                      remainingForOffer != null ? Math.min(remainingForOffer, q + 1) : q + 1,
                    )
                  }
                >
                  +
                </button>
              </div>
              {remainingForOffer != null && (
                <p
                  className={inventoryShortage ? styles.invWarn : styles.invHint}
                  role="status"
                >
                  Disponibles en zona: {remainingForOffer}
                  {inventoryShortage ? ' · reduce la cantidad' : ''}
                </p>
              )}
            </>
          )}

          <div className={styles.buyerFields}>
            <input
              placeholder="Nombre"
              value={buyerName}
              autoComplete="name"
              onChange={(e) => setBuyerName(e.target.value)}
            />
            <input
              placeholder="Email"
              type="email"
              value={buyerEmail}
              autoComplete="email"
              onChange={(e) => setBuyerEmail(e.target.value)}
            />
            <input
              placeholder="Promo code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
            />
          </div>
        </section>

        <section className={styles.col} aria-label="Mapa o cantidad">
          <h2>{seatMode ? 'Mapa' : 'Cantidad'}</h2>
          {seatMode ? (
            <PosSeatMap
              eventId={eventId}
              mapData={mapData}
              selected={selectedSeats}
              onToggle={toggleSeat}
              offers={mapOffers}
            />
          ) : (
            <p className={styles.focusHint}>Evento sin mapa — venta por oferta/zona.</p>
          )}
          {seatMode && selectedSeats.length > 0 && (
            <button
              type="button"
              className={styles.holdBtn}
              disabled={holding || loading}
              onClick={reserveSelection}
            >
              {holding ? 'Reservando…' : `Reservar selección (${selectedSeats.length}) · F6`}
            </button>
          )}
        </section>

        <section className={`${styles.colTender} ${styles.stickyTender}`} aria-label="Cobro">
          <h2>Cobro</h2>
          <div className={styles.methods} role="group" aria-label="Método de pago">
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
                disabled={loading || (!online && m.id === 'CARD')}
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
                <small>Recibido (MXN)</small>
                <input
                  ref={cashInputRef}
                  aria-label="Monto recibido en pesos mexicanos"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
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

          {method === 'CASH' && subtotal > 0 && (
            <div className={styles.quickCash} role="group" aria-label="Montos rápidos">
              {quickCash.map((n) => (
                <button key={n} type="button" onClick={() => setCashReceived(String(n))}>
                  {moneyShort(n)}
                </button>
              ))}
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
                autoComplete="off"
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
            <div>
              <span>P. unitario</span>
              <strong>{money(unitPrice)}</strong>
            </div>
            <div className={styles.total}>
              <span>TOTAL</span>
              <strong>{method === 'COMP' ? money(0) : money(subtotal)}</strong>
            </div>
          </div>

          <button
            type="submit"
            className={styles.cobrar}
            disabled={!canCharge}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} aria-hidden />
                Procesando…
              </>
            ) : (
              <>
                Cobrar
                <small>Enter</small>
              </>
            )}
          </button>
          {!canCharge && !loading && (
            <p className={styles.chargeHint} role="status">
              {!eventId
                ? 'Selecciona una función'
                : !offerId
                  ? 'Selecciona una zona'
                  : ticketCount < 1
                    ? seatMode
                      ? 'Selecciona al menos un asiento'
                      : 'Agrega al menos un boleto'
                    : inventoryShortage
                      ? `Solo hay ${remainingForOffer ?? 0} disponibles`
                      : method === 'CASH' && !cashOk
                        ? 'Captura un monto recibido suficiente'
                        : method === 'COMP' && !managerPin
                          ? 'Captura el PIN de gerente'
                          : !online && method === 'CARD'
                            ? 'Tarjeta no disponible sin conexión'
                            : holding
                              ? 'Reservando inventario…'
                              : 'Cobro temporalmente no disponible'}
            </p>
          )}

          {receipt && (
            <div className={styles.receipt} role="status">
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
      </form>

      <div className={styles.mobileSticky} aria-hidden={false}>
        <div>
          <span>
            ×{ticketCount}
            {!online ? ' · OFFLINE' : ''}
            {holdExpiresAt && ttlLeft > 0 ? ` · hold ${formatTtl(ttlLeft)}` : ''}
          </span>
          <strong>{method === 'COMP' ? money(0) : money(subtotal)}</strong>
        </div>
        <button
          type="button"
          disabled={!canCharge}
          aria-busy={loading}
          onClick={() => void sell()}
        >
          {loading ? '…' : 'Cobrar'}
        </button>
      </div>
    </PosShell>
  );
}

export default function VentaPage() {
  return (
    <Suspense fallback={<PosShell title="Cobrar" eyebrow="POS" backHref="/eventos" wide><p>Cargando…</p></PosShell>}>
      <VentaForm />
    </Suspense>
  );
}
