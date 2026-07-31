# Referencia de la API REST — Boletera

Documentación derivada de los controladores NestJS en `apps/api/src/`. Cada ruta listada existe en un `.controller.ts` real. Prefijo global: `api/v1` (`apps/api/src/main.ts`).

| Recurso | Ruta |
|---|---|
| Base local | `http://localhost:4000/api/v1` |
| Swagger UI | `http://localhost:4000/api/docs` |
| Arquitectura | [../arquitectura.md](../arquitectura.md) |
| ADRs | [../adr/](../adr/) |
| Guía nuevo endpoint | [../guias/nuevo-endpoint-api.md](../guias/nuevo-endpoint-api.md) |
| Multi-tenant | [../guias/consultas-multi-tenant.md](../guias/consultas-multi-tenant.md) |
| Ciclo de vida | [../dominio/ciclo-de-vida.md](../dominio/ciclo-de-vida.md) |
| Glosario | [../dominio/glosario.md](../dominio/glosario.md) |
| README monorepo | [../../README.md](../../README.md) |
| Migración de seguridad (auth) | [../../apps/api/src/modules/auth/SECURITY-MIGRATION.md](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md) |
| Módulo Metrics (exhaustivo) | [metricas.md](./metricas.md) |

---

## 1. Convenciones

### Base URL y versionado

- Prefijo global: `api/v1` (`app.setGlobalPrefix('api/v1')`).
- Swagger montado en `/api/docs` (sin el prefijo `v1`).
- Partner API pública usa además el segmento `partner/v1` → ruta completa `/api/v1/partner/v1/...`.

### Autenticación

Ver el contrato completo en [SECURITY-MIGRATION.md](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md). Resumen operativo:

