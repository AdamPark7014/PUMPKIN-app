/**
 * Contratos de la API pública que consume el storefront.
 *
 * Estos tipos describen respuestas reales de `apps/api` (discovery, inventory,
 * pricing, orders, payments). No se inventan campos: todo lo que aquí aparece
 * lo devuelve el backend hoy. Los campos opcionales lo son porque el backend
 * puede omitirlos según el endpoint.
 */

// ---------------------------------------------------------------------------
// Ventana de venta
// ---------------------------------------------------------------------------

export type SaleState =
  | 'DRAFT'
  | 'ANNOUNCED'
  | 'PRESALE'
  | 'ON_SALE'
  | 'PAUSED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'PAST';

export type SalePhaseKind = 'PRESALE' | 'MEMBERS' | 'PUBLIC' | 'LAST_MINUTE' | 'DOOR';

/** `sale` que devuelven `/discovery/events` y `/discovery/events/:slug`. */
export type SaleStateInfo = {
  state: SaleState;
  canPurchase: boolean;
  requiresCode: boolean;
  nextChangeAt: string | null;
  activePhase: { id: string; name: string; kind: SalePhaseKind } | null;
};

export const SALE_STATE_MESSAGE: Readonly<Record<SaleState, string>> = {
  DRAFT: 'Este evento aún no está publicado.',
  ANNOUNCED: 'Anunciado. La venta abre pronto.',
  PRESALE: 'Preventa en curso.',
  ON_SALE: 'Boletos en venta.',
  PAUSED: 'La venta está pausada temporalmente.',
  CLOSED: 'La venta en línea ya cerró.',
  CANCELLED: 'Este evento fue cancelado.',
  PAST: 'Este evento ya se realizó.',
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type VenueSummary = {
  id?: string;
  slug?: string;
  name: string;
  city: string;
  state?: string | null;
  address?: string | null;
};

export type OfferSummary = {
  id: string;
  zone: string;
  name?: string | null;
  basePrice: string;
  remainingQuantity?: number | null;
  isAvailable?: boolean;
};

/** Fila de `/discovery/events`. */
export type EventListItem = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  posterAspect?: string | null;
  startsAt: string;
  endsAt?: string | null;
  doorsAt?: string | null;
  status?: string;
  sale?: SaleStateInfo;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
  category?: string | null;
  genre?: string | null;
  currency: string;
  minPrice: number | string;
  maxPrice?: number | null;
  venue?: VenueSummary | null;
  organization?: { id?: string; name: string } | null;
  offerCount?: number;
  offers?: OfferSummary[];
};

/** Respuesta de `/discovery/events/:slug`. */
export type EventDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt?: string | null;
  doorsAt?: string | null;
  status?: string;
  sale?: SaleStateInfo;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
  category?: string | null;
  genre?: string | null;
  rating?: string | null;
  currency?: string;
  image?: string | null;
  bannerImage?: string | null;
  posterAspect?: string | null;
  metadata?: { posterAspect?: string } | null;
  allowResale?: boolean;
  transferAllowed?: boolean;
  refundable?: boolean;
  nonTransferable?: boolean;
  holdExpiration?: number;
  maxTicketsPerOrder?: number | null;
  seatMap: { snapshotData: unknown } | null;
  offers: OfferSummary[];
  venue?: {
    id?: string;
    slug?: string;
    name: string;
    city: string;
    state?: string | null;
    address?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    website?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  organization?: { name: string } | null;
  series?: { id: string; name: string; kind: string } | null;
};

/** Fila de `/discovery/venues`. */
export type VenueListItem = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

/** Respuesta de `/discovery/venues/:slug`. */
export type VenueDetail = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  website?: string | null;
  image?: string | null;
  totalCapacity?: number;
  events: EventListItem[];
};

/** Respuesta de `/discovery/facets`. */
export type DiscoveryFacets = {
  cities: { name: string; count: number }[];
  categories: { key: string; count: number }[];
};

// ---------------------------------------------------------------------------
// Inventario y holds
// ---------------------------------------------------------------------------

export type SeatAvailabilityStatus = 'available' | 'held' | 'sold' | 'blocked';

