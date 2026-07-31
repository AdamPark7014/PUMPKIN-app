# Módulo Metrics — referencia exhaustiva

Contratos tipados en `packages/shared/src/analytics-contracts.ts`.  
Implementación: `apps/api/src/modules/metrics/`.  
Índice general de la API: [README.md](./README.md).

| Archivo | Rol |
|---|---|
| `metrics.controller.ts` | 12 GET bajo `/api/v1/metrics` |
| `metrics.service.ts` | Agregados Prisma / SQL |
| `metrics-cache.service.ts` | Caché in-process TTL |
| `metrics.module.ts` | Wiring Nest |
| `dto/metrics-query.dto.ts` | Query DTOs |
| `packages/shared/src/analytics-contracts.ts` | Tipos de respuesta |
| `apps/admin/lib/queries/metrics.ts` | Hooks React Query |
| `apps/admin/lib/query-keys.ts` | `queryKeys.metrics.*` |

---

## Seguridad y alcance

```
@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
```

- Autenticación JWT (cookie o Bearer). Mutaciones N/A (solo GET).
- `resolveOrganizationId`:
  - `SUPER_ADMIN` / `ADMIN`: pueden pasar `organizationId` en query; si no, usan `user.organizationId`; si ninguno → 400.
  - Otros roles: siempre `user.organizationId`; si query trae otra org → 403.
- `OrgAccessGuard`: si llega `organizationId` en query y el usuario no es `SUPER_ADMIN`, exige coincidencia con JWT. **Nota:** el servicio trata `ADMIN` como cross-tenant; el guard solo exime a `SUPER_ADMIN`. Un `ADMIN` con `organizationId` ajeno en query puede ser bloqueado por el guard antes de llegar al servicio.

---

## Query DTOs

### `MetricsRangeQueryDto`

| Campo | Validación | Default |
|---|---|---|
| `from` | `@IsOptional` `@IsDateString` | Inicio de mes en `America/Mexico_City` (aprox. UTC-6 medianoche del día 1) |
| `to` | `@IsOptional` `@IsDateString` | `now` |
| `organizationId` | `@IsOptional` `@IsString` | Solo ADMIN/SUPER_ADMIN |
| `eventId` | `@IsOptional` `@IsString` | Usado en inventory/access/timeseries |

Reglas en `resolveRange`:

- `from < to` obligatorio.
- Span máximo **366 días**.
- Periodo de comparación = intervalo de igual duración inmediatamente anterior a `from`.

### `MetricsPagedQueryDto` extends Range

| Campo | Validación | Default |
|---|---|---|
| `page` | int ≥ 1 | 1 |
| `pageSize` | int 1–100 | 25 |

> En `getAlerts` el controlador **no** pasa `page`/`pageSize` al servicio; el DTO los acepta pero hoy se ignoran.

### `MetricsTimeSeriesQueryDto` extends Range

| Campo | Validación | Default |
|---|---|---|
| `granularity` | enum `hour`\|`day`\|`week`\|`month` | `day` |
| `metric` | string | `revenue` |

Métricas soportadas en servicio: `revenue` \| `orders` \| `tickets` \| `refunds` \| `checkins`. Cualquier otra → 400.

---

## Zona horaria y moneda

| Constante | Valor |
|---|---|
| `MX_TZ` | `America/Mexico_City` |
| `CURRENCY` | `MXN` |

- Respuestas ejecutiva incluyen `timezone` y `currency`.
- Buckets temporales: `date_trunc('<hour|day|week|month>', …)` en PostgreSQL sobre timestamps almacenados; el label ISO de cada bucket es `bucket.toISOString()` (UTC). El default de `from` alinea al inicio de mes CDMX via `Intl` + `Date.UTC(y, m-1, 1, 6, 0, 0)` (comentario en código: “Approximate Mexico City midnight as UTC-6”).

---

## Caché

`MetricsCacheService`: `Map` in-process.