| Mecanismo | Detalle |
|---|---|
| Cookies httpOnly | `boletera_access` (15 min), `boletera_refresh` (30 días). Emitidas en login/register/OAuth/refresh. |
| CSRF double-submit | Cookie legible `boletera_csrf` → header `X-CSRF-Token` en `POST`/`PUT`/`PATCH`/`DELETE` cuando `authSource === 'cookie'` (`JwtAuthGuard`). |
| Bearer transitorio | `Authorization: Bearer <jwt>` sigue soportado; no persistir el token en clientes nuevos. |
| Partner API | Header `X-Api-Key: blk_…` (o `Authorization: Bearer blk_…`). Ver [§ Partner API pública](#4-partner-api-pública). |

### Formato de error

`AllExceptionsFilter` (`apps/api/src/common/http-exception.filter.ts`) responde siempre:

```json
{
  "statusCode": 400,
  "message": "string | string[]",
  "correlationId": "uuid-or-client-supplied"
}
```

- `HttpException` conocidos: conservan su status; el `message` se sanitiza (arrays de strings de validación se preservan).
- Errores ≥ 500 conocidos: mensaje público fijo `"Internal server error"`.
- Excepciones no-HTTP: `500` + `"Internal server error"`.
- Header de respuesta `X-Correlation-Id` siempre presente (reutiliza el del request si cumple `/^[a-zA-Z0-9._-]{8,128}$/`, si no genera UUID).

### Códigos de estado habituales

| Código | Cuándo |
|---|---|
| 200/201 | Éxito |
| 400 | Validación (`ValidationPipe` whitelist/forbid), DTO inválido, reglas de negocio |
| 401 | JWT/API key ausente o inválido; `X-Internal-Secret` incorrecto |
| 403 | CSRF inválido, rol/permiso insuficiente, org ajena (`OrgAccessGuard`) |
| 404 | Recurso no encontrado (según servicio) |
| 429 | Throttling |

### ValidationPipe global

`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, `enableImplicitConversion: true`. Un campo no declarado en el DTO → **400**.

### Paginación

No hay un envelope universal. Patrones reales:

| Patrón | Dónde |
|---|---|
| `page` + `pageSize` | Billing CFDI, Metrics alerts DTO, Reporting export, Season list |
| `limit` + `offset` | Resale listings, Waitlist, Fraud flags |
| `limit` + `cursor` | Discovery events, Organization team/audit |
| `take` fijo en servicio | Partner events (100), Metrics pace (200 events) |

### Rate limiting

- Global: **120 peticiones / 60 s** (`ThrottlerModule.forRoot` + `ThrottlerGuard` como `APP_GUARD`).
- Overrides con `@Throttle`:
  - Auth login/register: 5 / 60 s
  - Auth forgot-password: 3 / 15 min
  - Auth reset-password: 5 / 15 min
  - Auth refresh: 20 / 60 s
  - Tenant current: 60 / 60 s
  - Taquilla manager-pin/verify: 8 / 60 s

### Headers especiales

| Header | Quién lo lee | Para qué |
|---|---|---|
| `Authorization` | Passport JWT / `ApiKeyGuard` | Bearer JWT o `Bearer blk_…` |
| `X-CSRF-Token` | `assertCsrf` / `JwtAuthGuard` | Double-submit CSRF en mutaciones cookie |
| `X-Channel` | Inventory holds, Orders create | `TAQUILLA` → `SalesChannel.TAQUILLA`; otro/ausente → `WEB` |
| `X-Cashier-Id` | Inventory holds, Orders create | Identificador de cajero en canal taquilla |
| `Idempotency-Key` | Access scan, Orders, Resale, Waitlist notify/join, Campaign create, Season purchase | Reintentos seguros (truncado a 128 en scan) |
| `X-Correlation-Id` | `AllExceptionsFilter` | Trazabilidad; se refleja en respuesta |
| `X-Api-Key` | `ApiKeyGuard` | Partner API |
| `X-Internal-Secret` | Event Scheduling `tick`, Payments `reconcile/spei` | Worker interno; valor = `INTERNAL_API_SECRET` \|\| `JWT_SECRET` |
| `Host` | Discovery, Search, Tenant | Resolución de tenant por host/subdominio |
| `X-Banorte-Signature` / `X-Signature` | Payments webhook | Firma IPN Banorte |

CORS (`main.ts`): `credentials: true`; methods `GET,POST,PUT,DELETE,PATCH,OPTIONS`; allowedHeaders = los de la tabla excepto internos; exposedHeaders = `X-Correlation-Id`.

---

## 2. Roles y permisos

### Enum `UserRole` (Prisma)

```
CUSTOMER | PROMOTER | VENUE_MANAGER | ARTIST | ADMIN | SUPER_ADMIN | TAQUILLA | SCANNER
```

Fuente: `packages/database/prisma/schema.prisma`.

### Cómo se aplican

| Decorador / Guard | Comportamiento |
|---|---|
| `JwtAuthGuard` | JWT cookie o Bearer; CSRF en mutaciones cookie |
| `RolesGuard` | Jerarquía numérica: CUSTOMER(0) < SCANNER/ARTIST(1) < TAQUILLA(2) < VENUE_MANAGER(3) < PROMOTER(4) < ADMIN(5) < SUPER_ADMIN(6). `@Roles('PROMOTER')` admite roles ≥ PROMOTER. `SUPER_ADMIN` siempre pasa. |
| `@Permissions(...)` | Intersección con el mapa rol→permisos de `roles.guard.ts`. Si hay `@Roles` y `@Permissions`, **ambos** deben pasar. |
| `OrgAccessGuard` | Si hay `organizationId`/`orgId` en params/query/body y el usuario no es `SUPER_ADMIN`, debe coincidir con `user.organizationId`. Sin org en request → deja pasar. |
| `OptionalJwtAuthGuard` | Autentica si hay token; si no, continúa anónimo |
| `ApiKeyGuard` | Partner; valida hash SHA-256 y scopes |

Permisos reales en el mapa: `event:read`, `event:write`, `order:read`, `order:write`, `payment:read`, `payment:refund`, `price:write`, `ticket:scan`, `venue:manage`, `analytics:read`, `data:export`, `audit:read`, `role:write`, `tenant:manage`.

---

## 3. Dominios

Leyenda de guards: `JWT` = JwtAuthGuard, `Roles` = RolesGuard, `Org` = OrgAccessGuard, `OptJWT` = OptionalJwtAuthGuard, `ApiKey` = ApiKeyGuard. “Público” = sin guard de autenticación.

---

### Salud

Propósito: liveness/readiness del proceso API.  
Controlador: `apps/api/src/app.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/health` | Público | — | Health check |
| GET | `/api/v1/ready` | Público | — | Readiness |

---

### Auth

Propósito: login, registro, OAuth, refresh/logout y sesiones.  
Controlador: `apps/api/src/modules/auth/auth.controller.ts`.  
Detalle de cookies/CSRF: [SECURITY-MIGRATION.md](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md).

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Público; Throttle 5/60s | Body `LoginDto`: `email`, `password` (≥8) | Login; set cookies; responde `{ accessToken, user }` |
| POST | `/api/v1/auth/register` | Público; Throttle 5/60s | Body `RegisterDto`: + `firstName`, `lastName` | Registro + cookies |
| GET | `/api/v1/auth/me` | JWT | — | Perfil del sujeto JWT |
| GET | `/api/v1/auth/oauth/google/start` | Público | Query `redirect_uri?` | Redirect OAuth Google; cookie state |
| GET | `/api/v1/auth/oauth/microsoft/start` | Público | Query `redirect_uri?` | Redirect OAuth Microsoft |
| POST | `/api/v1/auth/forgot-password` | Público; Throttle 3/15min | Body `ForgotPasswordDto`: `email` | Inicia reset |
| POST | `/api/v1/auth/reset-password` | Público; Throttle 5/15min | Body `ResetPasswordDto`: `email`, `token`, `password` | Completa reset |
| POST | `/api/v1/auth/oauth/google/callback` | Público | Body `OauthCallbackDto`: `code`, `redirect_uri?`, `state?` | Intercambia code; cookies |
| POST | `/api/v1/auth/oauth/microsoft/callback` | Público | Idem | Idem Microsoft |
| POST | `/api/v1/auth/refresh` | CSRF obligatorio; Throttle 20/60s | Cookie `boletera_refresh` | Rota tokens |
| POST | `/api/v1/auth/logout` | CSRF si hay refresh cookie | — | Revoca refresh; limpia cookies |
| POST | `/api/v1/auth/sessions/revoke-all` | JWT (+ CSRF si cookie) | — | Revoca todas las sesiones |

---

### Discovery

Propósito: catálogo público de eventos/venues del tenant resuelto por `Host`.  
Controlador: `apps/api/src/modules/discovery/discovery.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/discovery/suggest` | Público (Host→tenant) | Query `q?`, `limit?` (1–12, default 8) | Autocomplete |
| GET | `/api/v1/discovery/facets` | Público | — | Facetas ciudades/categorías |
| GET | `/api/v1/discovery/venues` | Público | Query `limit?` (1–60), `city?` | Lista venues |
| GET | `/api/v1/discovery/venues/:slug` | Público | Param `slug` | Venue por slug |
| GET | `/api/v1/discovery/events` | Público | Query `q?`, `city?`, `category?`, `venueSlug?`, `when?` (ALL\|WEEK\|WEEKEND\|MONTH), `from?`, `to?`, `limit?` (1–100), `cursor?` | Lista eventos |
| GET | `/api/v1/discovery/events/:slug` | Público | Param `slug` | Detalle por slug |

---

### Inventory

Propósito: mapa, disponibilidad, holds y stream SSE.  
Controlador: `apps/api/src/modules/inventory/inventory.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/inventory/:eventId/map` | Público | Param `eventId` | Snapshot del seat map publicado |
| GET | `/api/v1/inventory/:eventId/availability` | Público | Param `eventId` | Disponibilidad (expira holds stale) |
| GET (SSE) | `/api/v1/inventory/:eventId/stream` | Público | Param `eventId` | Stream SSE cada ~3s con JSON de availability |
| POST | `/api/v1/inventory/holds/best-available` | OptJWT | Body `CreateBestAvailableHoldDto`; headers `X-Channel`, `X-Cashier-Id` | Hold best-available |
| POST | `/api/v1/inventory/holds` | OptJWT | Body `CreateHoldDto`; headers canal/cajero | Hold asientos o GA |
| DELETE | `/api/v1/inventory/holds/:id` | OptJWT | Param `id`; query `sessionId?` | Libera hold |

---

### Pricing

Propósito: cálculo de precio, recomendaciones dinámicas y estimación de ingresos.  
Controlador: `apps/api/src/modules/pricing/pricing.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/pricing/calculate` | Público | Body `CalculatePriceDto` | Precio unitario con factores |
| POST | `/api/v1/pricing/calculate-cart` | Público | Body `CalculateCartDto` | Total de carrito multi-offer |
| POST | `/api/v1/pricing/events/:eventId/update-dynamic` | JWT+Roles `PROMOTER+`; `price:write` | Param `eventId` | Genera recomendaciones; aplica deltas seguros |
| GET | `/api/v1/pricing/events/:eventId/recommendations` | JWT+Roles `VENUE_MANAGER+` | Param `eventId` | Lista recomendaciones |
| POST | `/api/v1/pricing/events/:eventId/recommendations/preview` | JWT+Roles `VENUE_MANAGER+` | Param `eventId` | Preview sin escribir |
| POST | `/api/v1/pricing/events/:eventId/recommendations/apply` | JWT+Roles `PROMOTER+`; `price:write` | Body `ApplyRecommendationsDto` | Aplica (opcional `confirmApproval`) |
| GET | `/api/v1/pricing/events/:eventId/recommendations/pending` | JWT+Roles `VENUE_MANAGER+` | Param `eventId` | Pendientes de aprobación |
| POST | `/api/v1/pricing/recommendations/:recommendationId/approve` | JWT+Roles `PROMOTER+`; `price:write` | Body `ApproveRecommendationDto` | Aprueba |
| POST | `/api/v1/pricing/recommendations/:recommendationId/reject` | JWT+Roles `PROMOTER+`; `price:write` | Body `RejectRecommendationDto` | Rechaza |
| GET | `/api/v1/pricing/offers/:offerId/history` | JWT+Roles `VENUE_MANAGER+` | Query `limit?` (1–200) | Historial de precios |
| GET | `/api/v1/pricing/events/:eventId/revenue-estimate` | JWT+Roles `VENUE_MANAGER+` | Param `eventId` | Estimación de ingresos |

---

### Orders

Propósito: checkout, estado, QR/PDF y CFDI del comprador.  
Controlador: `apps/api/src/modules/orders/orders.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/orders` | OptJWT | Body: `eventId`, `buyerName`, `buyerEmail`, …; headers canal/cajero/`Idempotency-Key` | Crea orden |
| GET | `/api/v1/orders/mine` | JWT | — | Órdenes del usuario |
| GET | `/api/v1/orders/:publicId/status` | Público | Param `publicId` | Estado |
| GET | `/api/v1/orders/:publicId/qrcodes` | Público | Param `publicId` | QRs de boletos |
| GET | `/api/v1/orders/:publicId/tickets.pdf` | Público | Param `publicId` | PDF de boletos |
| POST | `/api/v1/orders/:publicId/cfdi` | JWT | Body `receptorRfc`, `receptorNombre`, `receptorUsoCfdi?` | Solicita CFDI comprador |
| GET | `/api/v1/orders/:publicId` | Público | Param `publicId` | Detalle por publicId |

> Varios GETs por `publicId` son públicos (conocimiento del ID opaco). No hay `OrgAccessGuard`.

---

### Payments

Propósito: Banorte (Payworks/SPEI/OXXO), reembolsos, webhooks y reconcile interno.  
Controlador: `apps/api/src/modules/payment/payment.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/payments/config` | Público | — | Config pública Banorte (puede ser modo demo) |
| GET | `/api/v1/payments/config/validate` | JWT+Roles `PROMOTER+` | — | Valida credenciales Banorte |
| POST | `/api/v1/payments/intents` | Público | Body `orderId`, `amount`, `currency`, `buyerEmail`, `buyerName`, … | Crea intent de pago |
| POST | `/api/v1/payments/confirm` | Público | Body `orderId`, `intentId?`, `externalId?` | Confirma (demo / return URL) |
| POST | `/api/v1/payments/:orderId/refunds` | JWT+Roles `PROMOTER+` | Body `reason`, `amount?`, `notes?` | Solicita reembolso |
| POST | `/api/v1/payments/refunds/:refundId/complete` | JWT+Roles `PROMOTER+` | Body `banorteReference?` | Completa reembolso manual |
| POST | `/api/v1/payments/webhooks/banorte` | Público (firma) | Body Banorte; headers firma | IPN webhook |
| POST | `/api/v1/payments/reconcile/spei` | **Interno** `X-Internal-Secret` | — | Reconcilia SPEI/OXXO pendientes |
| GET | `/api/v1/payments/webhooks/banorte/return` | Público | Query `orderId`, `result` | Return URL Payworks; en demo completa orden |

---

### Access

Propósito: escaneo de acceso y QR de boleto.  
Controlador: `apps/api/src/modules/access/access.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/access/scan` | JWT+Roles `SCANNER+`; `ticket:scan` | Body `ScanTicketDto`; header `Idempotency-Key` | Admite boleto en puerta |
| GET | `/api/v1/access/tickets/:id/qr` | JWT | Param `id` | QR del titular o staff de la org |

---

### Metrics

Propósito: agregados de negocio tipados para admin (MXN, `America/Mexico_City`).  
Controlador: `apps/api/src/modules/metrics/metrics.controller.ts`.  
**Referencia exhaustiva:** [metricas.md](./metricas.md).

Guards de clase: `JWT + Roles + Org`; `@Roles('PROMOTER','ADMIN','SUPER_ADMIN','VENUE_MANAGER')`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/metrics/executive` | (clase) | Query `MetricsRangeQueryDto` | Resumen ejecutivo |
| GET | `/api/v1/metrics/events/sales-pace` | (clase) | Idem | Ritmo de venta |
| GET | `/api/v1/metrics/inventory` | (clase) | + `eventId?` | Inventario |
| GET | `/api/v1/metrics/orders` | (clase) | Range | Órdenes/pagos |
| GET | `/api/v1/metrics/access` | (clase) | + `eventId?` | Asistencia |
| GET | `/api/v1/metrics/resale` | (clase) | Range | Reventa |
| GET | `/api/v1/metrics/waitlist` | (clase) | Range | Waitlist |
| GET | `/api/v1/metrics/campaigns` | (clase) | Range | Campañas |
| GET | `/api/v1/metrics/fraud` | (clase) | Range | Fraude |
| GET | `/api/v1/metrics/settlements` | (clase) | Range | Liquidaciones |
| GET | `/api/v1/metrics/timeseries` | (clase) | `MetricsTimeSeriesQueryDto` | Series temporales |
| GET | `/api/v1/metrics/alerts` | (clase) | `MetricsPagedQueryDto` | Alertas |

---

### Analytics

Propósito: dashboards legacy por evento/promotor (`EventDashboardMetrics` / `PromoterDashboardMetrics`).  
Controlador: `apps/api/src/modules/analytics/analytics.controller.ts`.  
Convive con Metrics: preferir `/metrics/*` para paneles nuevos; Analytics para contratos antiguos. Ver [metricas.md § Metrics vs Analytics](./metricas.md#metrics-vs-analytics).

Guards de clase: `JWT + Roles + Org`; roles `PROMOTER+` / `VENUE_MANAGER`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/analytics/events/:eventId/dashboard` | (clase) | Query `organizationId?` (ADMIN/SUPER_ADMIN) | Dashboard evento |
| GET | `/api/v1/analytics/promoters/:organizationId/dashboard` | (clase) | Query `period?` DAY\|WEEK\|MONTH | Dashboard promotor |
| POST | `/api/v1/analytics/promoters/:organizationId/settlement` | (clase) | Body `{ month:1–12, year:2000–2100 }` | Liquidación mensual |
| GET | `/api/v1/analytics/promoters/:organizationId/customers` | (clase) | Param org | Analítica clientes |
| GET | `/api/v1/analytics/promoters/:organizationId/fraud` | (clase) | Param org | Analítica fraude |

---

### Reporting

Propósito: reportes operativos, forecast, export CSV y SSE realtime.  
Controlador: `apps/api/src/modules/reporting-service/reporting.controller.ts`.  
Guards de clase: `JWT + Roles + Org`; roles `VENUE_MANAGER+`; `@Permissions('analytics:read')`. Export añade `data:export`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/reports/dashboard/realtime/:organizationId` | (clase) | Query `eventId?` | Dashboard realtime |
| GET (SSE) | `/api/v1/reports/dashboard/realtime/:organizationId/stream` | (clase) | Query `eventId?` | SSE cada 10s |
| GET | `/api/v1/reports/settlement/:organizationId/:period` | (clase) | `period` DAILY\|WEEKLY\|MONTHLY | Settlement |
| GET | `/api/v1/reports/heatmap/:eventId` | (clase) | Param `eventId` | Heatmap ocupación |
| GET | `/api/v1/reports/predict/:eventId` | (clase) | Param `eventId` | Predicción heurística de ocupación |
| GET | `/api/v1/reports/channels/:organizationId` | (clase) | Query `eventId?` | Performance por canal |
| GET | `/api/v1/reports/customers/:organizationId` | (clase) | Param org | Clientes |
| GET | `/api/v1/reports/export/sales/:organizationId` | + `data:export` | Query `from?`, `to?`, `page?`, `pageSize?` (≤5000) | CSV ventas |
| GET | `/api/v1/reports/forecast/:organizationId/:days` | (clase) | Param `days` int | Forecast ingresos |

---

### Resale

Propósito: marketplace secundario.  
Controlador: `apps/api/src/modules/resale/resale.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/resale/listings` | JWT+Roles; `order:write` | Body `CreateResaleListingDto`; `Idempotency-Key` | Crea listing |
| POST | `/api/v1/resale/listings/:listingId/offers` | JWT; `order:write` | Body `offerPrice` | Oferta |
| POST | `/api/v1/resale/offers/:offerId/accept` | JWT; `order:write` | — | Acepta oferta |
| POST | `/api/v1/resale/offers/:offerId/reject` | JWT; `order:write` | — | Rechaza |
| POST | `/api/v1/resale/listings/:listingId/cancel` | JWT; `order:write` | — | Cancela listing |
| GET | `/api/v1/resale/listings` | Público | Query `eventId?`, `offerId?`, `limit?`, `offset?` | Listados activos |
| GET | `/api/v1/resale/events/:eventId/stats` | JWT+Roles `VENUE_MANAGER+`; `event:read` | Param `eventId` | Stats marketplace |
| GET | `/api/v1/resale/tickets/:ticketId/anti-scalping-check` | JWT; `order:read` | Param `ticketId` | Anti-scalping |

---

### Waitlist

Propósito: lista de espera y notificaciones por lote.  
Controlador: `apps/api/src/modules/waitlist/waitlist.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/waitlist/join` | Público | Body `JoinWaitlistDto`; `Idempotency-Key` | Unirse |
| GET | `/api/v1/waitlist/event/:eventId` | JWT+Roles `VENUE_MANAGER+`; `event:read` | Query `status?`, `limit?`, `offset?` | Lista por evento |
| GET | `/api/v1/waitlist/organization/:orgId` | JWT+Roles `VENUE_MANAGER+`; `event:read` | Query `limit?`, `offset?` | Lista por org (**sin OrgAccessGuard**) |
| GET | `/api/v1/waitlist/event/:eventId/stats` | JWT+Roles `VENUE_MANAGER+`; `event:read` | Param `eventId` | Stats |
| POST | `/api/v1/waitlist/event/:eventId/notify` | JWT+Roles `PROMOTER+`; `event:write` | Query `limit?` (default 50); `Idempotency-Key` | Notifica lote |

---

### Ticket Transfer

Propósito: cesión de boletos entre usuarios.  
Controlador: `apps/api/src/modules/ticket-transfer/ticket-transfer.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/tickets/transfer` | JWT | Body `ticketId`, `toEmail`, `message?` | Inicia transferencia |
| POST | `/api/v1/tickets/transfer/accept` | JWT | Body `transferCode` | Acepta |
| GET | `/api/v1/tickets/transfer/mine` | JWT | — | Listado del usuario |
| POST | `/api/v1/tickets/transfer/:id/cancel` | JWT | Param `id` | Cancela |

---

### Season

Propósito: abonos / season passes.  
Controlador: `apps/api/src/modules/season/season.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/season/purchase/:seasonPassId` | Público | Body `PurchaseSeasonPassDto`; `Idempotency-Key` | Compra (demo completa de inmediato — ver summary del endpoint) |
| POST | `/api/v1/season/org/:orgId` | JWT+Roles+Org `PROMOTER+`; `event:write` | Body `CreateSeasonPassDto` | Crea abono |
| GET | `/api/v1/season/org/:orgId` | JWT+Roles+Org `VENUE_MANAGER+`; `event:read` | Query `limit?`, `page?` | Lista abonos |

---

### Event Management

Propósito: CRUD operativo de eventos, series, pricing, canales y hub.  
Controlador: `apps/api/src/modules/event-management/event-management.controller.ts`.  
Guards de clase: `JWT + Roles`. Bodies tipados inline (sin class-validator en varios endpoints).

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/events/manage` | `PROMOTER+` | Body create event | Crea evento |
| POST | `/api/v1/events/manage/series` | `PROMOTER`/`ADMIN` | Body series | Crea serie |
| POST | `/api/v1/events/manage/residency` | `PROMOTER`/`ADMIN` | Body residency | Crea residencia |
| PUT | `/api/v1/events/manage/:eventId/offers/:offerId` | `PROMOTER+` | Body price/name/availability | Actualiza offer |
| PUT | `/api/v1/events/manage/:eventId/pricing` | `PROMOTER`/`ADMIN` | Body pricing rules | Reglas de precio |
| PUT | `/api/v1/events/manage/:eventId/channels` | `PROMOTER`/`ADMIN` | Body allocations | Canales |
| POST | `/api/v1/events/manage/:eventId/campaigns` | `PROMOTER`/`ADMIN` | Body campaign | Crea campaña (legacy path) |
| GET | `/api/v1/events/manage/calendar/:month/:year` | `PROMOTER`/`ADMIN` | Params month/year | Calendario |
| PUT | `/api/v1/events/manage/bulk/pricing` | `ADMIN` | Body `eventIds`, `priceMultiplier` | Bulk pricing |
| GET | `/api/v1/events/manage/search` | `PROMOTER`/`ADMIN` | Query `filters: any` | Búsqueda avanzada |
| GET | `/api/v1/events/manage/:eventId/hub` | `PROMOTER`/`ADMIN`/`VENUE_MANAGER` | Param `eventId` | Command hub |

---

### Event Scheduling

Propósito: series, ventanas de venta, fases, blackouts, calendario y tick del scheduler.  
Controlador: `apps/api/src/modules/event-scheduling/event-scheduling.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/events/schedule/preview` | JWT+Roles `VENUE_MANAGER+` | Body `rule`, `venueId`, … | Preview recurrencia/conflictos |
| POST | `/api/v1/events/schedule/events` | JWT+Roles `PROMOTER+` | Body schedule + template + phases | Crea evento calendarizado |
| POST | `/api/v1/events/schedule/series` | JWT+Roles `PROMOTER+` | Body series | Crea serie |
| GET | `/api/v1/events/schedule/series` | JWT+Roles `VENUE_MANAGER+` | — | Lista series |
| GET | `/api/v1/events/schedule/series/:seriesId` | JWT+Roles `VENUE_MANAGER+` | Param | Detalle serie |
| PATCH | `/api/v1/events/schedule/series/:seriesId` | JWT+Roles `PROMOTER+` | Body name/status | Actualiza serie |
| POST | `/api/v1/events/schedule/series/:seriesId/extend` | JWT+Roles `PROMOTER+` | Body count/until | Extiende serie |
| GET | `/api/v1/events/schedule/events/:eventId` | JWT+Roles `VENUE_MANAGER+` | Param | Schedule del evento |
| PUT | `/api/v1/events/schedule/events/:eventId/windows` | JWT+Roles `PROMOTER+` | Body announce/publish/sales/doors | Ventanas de venta |
| PATCH | `/api/v1/events/schedule/events/:eventId/reschedule` | JWT+Roles `PROMOTER+` | Body `startsAt`, `reason`, … | Reagenda |
| PATCH | `/api/v1/events/schedule/events/:eventId/cancel` | JWT+Roles `PROMOTER+` | Body `reason` | Cancela |
| PUT | `/api/v1/events/schedule/events/:eventId/phases` | JWT+Roles `PROMOTER+` | Body phase | Upsert fase |
| DELETE | `/api/v1/events/schedule/events/:eventId/phases/:phaseId` | JWT+Roles `PROMOTER+` | Params | Borra fase |
| GET | `/api/v1/events/schedule/venues/:venueId/blackouts` | JWT+Roles `VENUE_MANAGER+` | Param | Lista blackouts |
| POST | `/api/v1/events/schedule/venues/:venueId/blackouts` | JWT+Roles `VENUE_MANAGER+` | Body reason/starts/ends | Crea blackout |
| DELETE | `/api/v1/events/schedule/venues/:venueId/blackouts/:blackoutId` | JWT+Roles `VENUE_MANAGER+` | Params | Borra blackout |
| GET | `/api/v1/events/schedule/calendar` | JWT+Roles `VENUE_MANAGER+` | Query `from`, `to`, `venueId?`, `status?` | Calendario rango |
| GET | `/api/v1/events/schedule/transitions` | JWT+Roles `VENUE_MANAGER+` | Query `hours?` (default 72, max 720) | Próximas transiciones |
| GET | `/api/v1/events/schedule/public/events/:eventId/sale-state` | Público | Param `eventId` | Estado de venta storefront |
| POST | `/api/v1/events/schedule/tick` | **Interno** `X-Internal-Secret` | Header secreto | Ejecuta transiciones temporales |

---

### Venue Layout

Propósito: editor de mapas, egreso y publicación a evento.  
Controladores: `venue-layout.controller.ts` (`venues` + `EventPublishController` en `events`).

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/venues/egress-overview` | JWT+Roles `VENUE_MANAGER+`; `venue:manage` | Query `page?`, `pageSize?` | Salud de egreso org |
| GET | `/api/v1/venues/egress-overview.csv` | Idem | Idem | CSV egreso org |
| GET | `/api/v1/venues/:venueId/layout` | Idem | Param | Layout activo |
| GET | `/api/v1/venues/:venueId/layout/egress` | Idem | Param | Reporte egreso JSON |
| GET | `/api/v1/venues/:venueId/layout/egress.csv` | Idem | Param | CSV |
| GET | `/api/v1/venues/:venueId/layout/egress.pdf` | Idem | Param | PDF |
| POST | `/api/v1/venues/:venueId/layout/egress` | Idem | Body `EgressAnalyzeDto`; query `format?` | Analiza draft/map |
| PUT | `/api/v1/venues/:venueId/layout` | Idem | Body `SaveLayoutDto` | Guarda mapa |
| POST | `/api/v1/venues/:venueId/layout/from-template` | Idem | Body `FromTemplateDto` | Aplica template |
| POST | `/api/v1/venues/:venueId/layout/ai-import` | JWT+Roles `VENUE_MANAGER`/`ADMIN`/`SUPER_ADMIN`; `venue:manage` | Body sections | Import AI |
| POST | `/api/v1/venues/:venueId/layout/suggest` | Idem | Body `prompt` | Suggest por prompt |
| POST | `/api/v1/events/:eventId/publish` | JWT+Roles `PROMOTER+`; `event:write` | Param `eventId` | Publica mapa+offers+tickets+canales |

---

### Layout Management

Propósito: layouts con secciones, sightlines y holds a nivel layout.  
Controlador: `apps/api/src/modules/layout-management/layout-management.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/layouts/venue/:venueId` | JWT+Roles `VENUE_MANAGER+`; `venue:manage` | Body `CreateVenueLayoutDto` | Crea layout |
| POST | `/api/v1/layouts/:layoutId/sightlines` | Idem | Param | Calcula sightlines |
| POST | `/api/v1/layouts/:layoutId/seats/hold` | + `TAQUILLA` | Body `HoldSeatsDto` | Hold seats |
| POST | `/api/v1/layouts/:layoutId/seats/release` | + `TAQUILLA` | Body `ReleaseSeatsDto` | Release seats |

---

### Seat Mapping 3D

Propósito: vista 3D / heatmap / recomendaciones de asiento.  
Controlador: `apps/api/src/modules/seat-mapping-3d/seat-mapping-3d.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/3d/venue/:venueId` | JWT+Roles `VENUE_MANAGER+`; `venue:manage` | Param | **Deprecated** — genera mapa 3D compat |
| GET | `/api/v1/3d/events/:eventId/interactive` | OptJWT | Query `selectedSeat?` | Status live de asientos |
| POST | `/api/v1/3d/events/:eventId/recommendations` | JWT+Roles `TAQUILLA+`; `event:read` | Body `RecommendSeatsDto` | Recomendaciones heurísticas |
| GET | `/api/v1/3d/events/:eventId/heatmap` | OptJWT | Param | Heatmap ocupación |

---

### Taquilla POS

Propósito: terminales, sesiones de caja, checkout, will-call, offline.  
Controlador: `apps/api/src/modules/taquilla-pos/taquilla-pos.controller.ts`.  
Guards de clase: `JWT + Roles`; roles `TAQUILLA`/`SCANNER`/`VENUE_MANAGER`/`PROMOTER`/`ADMIN`/`SUPER_ADMIN`. DTOs son **types TypeScript** (sin class-validator) → el ValidationPipe no valida campos.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/taquilla/terminal/init` | (clase) | `InitTerminalDto` | Init terminal |
| POST | `/api/v1/taquilla/session/start` | (clase) | `StartSessionDto` | Abre turno |
| POST | `/api/v1/taquilla/holds` | (clase) | `CreateHoldDto` | Holds POS |
| POST | `/api/v1/taquilla/holds/release` | (clase) | `ReleaseHoldsDto` | Libera holds |
| POST | `/api/v1/taquilla/checkout` | (clase) | `QuickCheckoutDto` | Checkout taquilla |
| POST | `/api/v1/taquilla/terminal/init-org` | + Org; roles taquilla/promoter… | Body org/location/terminal | Init por org |
| POST | `/api/v1/taquilla/payment` | (clase) | `ProcessPaymentDto` | **Stub legacy** — preferir checkout |
| GET | `/api/v1/taquilla/receipt/:orderId` | (clase) | Query `terminalId` | Recibo |
| POST | `/api/v1/taquilla/scan` | (clase) | Body `terminalId`, `barcode` | Scan barcode/publicId |
| POST | `/api/v1/taquilla/void` | (clase) | `VoidOrderDto` | Anula venta (PIN manager) |
| POST | `/api/v1/taquilla/willcall/lookup` | (clase) | `WillcallLookupDto` | Lookup will-call |
| POST | `/api/v1/taquilla/willcall/fulfill` | (clase) | `WillcallFulfillDto` | Entrega will-call |
| POST | `/api/v1/taquilla/exchange` | (clase) | `ExchangeDto` | Cambio/upgrade |
| POST | `/api/v1/taquilla/session/cash-drop` | (clase) | `CashDropDto` | Drop de efectivo |
| POST | `/api/v1/taquilla/session/handoff` | (clase) | `HandoffDto` | Handoff de cajero |
| POST | `/api/v1/taquilla/manager-pin` | + Org; `ADMIN`/`VENUE_MANAGER`/`PROMOTER` | `ManagerPinDto` | Set PIN |
| POST | `/api/v1/taquilla/manager-pin/verify` | (clase); Throttle 8/60s | `VerifyPinDto` | Verifica PIN |
| GET | `/api/v1/taquilla/z-reports` | (clase) | Query `organizationId` | Lista Z-reports |
| POST | `/api/v1/taquilla/sync-inventory` | (clase) | Body terminal/event | Sync inventario |
| POST | `/api/v1/taquilla/offline/enable/:terminalId` | (clase) | Param | Offline on |
| POST | `/api/v1/taquilla/offline/sync/:terminalId` | (clase) | `SyncOfflineDto` | Sync offline |
| POST | `/api/v1/taquilla/session/end` | (clase) | `EndSessionDto` | Cierra turno (Z) |
| GET | `/api/v1/taquilla/session/summary` | (clase) | Query `sessionId` | Resumen turno |
| GET | `/api/v1/taquilla/analytics/:terminalId/:period` | (clase) | `period` TODAY\|WEEK\|MONTH | Analytics terminal |

---

### Channel Management

Propósito: configuración y salud de canales de venta por evento.  
Controlador: `apps/api/src/modules/channel-management/channel-management.controller.ts`.  
Guards de clase: `JWT + Roles`. **Sin `OrgAccessGuard`.**

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/channels/:eventId/configure` | `PROMOTER`/`ADMIN` | Body `ChannelConfigDto` | Configura canales |
| POST | `/api/v1/channels/:eventId/allocate-inventory` | `PROMOTER`/`ADMIN` | Body `totalTickets` | Asigna inventario |
| GET | `/api/v1/channels/:eventId/health` | `PROMOTER`/`ADMIN` | Param | Salud |
| POST | `/api/v1/channels/:eventId/reallocate` | `ADMIN` | Param | Reasignación dinámica |
| GET | `/api/v1/channels/:eventId/analytics` | `PROMOTER`/`ADMIN` | Param | Analytics canal |
| POST | `/api/v1/channels/:eventId/partners` | `ADMIN` | Body `ApiPartnerDto` | Añade partner API (canal) |
| POST | `/api/v1/channels/:eventId/taquilla-location` | `PROMOTER`/`ADMIN` | Body `TaquillaLocationDto` | Añade ubicación taquilla |

---

### Campaign Execution

Propósito: campañas, códigos, descuentos y loyalty.  
Controlador: `apps/api/src/modules/campaign-execution/campaign-execution.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/campaigns/create/:organizationId/:eventId` | JWT+Roles+Org `PROMOTER+`; `event:write` | Body `CreateCampaignDto`; `Idempotency-Key` | Crea campaña |
| GET | `/api/v1/campaigns/list/:eventId` | JWT+Roles `VENUE_MANAGER+`; `event:read` | Query `page?`, `limit?` | Lista |
| POST | `/api/v1/campaigns/:campaignId/publish` | JWT+Roles `PROMOTER+`; `event:write` | Param | Publica |
| POST | `/api/v1/campaigns/validate-code` | Público | Body `ValidatePresaleCodeDto` | Valida código |
| POST | `/api/v1/campaigns/apply-discount/:campaignId` | Público | Body `ApplyDiscountDto` | Preview descuento |
| GET | `/api/v1/campaigns/:campaignId/codes/export` | JWT+Roles `PROMOTER+`; `data:export` | Param | CSV códigos |
| GET | `/api/v1/campaigns/:campaignId/analytics` | JWT+Roles `PROMOTER+`; `analytics:read` | Param | Analytics |
| POST | `/api/v1/campaigns/:campaignId/pause` | JWT+Roles `PROMOTER+`; `event:write` | Param | Pausa |
| POST | `/api/v1/campaigns/:campaignId/resume` | Idem | Param | Reanuda |
| POST | `/api/v1/campaigns/:campaignId/end` | Idem | Param | Termina |
| GET | `/api/v1/campaigns/active/:eventId` | Público | Param | Campañas activas |
| POST | `/api/v1/campaigns/:userId/loyalty/award` | JWT+Roles `ADMIN+`; `event:write` | Body `AwardLoyaltyPointsDto` | Otorga puntos (metadata usuario) |
| GET | `/api/v1/campaigns/:userId/loyalty/balance` | JWT+Roles CUSTOMER/PROMOTER/ADMIN; `event:read` | Param | Balance loyalty |

---

### Search

Propósito: búsqueda SQL (no ML) con tenant por Host o JWT.  
Controlador: `apps/api/src/modules/search-service/search.controller.ts`.  
Guard de clase: `OptionalJwtAuthGuard`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/search/events` | OptJWT | Query `q?`/`query?`, `city?`, `category?`, `limit?` | Búsqueda SQL |
| GET | `/api/v1/search/facets` | OptJWT | Idem filtros | Facetas |
| GET | `/api/v1/search/autocomplete` | OptJWT | Query `q?` | Autocomplete ILIKE |
| GET | `/api/v1/search/trending` | OptJWT | Query `limit?` (default 10) | Por volumen de órdenes |
| GET | `/api/v1/search/recommendations` | OptJWT | Query `userId?` (ignorado p/ personalización) | Heurística ciudad/popular |

---

### Fraud

Propósito: scoring, flags, KYC/AML.  
Controlador: `apps/api/src/modules/fraud/fraud.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| POST | `/api/v1/fraud/analyze` | **Público** (sin JWT) | Body order/user/ip/amount… | Analiza transacción |
| POST | `/api/v1/fraud/flags` | JWT+Roles `ADMIN+` | Body type/severity/reason… | Crea flag |
| GET | `/api/v1/fraud/flags` | JWT+Roles `ADMIN+` | Query severity/status/limit/offset | Lista flags (**sin scope org**) |
| POST | `/api/v1/fraud/flags/:flagId/resolve` | JWT+Roles `ADMIN+` | Body `resolution` | Resuelve (actor hardcodeado `'admin-user'` en servicio) |
| POST | `/api/v1/fraud/kyc/:userId` | JWT+Roles `ADMIN+` | Body KYC fields | **Stub**: siempre `{ status: 'verified' }` |
| POST | `/api/v1/fraud/aml/:organizationId` | JWT+Roles `ADMIN+` | Body `name`, `country` | **Stub**: siempre `{ status: 'cleared', isWatchlisted: false }` |

---

### Billing / CFDI

Propósito: perfil fiscal y timbrado CFDI 4.0.  
Controlador: `apps/api/src/modules/billing/billing.controller.ts`.  
Guards de clase: `JWT + Roles + Org`; roles `PROMOTER+`; `@Permissions('payment:read')`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/billing/:orgId/fiscal-profile` | (clase) | Param `orgId` | Perfil fiscal |
| POST | `/api/v1/billing/:orgId/fiscal-profile` | (clase) | Body `UpsertFiscalProfileDto` | Upsert perfil |
| POST | `/api/v1/billing/:orgId/cfdi/stamp` | (clase) | Body `StampCfdiDto` | Timbra (sandbox por defecto) |
| GET | `/api/v1/billing/:orgId/cfdi` | (clase) | Query `page?`, `pageSize?` | Lista CFDIs |

---

### Organization

Propósito: perfil, equipo, capabilities SaaS y audit.  
Controlador: `apps/api/src/modules/organization/organization.controller.ts`.  
Guards de clase: `JWT + Roles + Org`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/organization/capabilities` | `VENUE_MANAGER+` | Query `organizationId?` | Matriz SaaS |
| GET | `/api/v1/organization/:orgId` | `VENUE_MANAGER+` | Param | Perfil |
| PATCH | `/api/v1/organization/:orgId` | `PROMOTER+` | Body `UpdateOrganizationDto` | Actualiza |
| GET | `/api/v1/organization/:orgId/team` | `VENUE_MANAGER+` | Query `limit?`, `cursor?` | Equipo |
| POST | `/api/v1/organization/:orgId/team` | `PROMOTER+` | Body `InviteTeamMemberDto` | Invita |
| PATCH | `/api/v1/organization/:orgId/team/:userId` | `PROMOTER+` | Body role/active | Actualiza miembro |
| GET | `/api/v1/organization/:orgId/audit` | `PROMOTER+` | Query limit/cursor/action | Audit feed |

---

### Tenant

Propósito: branding público del storefront por `Host`.  
Controlador: `apps/api/src/modules/tenant/tenant.controller.ts`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/tenant/current` | Público; Throttle 60/60s | Header `Host` | Resuelve tenant (demo en loopback) |

---

### Partners (gestión de API keys)

Propósito: emitir/revocar claves `blk_` para Partner API.  
Controlador: `apps/api/src/modules/partners/partners.controller.ts`.  
Guards: `JWT + Roles + Org`; roles `PROMOTER+`.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/partners/:orgId/keys` | (clase) | Param | Lista keys (sin secret) |
| POST | `/api/v1/partners/:orgId/keys` | (clase) | Body `name`, `scopes?`, `rateLimit?`, `expiresInDays?` | Crea key; `secret` solo una vez |
| PATCH | `/api/v1/partners/:orgId/keys/:keyId/revoke` | (clase) | Params | `active=false` |

Scopes por defecto al crear: `['read:events', 'read:inventory', 'write:orders']`. Rate limit default `1000`. Prefijo almacenado: primeros 12 chars; hash SHA-256 del secret completo. Modelo Prisma: `ApiKey`.

---

### Partner API pública

Ver [§ 4](#4-partner-api-pública).

---

### Admin

Propósito: panel staff (órdenes, payouts, venues, branding, reportes).  
Controlador: `apps/api/src/modules/admin/admin.controller.ts`.  
Guards de clase: `JWT + Roles`. Org = `req.user.organizationId` (no `OrgAccessGuard`). Varios bodies **sin DTO class-validator**.

| Método | Ruta completa | Guards / Roles | Parámetros y body | Qué hace |
|---|---|---|---|---|
| GET | `/api/v1/admin/dashboard` | `VENUE_MANAGER+` | — | Dashboard org |
| GET | `/api/v1/admin/platform/overview` | `VENUE_MANAGER+` | — | Overview plataforma |
| GET | `/api/v1/admin/orders` | `VENUE_MANAGER+` | — | Lista órdenes |
| GET | `/api/v1/admin/orders/:id` | `VENUE_MANAGER+` | Param | Detalle |
| POST | `/api/v1/admin/orders/:id/refund` | `PROMOTER+` | Body reason/amount/notes | Solicita refund |
| POST | `/api/v1/admin/orders/:id/resend-email` | `VENUE_MANAGER+` | Param | Reenvía email |
| POST | `/api/v1/admin/orders/:id/cancel` | `PROMOTER+` | Body `reason?` | Cancela |
| GET | `/api/v1/admin/payouts` | `PROMOTER+` | — | Lista payouts |
| POST | `/api/v1/admin/payouts/:payoutId/process` | `ADMIN+` | Body `referenceId?` | Marca processing |
| POST | `/api/v1/admin/payouts/:payoutId/complete` | `ADMIN+` | Body `referenceId` | Completa payout |
| GET | `/api/v1/admin/events` | `VENUE_MANAGER+` | — | Lista eventos |
| GET | `/api/v1/admin/venues` | `VENUE_MANAGER+` | — | Lista venues |
| POST | `/api/v1/admin/venues` | `VENUE_MANAGER+`/`PROMOTER` | Body name/city/template… | Crea venue |
| GET | `/api/v1/admin/branding` | `ADMIN+` | — | Theme |
| POST | `/api/v1/admin/branding` | `ADMIN+` | Body colors/logo/subdomain | Actualiza theme |
| GET | `/api/v1/admin/reports/sales` | `PROMOTER+` | Query `from?`, `to?` | Reporte ventas |
| POST | `/api/v1/admin/venues/suggest-layout` | `VENUE_MANAGER`/`ADMIN+` | Body `venueId`, `planDescription` | Suggest layout |

---

## 4. Partner API pública

Controlador: `apps/api/src/modules/partners/partner-api.controller.ts`.  
Prefijo: `@Controller('partner/v1')` → `/api/v1/partner/v1/...`.  
Guard de clase: `ApiKeyGuard`.

### Autenticación

1. Header `X-Api-Key: blk_<hex>` **o** `Authorization: Bearer blk_<hex>`.
2. `PartnersService.validateApiKey`: hash SHA-256, `active=true`, no expirada; actualiza `lastUsedAt`.
3. Scopes: `@RequireApiScopes(...)`; la key debe incluir todos los scopes requeridos **o** `*`.

### Emisión de claves

`POST /api/v1/partners/:orgId/keys` (sección Partners). Secret `blk_` + 48 hex chars; se muestra **una sola vez** en `secret`.

### Endpoints

| Método | Ruta completa | Scopes | Qué hace |
|---|---|---|---|
| GET | `/api/v1/partner/v1/me` | (ninguno extra) | Identidad org de la key |
| GET | `/api/v1/partner/v1/events` | `read:events` | Hasta 100 eventos `SCHEDULED`/`LIVE` |
| GET | `/api/v1/partner/v1/events/:eventId/availability` | `read:inventory` | Conteos AVAILABLE/HELD/SOLD; `{ error }` si no pertenece a la org |

Scopes usados en código: `read:events`, `read:inventory`. Default al crear también incluye `write:orders` (aún sin endpoint write en este controller).

---

## 5. Endpoints SSE (`text/event-stream`)

Búsqueda: `@Sse(` en controladores.

| Ruta | Auth | Intervalo | Payload |
|---|---|---|---|
| `GET /api/v1/inventory/:eventId/stream` | **Ninguna** | ~3 s | `data: <JSON availability>` (`MessageEvent.data` = `JSON.stringify(...)`) |
| `GET /api/v1/reports/dashboard/realtime/:organizationId/stream` | JWT+Roles+Org (`analytics:read`) | 10 s | `data: <JSON dashboard>` |

### Problema de autenticación con `EventSource`

La API nativa `EventSource` del navegador **no permite** headers personalizados (`Authorization`, `X-CSRF-Token`, cookies SameSite cross-site pueden fallar según origen).

- El stream de **inventory** es público → `EventSource` funciona.
- El stream de **reports** exige JWT + guards de clase. Con cookies same-site y `credentials` en un polyfill/`fetch`+ReadableStream sí; con `EventSource` puro cross-origin **no** se puede enviar Bearer. Opciones reales: cookie same-site same-origin, proxy same-origin, o polyfill SSE con fetch.

---

## 6. Endpoints internos (worker)

Requieren header `X-Internal-Secret` igual a `process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET`. Usados por `apps/worker`.

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/v1/events/schedule/tick` | Transiciones temporales (publish/on-sale/close) |
| POST | `/api/v1/payments/reconcile/spei` | Reconciliación SPEI/OXXO pendientes |

**No son públicos.** Si el secreto falta o no coincide → `401 Unauthorized`.

---

## 7. Conteo de endpoints

| Dominio | # |
|---|---|
| Salud | 2 |
| Auth | 12 |
| Discovery | 6 |
| Inventory | 6 |
| Pricing | 11 |
| Orders | 7 |
| Payments | 9 |
| Access | 2 |
| Metrics | 12 |
| Analytics | 5 |
| Reporting | 9 |
| Resale | 8 |
| Waitlist | 5 |
| Ticket Transfer | 4 |
| Season | 3 |
| Event Management | 11 |
| Event Scheduling | 20 |
| Venue Layout (+ publish) | 12 |
| Layout Management | 4 |
| Seat Mapping 3D | 4 |
| Taquilla POS | 23 |
| Channel Management | 7 |
| Campaign Execution | 13 |
| Search | 5 |
| Fraud | 6 |
| Billing/CFDI | 4 |
| Organization | 7 |
| Tenant | 1 |
| Partners | 3 |
| Partner API | 3 |
| Admin | 17 |
| **Total** | **241** |

---

## 8. Stubs, datos simulados y código deprecado

| Endpoint / área | Evidencia |
|---|---|
| `POST /fraud/kyc/:userId` | Servicio retorna siempre `{ status: 'verified' }` sin proveedor externo |
| `POST /fraud/aml/:organizationId` | Retorna siempre `{ status: 'cleared', isWatchlisted: false }` |
| `POST /taquilla/payment` | Marcado `@deprecated`; stub legacy que redirige a usar checkout |
| `GET /3d/venue/:venueId` | `@deprecated: true` en Swagger |
| `POST /season/purchase/:seasonPassId` | Summary: “demo completes immediately” |
| Payments modo demo | `isDemo` completa órdenes sin cobro real; reconcile SPEI no-op en demo |
| Loyalty award/balance | Persiste en `user.metadata.loyalty`, no en tabla dedicada |
| `POST /fraud/flags/:flagId/resolve` | Actor fijado a `'admin-user'` en el controller |

---

## 9. Inconsistencias detectadas

1. **Rutas / responsabilidades solapadas**
   - Campañas: `POST /events/manage/:eventId/campaigns` vs módulo `campaigns/*`.
   - Canales: `PUT /events/manage/:eventId/channels` vs `POST /channels/:eventId/configure`.
   - Calendario: `GET /events/manage/calendar/:month/:year` vs `GET /events/schedule/calendar`.
   - Heatmap: `GET /reports/heatmap/:eventId` vs `GET /3d/events/:eventId/heatmap`.
   - Settlement: `POST /analytics/.../settlement`, `GET /reports/settlement/...`, `GET /metrics/settlements`.
   - Fraud analytics: `/analytics/.../fraud` vs `/metrics/fraud` vs `/fraud/*`.

2. **Guards ausentes o débiles**
   - `POST /fraud/analyze` es público.
   - Orders GETs por `publicId` (status/qrcodes/pdf/detalle) sin auth.
   - Inventory map/availability/stream públicos (stream SSE sin auth).
   - Channel Management sin `OrgAccessGuard` (aislamiento solo por `eventId` en servicio, si existe).
   - Waitlist `organization/:orgId` sin `OrgAccessGuard`.
   - Event Management sin `OrgAccessGuard` en rutas por `eventId`.
   - Admin confía solo en `user.organizationId` del JWT (ok para tenant-bound; ADMIN no es SUPER_ADMIN cross-tenant aquí).

3. **DTOs sin validación class-validator**
   - Bodies inline en Admin, Event Management, Event Scheduling, Fraud, Orders create, Payments intents/confirm, Channel allocate (`{ totalTickets }`), Taquilla (types sin decoradores).
   - `GET /events/manage/search` usa `@Query() filters: any`.

4. **Ámbito de tenant**
   - Fraud `listFlags` no filtra por organización.
   - `RolesGuard` trata `ADMIN` con jerarquía alta pero `OrgAccessGuard` solo exime a `SUPER_ADMIN` — Metrics permite a `ADMIN` override `organizationId` en servicio; Analytics también. Documentado en SECURITY-MIGRATION: “ADMIN is tenant-bound” vs comportamiento de Metrics/Analytics que tratan ADMIN como cross-tenant para `organizationId` query/param.

5. **Partner scopes**
   - Default incluye `write:orders` pero no hay endpoint write en `PartnerApiController`.

6. **SSE + auth**
   - Reports stream protegido incompatible con `EventSource` nativo sin cookies same-origin.
