# TicketOS storefront conventions (apps/web)

Shared rules for every Commerce subagent. Follow these so the storefront feels like one product.

## Scope

- Write ONLY inside `apps/web/`.
- NEVER edit `apps/web/app/page.tsx` or `apps/web/components/EventDiscoveryPanel.tsx` (or their SCSS).
- NEVER edit `apps/api/`, `apps/admin/`, `apps/taquilla/`, `apps/worker/`, or anything in `packages/`.
- No new npm dependencies. TypeScript strict. No `any`. No stubs. No TODO comments.

## Shared modules (already created — USE THEM)

| Module | Purpose |
|---|---|
| `lib/format.ts` | `money`, `moneyExact`, `fullDate`, `dateTime`, `longDateTime`, `countdown`, `categoryLabel`, `orderStatusLabel`, `TIME_ZONE=America/Mexico_City` |
| `lib/api.ts` | `api` (no-store, throws `ApiError`), `apiCached`/`apiCachedSafe` (SSR catalog only), `API_BASE`, `REVALIDATE`, `errorMessage` |
| `lib/seo.ts` | `SITE_URL`, `canonical`, `absoluteUrl`, `eventJsonLd`, `breadcrumbJsonLd`, `eventListJsonLd`, `venueJsonLd`, `mapsUrl`, `jsonLdString` |
| `lib/storefront-types.ts` | Typed API contracts (`EventDetail`, `OrderDetail`, `CartPricing`, `SaleStateInfo`, …) |
| `lib/checkout-guards.ts` | `validateCheckoutForm`, `buildIdempotencySeed`, `newIdempotencyKey`, `paymentErrorMessage` |
| `lib/cart-store.ts` | Zustand cart (existing — keep contracts) |
| `lib/auth.ts` | Token helpers (existing) |
| `styles/_media.scss` | `@use '../../styles/media' as m;` → `m.md`, `m.lg`, `m.below-md`, `m.shell`, `m.visually-hidden`, `m.tap-target` |
| `app/globals.css` | Design tokens (`--ink-*`, `--accent`, `--space-*`, `--text-*`, `--shell-max`, `--buybar-height`) |
| `components/storefront/*` | `JsonLd`, `Breadcrumbs`, `PurchaseSteps`, `TrustRow`, `PriceBreakdown`, `AvailabilityBadge`, `EventCard` |

## Visual / UX

- Locale `es-MX`, currency `MXN`, timezone `America/Mexico_City` for every date.
- Mobile-first. Touch targets ≥ 44px. Use `m.tap-target`.
- Honest urgency only: `AvailabilityBadge` when `remainingQuantity` is a real number from the API. Never invent scarcity/prices.
- Transparent fees: always show `PriceBreakdown` from `/pricing/calculate-cart` before pay.
- Trust copy via `TrustRow` + helpers (`TRUST_OFFICIAL`, `TRUST_QR`, `trustPayment(demo)`, `trustTransfer(allowed)`).
- Funnel progress via `PurchaseSteps` (`cart` → `checkout` → `tickets`).
- Layout already renders `SiteFooter` and `CartBar`. Do NOT render a second `<SiteFooter />` in pages.
- Skip link + `#contenido` already in root layout.
- Brand: ink/paper + accent rose `#e11d48`. Heading font Bebas Neue, body Space Grotesk.

## Data / API

- Consume existing endpoints only. Do not invent fields.
- Catalog SSR: prefer `apiCached` / `apiCachedSafe` with `REVALIDATE.event|listing|facets`.
- Money path (availability, holds, orders, payments): always `api` / `fetch` with `cache: 'no-store'`.
- Guest checkout is required: OptionalJwt on `POST /orders` — never force login to pay.
- Holds: `POST /inventory/holds`, `POST /inventory/holds/best-available`. Show `HoldCountdown` from real `expiresAt`.
- Idempotency: send `Idempotency-Key` header on `POST /orders`. Reuse one key per attempt via `buildIdempotencySeed` + `newIdempotencyKey`. Prevent double-submit with a ref/lock while `loading`.
- Payment methods: CARD / SPEI / OXXO. Honor `/payments/config` demo flag — never claim a real charge in demo.

## Performance / SEO

- Prefer Server Components. Mark `'use client'` only when needed (maps, forms, timers, auth).
- Dynamic-import heavy clients (`SeatMapViewer`, `@boletera/venue-3d`) with `next/dynamic` + `ssr: false` where appropriate.
- Emit JSON-LD via `<JsonLd data={…} />` and breadcrumbs via `<Breadcrumbs trail={…} />`.
- `generateMetadata` with OpenGraph, Twitter, canonical on every public page.
- No client waterfalls for initial catalog data — fetch in the server page.

## Accessibility

- Spanish labels, `aria-live` on hold timers and payment errors.
- Keyboard seat selection must remain possible (list/tray even when GPU map is pointer-driven).
- `lang="es-MX"` is set on `<html>`.

## SeatMapViewer decision (owner: SeatMap agent)

- ADOPT `@boletera/venue-engine/render` → `SeatMapRenderer` (WebGL2 instancing + Canvas2D fallback).
- ALWAYS call `renderer.destroy()` on unmount.
- Keep toolbar / legend / selection tray / live availability SSE. Move seat paint off the DOM.
- Preserve public props: `eventId`, `mapData`, `selected`, `onToggle`, `onClear`, `offers`, `maxSelect`, `currency`, `heatDefault`, `focusZone`, and exports `SelectedSeatInfo`, `primaryOfferIdFromSelection`, `selectionTotal`.

## Ownership (exclusive file sets)

1. **SeatMap** — `components/SeatMapViewer.tsx`, `components/SeatMapViewer.module.scss`, optional `components/seatmap/**`
2. **Event purchase** — `app/events/[slug]/**`, `components/ZoneOfferButtons.*`, `components/WaitlistSignup.tsx`
3. **Cart + checkout** — `app/cart/**`, `app/checkout/**`, `components/HoldCountdown.*`, `components/CartBar.*`, `lib/cart-store.ts`, `lib/checkout-guards.ts`
4. **Post-purchase** — `app/orders/**`, `components/OrderQrCards.*`, `components/SimulateDemoPaymentButton.*`
5. **Account** — `app/cuenta/**`
6. **Secondary discovery** — `app/categoria/**`, `app/ciudades/**`, `app/venues/**`, `app/hub.module.scss`, `app/events/page.tsx`
7. **Auth** — `app/login/**`, `lib/auth.ts`

Shared foundation (`lib/format|api|seo|storefront-types`, `components/storefront/**`, `styles/_media.scss`, `app/layout.tsx`, `app/globals.css`) is owned by the coordinator — do not rewrite; only import.
