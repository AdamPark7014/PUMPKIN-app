/**
 * Helpers de SEO y datos estructurados schema.org del storefront.
 *
 * Los constructores omiten claves vacías para no emitir JSON-LD con `null`,
 * que Google marca como advertencia en Rich Results.
 */

import type { EventDetail, EventListItem, SaleState, VenueDetail } from './storefront-types';

export type JsonLdValue =
  | string
  | number
  | boolean
  | JsonLdObject
  | readonly JsonLdValue[];

export type JsonLdObject = { [key: string]: JsonLdValue | undefined };

export const SITE_URL = (process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export const SITE_NAME = 'Pumpkin Zone';

/** Convierte una ruta relativa en URL absoluta; deja pasar URLs completas. */
export function absoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function canonical(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Elimina claves `undefined` de forma recursiva antes de serializar. */
function prune(value: JsonLdValue): JsonLdValue {
  if (Array.isArray(value)) {
    return value.map((v) => prune(v)).filter((v) => v !== undefined) as JsonLdValue[];
  }
  if (value && typeof value === 'object') {
    const out: JsonLdObject = {};
    for (const [key, raw] of Object.entries(value as JsonLdObject)) {
      if (raw === undefined) continue;
      const cleaned = prune(raw);
      if (cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/** Serializa JSON-LD escapando `<` para que no rompa el `<script>`. */
export function jsonLdString(data: JsonLdObject): string {
  return JSON.stringify(prune(data)).replace(/</g, '\\u003c');
}

const AVAILABILITY_BY_SALE_STATE: Readonly<Record<SaleState, string>> = {
  DRAFT: 'https://schema.org/PreOrder',
  ANNOUNCED: 'https://schema.org/PreOrder',
  PRESALE: 'https://schema.org/PreOrder',
  ON_SALE: 'https://schema.org/InStock',
  PAUSED: 'https://schema.org/LimitedAvailability',
  CLOSED: 'https://schema.org/SoldOut',
  CANCELLED: 'https://schema.org/SoldOut',
  PAST: 'https://schema.org/SoldOut',
};

const EVENT_STATUS_BY_SALE_STATE: Readonly<Record<SaleState, string>> = {
  DRAFT: 'https://schema.org/EventScheduled',
  ANNOUNCED: 'https://schema.org/EventScheduled',
  PRESALE: 'https://schema.org/EventScheduled',
  ON_SALE: 'https://schema.org/EventScheduled',
  PAUSED: 'https://schema.org/EventScheduled',
  CLOSED: 'https://schema.org/EventScheduled',
  CANCELLED: 'https://schema.org/EventCancelled',
  PAST: 'https://schema.org/EventScheduled',
};

function placeNode(venue: EventDetail['venue']): JsonLdObject | undefined {
  if (!venue) return undefined;
  return {
    '@type': 'Place',
    name: venue.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venue.address ?? undefined,
      addressLocality: venue.city,
      addressRegion: venue.state ?? undefined,
      postalCode: venue.postalCode ?? undefined,
      addressCountry: 'MX',
    },
    geo:
      venue.latitude != null && venue.longitude != null
        ? {
            '@type': 'GeoCoordinates',
            latitude: venue.latitude,
            longitude: venue.longitude,
          }
        : undefined,
  };
}

/**
 * `Event` con `AggregateOffer`. La disponibilidad sale del estado real de
 * venta y los precios de las ofertas publicadas; nunca se inventan.
 */
export function eventJsonLd(event: EventDetail): JsonLdObject {
  const prices = event.offers
    .map((o) => Number(o.basePrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const saleState: SaleState = event.sale?.state ?? 'ON_SALE';
  const start = new Date(event.startsAt);
  const end = event.endsAt
    ? new Date(event.endsAt)
    : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const url = canonical(`/events/${event.slug}`);
  const image = absoluteUrl(event.bannerImage || event.image);

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.description ?? undefined,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    eventStatus: EVENT_STATUS_BY_SALE_STATE[saleState],
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: image ? [image] : undefined,
    url,
    location: placeNode(event.venue),
    offers: prices.length
      ? {
          '@type': 'AggregateOffer',
          url,
          priceCurrency: event.currency || 'MXN',
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: event.offers.length,
          availability: AVAILABILITY_BY_SALE_STATE[saleState],
          validFrom: event.salesStartAt ?? undefined,
        }
      : undefined,
    organizer: event.organization?.name
      ? { '@type': 'Organization', name: event.organization.name }
      : undefined,
    performer: event.genre
      ? { '@type': 'PerformingGroup', name: event.title }
      : undefined,
  };
}

/** `BreadcrumbList` a partir de una ruta de migas ya resuelta. */
export function breadcrumbJsonLd(
  trail: readonly { name: string; path?: string }[],
): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.path ? canonical(crumb.path) : undefined,
    })),
  };
}

/** `ItemList` para hubs de categoría, ciudad y recinto. */
export function eventListJsonLd(
  events: readonly EventListItem[],
  listName: string,
): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    numberOfItems: events.length,
    itemListElement: events.map((event, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: canonical(`/events/${event.slug}`),
      name: event.title,
    })),
  };
}

/** `Place` para la ficha de recinto. */
export function venueJsonLd(venue: VenueDetail): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: venue.name,
    description: venue.description ?? undefined,
    url: canonical(`/venues/${venue.slug}`),
    image: absoluteUrl(venue.image),
    telephone: venue.phone ?? undefined,
    maximumAttendeeCapacity: venue.totalCapacity,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venue.address,
      addressLocality: venue.city,
      addressRegion: venue.state,
      postalCode: venue.postalCode ?? undefined,
      addressCountry: 'MX',
    },
    geo:
      venue.latitude != null && venue.longitude != null
        ? {
            '@type': 'GeoCoordinates',
            latitude: venue.latitude,
            longitude: venue.longitude,
          }
        : undefined,
  };
}

/** Enlace a Google Maps: coordenadas cuando existen, texto cuando no. */
export function mapsUrl(input: {
  name: string;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  if (input.latitude != null && input.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`;
  }
  const query = [input.name, input.address, input.city].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