| Propiedad | Valor |
|---|---|
| TTL default | **45 segundos** (`DEFAULT_TTL_SECONDS`) |
| Clave | `wrapKey(parts)` → `parts.join('|')` con `null/undefined` → `_` |
| Eviction | Lazy al leer si `Date.now() > expiresAt` |

TTLs por endpoint (pasados a `cached`):

| Prefijo clave | TTL (s) | Endpoint |
|---|---|---|
| `exec\|…` | 45 | executive |
| `pace\|…` | 60 | sales-pace |
| `inv\|…` | 45 | inventory |
| `orders\|…` | 45 | orders |
| `access\|…` | 45 | access |
| `resale\|…` | 60 | resale |
| `waitlist\|…` | 60 | waitlist |
| `campaigns\|…` | 60 | campaigns |
| `fraud\|…` | 45 | fraud |
| `settle\|…` | 60 | settlements |
| `ts\|…` | 30 | timeseries |
| `alerts\|…` | 60 | alerts |

---

## Fórmulas compartidas

### `MetricsKpi.deltaPercent`

```
delta = value - previousValue
deltaPercent =
  previousValue === 0
    ? (value === 0 ? 0 : null)
    : (delta / previousValue) * 100
```

Redondeo a 2 decimales (`round`). Si `unit === 'mxn'` → `currency: 'MXN'`.

### Proyección `linear_pace` (executive)

```
daysInPeriod = max(1, (to - from) / 1d)
daysElapsed  = min(daysInPeriod, max(1, (now - from) / 1d))
pace         = daysElapsed / daysInPeriod
projectedGrossRevenue = pace > 0 ? gross / pace : gross
projectedTicketsSold  = round(pace > 0 ? tickets / pace : tickets)
```

---

## Endpoints

### 1. `GET /api/v1/metrics/executive`

**Roles:** PROMOTER, ADMIN, SUPER_ADMIN, VENUE_MANAGER.  
**Query:** `MetricsRangeQueryDto`.  
**Respuesta:** `ExecutiveSummaryMetrics`.

**Cálculo:**

- Órdenes `COMPLETED` en rango: `sum(totalAmount)`, `sum(commissionAmount)`, count.
- Comisión fallback: `gross * organization.commissionRate` si commissionAmount es 0.
- `netRevenue = gross - commission`.
- Tickets: `SUM(OrderItem.quantity)` join órdenes COMPLETED.
- `averageTicketPrice = gross / tickets` (0 si sin tickets).
- `conversionRate = (completed / allOrdersInRange) * 100`.
- `revenueByChannel`: groupBy `channel` de órdenes COMPLETED.
- Serie diaria de ingresos (`date_trunc('day')`).
- Proyección `linear_pace` (arriba).