/** Respuesta de `/inventory/:eventId/availability` y del stream SSE. */
export type AvailabilitySnapshot = {
  tickets?: { seatId?: string | null; status?: string }[];
};

/** Respuesta de `/inventory/holds` y `/inventory/holds/best-available`. */
export type HoldResponse = {
  holds: { id: string; seatId?: string | null }[];
  expiresAt?: string;
  seats?: {
    label?: string;
    section?: string;
    row?: string;
    seatNumber?: string;
  }[];
};

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

/** Respuesta de `/pricing/calculate-cart`. Todos los montos son strings decimales. */
export type CartPricing = {
  subtotal: string;
  fees: string;
  taxes: string;
  total: string;
  discount: string;
};

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

export type PaymentMethodId = 'CARD' | 'SPEI' | 'OXXO';

/** Respuesta de `/payments/config`. */
export type GatewayConfig = {
  settlement: string;
  demo: boolean;
  mode?: 'demo' | 'live';
  productionReady?: boolean;
  buyerNote?: string;
  accountClabeMasked?: string | null;
};

export type PaymentAction = {
  gateway: string;
  intentId: string;
  redirectUrl?: string;
  reference?: string;
  metadata?: {
    type?: string;
    clabe?: string;
    concept?: string;
    reference?: string;
    demo?: boolean;
  };
  status: string;
};

// ---------------------------------------------------------------------------
// Órdenes y boletos
// ---------------------------------------------------------------------------

export type OrderStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'FAILED';

export type OrderTicket = {
  id?: string;
  code: string;
  status?: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

export type OrderItem = {
  id?: string;
  quantity?: number;
  unitPrice?: string;
  subtotal?: string;
  offer?: { name?: string | null; zone?: string } | null;
  tickets: OrderTicket[];
};

/** Respuesta de `/orders/:publicId`. */
export type OrderDetail = {
  id: string;
  publicId: string;
  status: OrderStatus | string;
  subtotal?: string;
  fees?: string;
  taxes?: string;
  discountAmount?: string;
  totalAmount: string;
  currency: string;
  createdAt?: string;
  buyerName?: string;
  buyerEmail?: string;
  paymentMethod?: string | null;
  event?: {
    id?: string;
    title: string;
    slug: string;
    startsAt: string;
    endsAt?: string | null;
    image?: string | null;
    bannerImage?: string | null;
    category?: string | null;
    venue?: {
      name: string;
      city: string;
      address?: string | null;
    } | null;
  } | null;
  items: OrderItem[];
  pendingPayment?: {
    reference?: string | null;
    metadata?: {
      clabe?: string;
      concept?: string;
      type?: string;
      reference?: string;
      demo?: boolean;
      /** Mercado Pago: init_point para retomar el pago. */
      redirectUrl?: string;
    } | null;
  } | null;
};

/** Fila de `/orders/mine`. */
export type OrderListItem = {
  id: string;
  publicId: string;
  status: OrderStatus | string;
  totalAmount: string;
  currency?: string;
  createdAt: string;
  event: {
    title: string;
    slug: string;
    startsAt: string;
    category?: string | null;
    image?: string | null;
    bannerImage?: string | null;
    venue?: { name: string; city: string } | null;
  };
  organizationId?: string;
  items?: OrderItem[];
};

/** Respuesta de `/orders/:publicId/qrcodes`. */
export type OrderQrCodes = {
  eventTitle: string;
  tickets: {
    id: string;
    code: string;
    qrPayload: string;
    qrDataUrl?: string;
    section?: string | null;
    row?: string | null;
    seatNumber?: string | null;
  }[];
};

/** Fila de `/tickets/transfer/mine` (`sent` y `received`). */
export type TicketTransfer = {
  id: string;
  transferCode: string;
  toEmail: string;
  status: string;
  createdAt?: string;
  ticket: {
    id?: string;
    code: string;
    event: { title: string; slug?: string; startsAt?: string };
  };
};

export type TicketTransferInbox = {
  sent: TicketTransfer[];
  received: TicketTransfer[];
};