**Ejemplo JSON:**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "2026-07-01T06:00:00.000Z", "to": "2026-07-30T18:00:00.000Z" },
  "comparisonRange": { "from": "2026-06-01T12:00:00.000Z", "to": "2026-07-01T06:00:00.000Z" },
  "currency": "MXN",
  "timezone": "America/Mexico_City",
  "kpis": {
    "grossRevenue": {
      "key": "grossRevenue",
      "label": "Ingresos brutos",
      "value": 150000,
      "previousValue": 120000,
      "delta": 30000,
      "deltaPercent": 25,
      "unit": "mxn",
      "currency": "MXN"
    },
    "netRevenue": { "key": "netRevenue", "label": "Ingresos netos", "value": 135000, "previousValue": 108000, "delta": 27000, "deltaPercent": 25, "unit": "mxn", "currency": "MXN" },
    "ticketsSold": { "key": "ticketsSold", "label": "Boletos vendidos", "value": 1200, "previousValue": 1000, "delta": 200, "deltaPercent": 20, "unit": "count" },
    "averageTicketPrice": { "key": "averageTicketPrice", "label": "Ticket promedio", "value": 125, "previousValue": 120, "delta": 5, "deltaPercent": 4.17, "unit": "mxn", "currency": "MXN" },
    "conversionRate": { "key": "conversionRate", "label": "Tasa de conversión", "value": 72.5, "previousValue": 70, "delta": 2.5, "deltaPercent": 3.57, "unit": "percent" },
    "ordersCompleted": { "key": "ordersCompleted", "label": "Órdenes completadas", "value": 800, "previousValue": 700, "delta": 100, "deltaPercent": 14.29, "unit": "count" }
  },
  "revenueByChannel": {
    "dimension": "channel",
    "label": "Ingresos por canal",
    "total": 150000,
    "rows": [
      { "key": "WEB", "label": "WEB", "value": 100000, "secondaryValue": 500, "percentOfTotal": 66.67 }
    ]
  },
  "projection": {
    "projectedGrossRevenue": 155172.41,
    "projectedTicketsSold": 1241,
    "method": "linear_pace",
    "daysElapsed": 29,
    "daysInPeriod": 30
  },
  "series": [
    {
      "key": "revenue",
      "label": "Ingresos diarios",
      "granularity": "day",
      "unit": "mxn",
      "points": [{ "bucket": "2026-07-01T00:00:00.000Z", "value": 5200 }]
    }
  ],
  "generatedAt": "2026-07-30T18:00:00.000Z"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/executive?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z" ^
  -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json"
```

---

### 2. `GET /api/v1/metrics/events/sales-pace`

**Respuesta:** `EventSalesPaceMetrics`.

**Cálculo por evento** (status `SCHEDULED|LIVE|DRAFT|RESCHEDULED`, `startsAt >= from`, take 200):

```
capacity     = max(totalCapacity, ticketCount, 1)
sold         = tickets SOLD|USED|TRANSFERRED
actualPace   = sold / capacity
saleStart    = salesStartAt ?? createdAt
saleWindowMs = max(1, startsAt - saleStart)
elapsedMs    = clamp(now - saleStart, 0, saleWindowMs)
expectedPace = elapsedMs / saleWindowMs
paceDelta    = actualPace - expectedPace
```

**Umbrales `riskLevel`** (solo si `daysUntilEvent >= 0` **y** `expectedPace > 0.15`):

| Condición | riskLevel |
|---|---|
| `paceDelta < -0.35` | `critical` |
| `paceDelta < -0.2` | `at_risk` |
| `paceDelta < -0.1` | `watch` |
| else | `on_track` |

- `atRisk` = filas `at_risk|critical` ordenadas por `paceDelta` asc.
- `topPerformers` = `paceDelta >= 0` y `ticketsSold > 0`, top 10.

**Ejemplo JSON (fila):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "events": [
    {
      "eventId": "evt_1",
      "title": "Concierto",
      "status": "SCHEDULED",
      "startsAt": "2026-08-15T02:00:00.000Z",
      "daysUntilEvent": 16,
      "totalCapacity": 5000,
      "ticketsSold": 1200,
      "occupancyPercent": 24,
      "remainingCapacity": 3800,
      "grossRevenue": 840000,
      "actualPace": 0.24,
      "expectedPace": 0.55,
      "paceDelta": -0.31,
      "riskLevel": "at_risk"
    }
  ],
  "atRisk": [],
  "topPerformers": [],
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/events/sales-pace" -H "Authorization: Bearer %TOKEN%"
```

---

### 3. `GET /api/v1/metrics/inventory`

**Query:** Range + `eventId?`.  
**Respuesta:** `InventoryMetrics`.

**Cálculo:**

- Offers (take 500) filtradas por org (+ evento opcional).
- Por zona/offer:
  ```
  daysOnSale = max(1, (now - offer.startDate) / 1d)
  sellThroughVelocity = soldQuantity / daysOnSale
  daysToSellOut = velocity > 0.01 ? remainingQuantity / velocity : null
  availabilityPercent = remaining / total * 100
  ```
- Summary: capacity/available desde offers; held/sold desde ticket statuses; `blocked` = tickets AVAILABLE cuyo offer `isAvailable=false`; `activeHolds` = SeatHold ACTIVE no expirados.
- `statusBreakdown` por `Ticket.status`.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "summary": {
    "totalCapacity": 10000,
    "available": 4200,
    "held": 180,
    "sold": 5500,
    "blocked": 50,
    "activeHolds": 42
  },
  "byZone": [
    {
      "eventId": "evt_1",
      "eventTitle": "Concierto",
      "offerId": "off_1",
      "zone": "VIP",
      "tierName": "VIP A",
      "totalQuantity": 200,
      "remainingQuantity": 40,
      "soldQuantity": 150,
      "holdQuantity": 10,
      "availabilityPercent": 20,
      "sellThroughVelocity": 5.172,
      "daysToSellOut": 7.7
    }
  ],
  "statusBreakdown": {
    "dimension": "ticketStatus",
    "label": "Inventario por estado",
    "total": 10000,
    "rows": [{ "key": "SOLD", "label": "SOLD", "value": 5000, "percentOfTotal": 50 }]
  },
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/inventory?eventId=evt_1" -H "Authorization: Bearer %TOKEN%"
```

---

### 4. `GET /api/v1/metrics/orders`

**Respuesta:** `OrdersPaymentsMetrics`.

**Cálculo:**

```
approvalRate = completedOrders / allOrdersInRange * 100
refundRate   = completedRefundsCount / completedOrders * 100
```

- Chargebacks: count `FraudFlag` type `CHARGEBACK` scoped a order/event de la org.
- Breakdowns: `volumeByStatus`, `paymentMethodBreakdown` (ingresos COMPLETED por `paymentMethod`).
- KPIs con comparación al periodo previo.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "comparisonRange": { "from": "…", "to": "…" },
  "volumeByStatus": {
    "dimension": "orderStatus",
    "label": "Volumen por estado",
    "total": 1000,
    "rows": [
      { "key": "COMPLETED", "label": "COMPLETED", "value": 800, "secondaryValue": 150000, "percentOfTotal": 80 }
    ]
  },
  "paymentMethodBreakdown": {
    "dimension": "paymentMethod",
    "label": "Método de pago",
    "total": 150000,
    "rows": []
  },
  "kpis": {
    "approvalRate": { "key": "approvalRate", "label": "Tasa de aprobación", "value": 80, "previousValue": 78, "delta": 2, "deltaPercent": 2.56, "unit": "percent" },
    "refundRate": { "key": "refundRate", "label": "Tasa de reembolso", "value": 3.5, "previousValue": 2, "delta": 1.5, "deltaPercent": 75, "unit": "percent" },
    "chargebackCount": { "key": "chargebackCount", "label": "Contracargos", "value": 2, "previousValue": 1, "delta": 1, "deltaPercent": 100, "unit": "count" },
    "completedOrders": { "key": "completedOrders", "label": "Órdenes completadas", "value": 800, "previousValue": 700, "delta": 100, "deltaPercent": 14.29, "unit": "count" },
    "grossRevenue": { "key": "grossRevenue", "label": "Ingresos brutos", "value": 150000, "previousValue": 120000, "delta": 30000, "deltaPercent": 25, "unit": "mxn", "currency": "MXN" }
  },
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/orders" -H "Authorization: Bearer %TOKEN%"
```

---

### 5. `GET /api/v1/metrics/access`

**Query:** Range + `eventId?`.  
**Respuesta:** `AccessAttendanceMetrics`.

**Cálculo:**

- Serie horaria: `TicketScan` exitosos (`success=true`) con `date_trunc('hour', scannedAt)`.
- `ticketsSold` = status SOLD|USED|TRANSFERRED (org / event).
- `ticketsCheckedIn` = mismos con `checkedInAt != null`.
- ```
  noShow = max(0, sold - checkedIn)
  noShowRate = sold > 0 ? noShow / sold * 100 : 0
  ```
- Tráfico por `AccessZone.name` (o `'Sin zona'`).

**Ejemplo JSON:**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "eventId": "evt_1",
  "checkInByHour": {
    "key": "checkins",
    "label": "Check-ins por hora",
    "granularity": "hour",
    "unit": "count",
    "points": [{ "bucket": "2026-07-30T01:00:00.000Z", "value": 120 }]
  },
  "noShowRate": 18.5,
  "ticketsSold": 2000,
  "ticketsCheckedIn": 1630,
  "ticketsNoShow": 370,
  "trafficByAccessPoint": {
    "dimension": "accessPoint",
    "label": "Tráfico por punto de acceso",
    "total": 1630,
    "rows": [{ "key": "Puerta A", "label": "Puerta A", "value": 900, "percentOfTotal": 55.21 }]
  },
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/access?eventId=evt_1" -H "Authorization: Bearer %TOKEN%"
```

---

### 6. `GET /api/v1/metrics/resale`

**Respuesta:** `ResaleMetrics`.

- Listings filtrados por `ticket.event.organizationId` y `listedAt` en rango.
- `activeListings` = count status ACTIVE (sin filtro de rango de fechas en ese count).
- `cancelledListings` = CANCELLED + DELISTED en el groupBy del rango.
- GMV / fees / precios promedio desde listings SOLD.
- Serie diaria de nuevos listados.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "summary": {
    "activeListings": 12,
    "soldListings": 40,
    "cancelledListings": 8,
    "grossGmv": 95000,
    "platformFees": 4750,
    "averageAskingPrice": 2100,
    "averageSoldPrice": 2375
  },
  "statusBreakdown": {
    "dimension": "resaleStatus",
    "label": "Listados por estado",
    "total": 60,
    "rows": []
  },
  "series": [
    {
      "key": "listings",
      "label": "Nuevos listados diarios",
      "granularity": "day",
      "unit": "count",
      "points": []
    }
  ],
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/resale" -H "Authorization: Bearer %TOKEN%"
```

---

### 7. `GET /api/v1/metrics/waitlist`

**Respuesta:** `WaitlistMetrics`.

```
top = pending + notified + converted + expired + cancelled
conversionRate = top > 0 ? converted / top * 100 : 0
```

Embudo (conteos acumulativos hacia abajo):

| Stage | count |
|---|---|
| `pending` “En lista” | pending + notified + converted |
| `notified` | notified + converted |
| `converted` | converted |

`conversionFromPrevious` / `conversionFromTop` en %. Top 25 eventos por entradas.

**Ejemplo JSON:**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "summary": {
    "pending": 100,
    "notified": 40,
    "converted": 25,
    "expired": 10,
    "cancelled": 5,
    "conversionRate": 13.89
  },
  "byEvent": [{ "key": "evt_1", "label": "Concierto", "value": 80 }],
  "funnel": {
    "key": "waitlist",
    "label": "Embudo de lista de espera",
    "stages": [
      { "key": "pending", "label": "En lista", "count": 165, "conversionFromPrevious": null, "conversionFromTop": 100 },
      { "key": "notified", "label": "Notificados", "count": 65, "conversionFromPrevious": 39.39, "conversionFromTop": 39.39 },
      { "key": "converted", "label": "Convertidos", "count": 25, "conversionFromPrevious": 38.46, "conversionFromTop": 15.15 }
    ]
  },
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/waitlist" -H "Authorization: Bearer %TOKEN%"
```

---

### 8. `GET /api/v1/metrics/campaigns`

**Respuesta:** `CampaignFunnelMetrics`.

Por promoción (take 100, overlapping rango):

```
limit = usageLimit ?? max(usageCount, 1)
conversionRate = ordersAttributed / limit * 100
performance =
  conversionRate >= 40 → 'strong'
  conversionRate < 10  → 'poor'
  else 'average'
```

Embudo: cupo asignado → canjes/órdenes → # promos con `revenueAttributed > 0`.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "promotions": [
    {
      "promotionId": "promo_1",
      "code": "EARLY20",
      "name": "Early bird",
      "usageCount": 30,
      "usageLimit": 100,
      "ordersAttributed": 28,
      "revenueAttributed": 42000,
      "discountGiven": 5600,
      "conversionRate": 28,
      "performance": "average"
    }
  ],
  "funnel": {
    "key": "campaigns",
    "label": "Embudo de campañas",
    "stages": [
      { "key": "allocated", "label": "Cupo asignado", "count": 100, "conversionFromPrevious": null, "conversionFromTop": 100 },
      { "key": "redeemed", "label": "Canjes / órdenes", "count": 28, "conversionFromPrevious": 28, "conversionFromTop": 28 },
      { "key": "revenue", "label": "Órdenes con ingreso", "count": 1, "conversionFromPrevious": 3.57, "conversionFromTop": 1 }
    ]
  },
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/campaigns" -H "Authorization: Bearer %TOKEN%"
```

---

### 9. `GET /api/v1/metrics/fraud`

**Respuesta:** `FraudSignalsMetrics`.

Scope: flags con `order.organizationId` **o** `event.organizationId` en rango.

- `openFlags`: status `FLAGGED|INVESTIGATING`.
- `criticalFlags`: severity `CRITICAL`.
- `falsePositives`: status `FALSE_POSITIVE`.
- `recentSignals`: últimas 20.
- Breakdowns por `type` y `severity`.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "summary": {
    "totalFlags": 15,
    "openFlags": 4,
    "criticalFlags": 1,
    "averageRiskScore": 62.3,
    "resolvedFlags": 8,
    "falsePositives": 2
  },
  "byType": { "dimension": "fraudType", "label": "Señales por tipo", "total": 15, "rows": [] },
  "bySeverity": { "dimension": "fraudSeverity", "label": "Señales por severidad", "total": 15, "rows": [] },
  "recentSignals": [
    {
      "id": "ff_1",
      "type": "VELOCITY",
      "severity": "HIGH",
      "score": 78,
      "reason": "…",
      "status": "FLAGGED",
      "orderId": "ord_1",
      "eventId": null,
      "createdAt": "…"
    }
  ],
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/fraud" -H "Authorization: Bearer %TOKEN%"
```

---

### 10. `GET /api/v1/metrics/settlements`

**Respuesta:** `SettlementsMetrics`.

```
gross      = sum COMPLETED totalAmount
refunds    = sum COMPLETED Refund.amount (por processedAt)
commission = sum commissionAmount || (gross - refunds) * commissionRate
netPayable = gross - refunds - commission
```

Payouts: `PromoterPayout` overlapping rango (take 50). Contadores pending/completed por status. Top 25 eventos por revenue.

**Ejemplo JSON (fragmento):**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "summary": {
    "grossRevenue": 150000,
    "refunds": 5000,
    "commission": 14500,
    "netPayable": 130500,
    "pendingPayouts": 1,
    "completedPayouts": 3
  },
  "payouts": [
    {
      "id": "pay_1",
      "periodStart": "…",
      "periodEnd": "…",
      "grossRevenue": 50000,
      "commission": 5000,
      "netAmount": 45000,
      "status": "PENDING",
      "referenceId": null,
      "processedAt": null
    }
  ],
  "byEvent": [{ "key": "evt_1", "label": "Concierto", "value": 90000, "secondaryValue": 400 }],
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/settlements" -H "Authorization: Bearer %TOKEN%"
```

---

### 11. `GET /api/v1/metrics/timeseries`

**Query:** `MetricsTimeSeriesQueryDto`.  
**Respuesta:** `MetricsTimeSeriesResponse`.

| `metric` | SQL | unit |
|---|---|---|
| `revenue` | SUM Order.totalAmount COMPLETED | mxn |
| `orders` | COUNT Order COMPLETED | count |
| `tickets` | SUM OrderItem.quantity | count |
| `refunds` | SUM Refund.amount COMPLETED por `requestedAt` | mxn |
| `checkins` | COUNT TicketScan success | count |

Buckets vía `date_trunc(granularity)`. Filtro opcional `eventId`.

**Ejemplo JSON:**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "granularity": "day",
  "metric": "revenue",
  "series": [
    {
      "key": "revenue",
      "label": "Ingresos",
      "granularity": "day",
      "unit": "mxn",
      "points": [
        { "bucket": "2026-07-01T00:00:00.000Z", "value": 5200 },
        { "bucket": "2026-07-02T00:00:00.000Z", "value": 6100 }
      ]
    }
  ],
  "generatedAt": "…"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/timeseries?metric=revenue&granularity=day&from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z" ^
  -H "Authorization: Bearer %TOKEN%"
```

---

### 12. `GET /api/v1/metrics/alerts`

**Query:** `MetricsPagedQueryDto` (page/pageSize **aceptados pero no aplicados**).  
**Respuesta:** `MetricsAlertsResponse`.

Deriva de pace + inventory + orders + campaigns + fraud (reutiliza cachés de esos métodos).

#### Reglas y umbrales hardcodeados

| id patrón | domain | severity | Condición | threshold |
|---|---|---|---|---|
| `pace-{eventId}` | events | critical si risk=critical; else warning | Eventos en `atRisk` | `-0.2` (paceDelta) |
| `inv-{offerId}` | inventory | warning | `availabilityPercent > 70` **y** `daysToSellOut > 45` **y** `totalQuantity >= 50` | `70` |
| `refunds-spike` | orders | critical si refundRate > 15; else warning | `refundRate.value > 8` **y** `delta > 2` | `8` |
| `camp-{promotionId}` | campaigns | info | `performance === 'poor'` (conversionRate < 10) | `10` |
| `fraud-critical` | fraud | critical | `criticalFlags > 0` | — |
| `holds-high` | inventory | info | `activeHolds > 100` | `100` |

Orden de salida: critical → warning → info.  
`countsBySeverity`: conteos de cada severidad.

**Ejemplo JSON:**

```json
{
  "organizationId": "org_01",
  "dateRange": { "from": "…", "to": "…" },
  "alerts": [
    {
      "id": "pace-evt_1",
      "domain": "events",
      "severity": "warning",
      "title": "Ritmo de venta bajo: Concierto",
      "explanation": "El evento lleva 24% de ocupación frente a un ritmo esperado de 55% (16 días para el evento).",
      "suggestedAction": "Activa una campaña de descuento, libera inventario de hold o refuerza canales WEB/TAQUILLA.",
      "entityType": "event",
      "entityId": "evt_1",
      "entityLabel": "Concierto",
      "metricValue": -0.31,
      "threshold": -0.2,
      "detectedAt": "2026-07-30T18:00:00.000Z"
    }
  ],
  "countsBySeverity": { "info": 0, "warning": 1, "critical": 0 },
  "generatedAt": "2026-07-30T18:00:00.000Z"
}
```

```bash
curl -s "http://localhost:4000/api/v1/metrics/alerts" -H "Authorization: Bearer %TOKEN%"
```

---

## Consumo desde Admin

Archivo: `apps/admin/lib/queries/metrics.ts`.

| Hook | Endpoint | Query key |
|---|---|---|
| `useExecutiveMetrics` | `/metrics/executive` | `queryKeys.metrics.executive(params)` |
| `useEventSalesPace` | `/metrics/events/sales-pace` | `…salesPace` |
| `useInventoryMetrics` | `/metrics/inventory` | `…inventory` |
| `useOrdersMetrics` | `/metrics/orders` | `…orders` |
| `useAccessMetrics` | `/metrics/access` | `…access` |
| `useResaleMetrics` | `/metrics/resale` | `…resale` |
| `useWaitlistMetrics` | `/metrics/waitlist` | `…waitlist` |
| `useCampaignMetrics` | `/metrics/campaigns` | `…campaigns` |
| `useFraudMetrics` | `/metrics/fraud` | `…fraud` |
| `useSettlementsMetrics` | `/metrics/settlements` | `…settlements` |
| `useMetricsTimeseries` | `/metrics/timeseries` | `…timeseries` |
| `useMetricsAlerts` | `/metrics/alerts` | `…alerts` |

- `staleTime` cliente: **20_000 ms** (comentario: backend cachea ~30–60s).
- Params comunes: `from`, `to`, `organizationId`, `eventId`.
- Timeseries exige `granularity` + `metric` tipado (`revenue|orders|tickets|refunds|checkins`).

Definición de keys en `apps/admin/lib/query-keys.ts` → `queryKeys.metrics`.

---

## Metrics vs Analytics {#metrics-vs-analytics}

| | **metrics** (nuevo) | **analytics** (anterior) |
|---|---|---|
| Prefijo | `/api/v1/metrics/*` | `/api/v1/analytics/*` |
| Contratos | `ExecutiveSummaryMetrics`, pace, inventory, … en `analytics-contracts.ts` | `EventDashboardMetrics`, `PromoterDashboardMetrics` |
| Enfoque | Agregados de negocio multi-dominio, series, alertas, comparación de periodos | Dashboard por evento / promotor / settlement puntual |
| Caché | In-process TTL 30–60s | Propia del servicio analytics |
| Admin | `queryKeys.metrics.*` + hooks en `queries/metrics.ts` | `queryKeys.analytics.*` (promoter, realtime vía reports) |

**Cuál usar:** paneles nuevos del admin → **metrics**. Integraciones o pantallas que aún consumen `EventDashboardMetrics` / `PromoterDashboardMetrics` → **analytics**.

**Solapamientos:**

- Ingresos / tickets / comisión: executive metrics ≈ promoter dashboard analytics.
- Fraud: `/metrics/fraud` vs `/analytics/promoters/:id/fraud` vs módulo `/fraud/*`.
- Settlements: `/metrics/settlements` vs `POST /analytics/.../settlement` vs `GET /reports/settlement/...`.
- Realtime: no existe en metrics; usar `/reports/dashboard/realtime/...` (+ SSE).

---

## Números hardcodeados (índice rápido)

| Constante | Valor | Dónde |
|---|---|---|
| Max rango días | 366 | `resolveRange` |
| TTL cache default | 45 s | `MetricsCacheService` |
| risk: gate expectedPace | `> 0.15` | sales-pace |
| risk: watch / at_risk / critical | `-0.1` / `-0.2` / `-0.35` | sales-pace |
| daysToSellOut velocity floor | `> 0.01` | inventory |
| Campaign strong / poor | `≥ 40%` / `< 10%` | campaigns |
| Alert inventory availability | `> 70%` | alerts |
| Alert daysToSellOut | `> 45` | alerts |
| Alert min offer qty | `≥ 50` | alerts |
| Alert refundRate | `> 8` (+ delta `> 2`); critical `> 15` | alerts |
| Alert activeHolds | `> 100` | alerts |
| Events pace take | 200 | sales-pace |
| Offers take | 500 | inventory |
| Promotions take | 100 | campaigns |
| Fraud recent | 20 | fraud |
| Payouts take | 50 | settlements |
| Waitlist byEvent LIMIT | 25 | waitlist |

---

## Enlaces

- [README API](./README.md)
- [Arquitectura](../arquitectura.md)
- [Consultas multi-tenant](../guias/consultas-multi-tenant.md)
- [SECURITY-MIGRATION](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md)
- Contratos: `packages/shared/src/analytics-contracts.ts`
