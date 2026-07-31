# Consultas multi-tenant seguras

Guía crítica. El aislamiento **no** lo hace PostgreSQL RLS ni una extensión de Prisma: lo hace cada query que escribes. Fuente de contrato: [`SECURITY-MIGRATION.md`](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md) (sección *Tenant-scoped module adoption*).

---

## Regla de oro

1. Lookups compuestos `{ id, organizationId }` (o `findFirst` con ambos en `where`).
2. **Nunca** `findUnique({ where: { id } })` seguido de un “if org !== …” a posteriori: es una ventana de IDOR y enseña mal el patrón.
3. Incluye `organizationId` en todo `where`, `create` y conexión de relaciones de entidades tenant-owned.
4. Si el org llega **indirecto** (vía `eventId`, `venueId`, `ticketId`, …): resuelve la entidad, luego `assertOrganization(entidad.organizationId)` (o el org heredado).
5. No hay magia: `OrgAccessGuard` solo valida si el request **trae** un org id; si no trae, pasa. El service debe filtrar igual.

---

## Piezas de runtime

### `TenantContextInterceptor`

`apps/api/src/common/tenant-context.interceptor.ts`

- `privileged = user.role === 'SUPER_ADMIN'`
- Si el request menciona un org distinto al del JWT y no es privilegiado → `403`
- Corre el handler dentro de `TenantContextService.run({ organizationId, userId, privileged })`

### `TenantContextService`

```22:35:apps/api/src/common/tenant-context.service.ts
  requireOrganization(): string {
    const context = this.current();
    if (!context.organizationId || context.privileged) {
      throw new ForbiddenException('A tenant-scoped organization is required');
    }
    return context.organizationId;
  }

  assertOrganization(organizationId: string): void {
    const context = this.current();
    if (!context.privileged && context.organizationId !== organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
  }
```

### `TenantScopeService`

`apps/api/src/modules/tenant/tenant-scope.service.ts` — capa recomendada cuando SUPER_ADMIN debe nombrar el tenant:

- `resolve(requested?)` — privilegiado exige org explícito (o el del token); resto → `requireOrganization()` + assert del requested
- `assert(organizationId)` / `assertAnonymousOrOwn` / `actorId()` / `isPrivileged()`

### Roles

| Rol | Contexto ALS | Cross-tenant |
|-----|--------------|--------------|
| `SUPER_ADMIN` | `privileged: true` | Sí (debe pasar `organizationId` cuando usa `TenantScopeService.resolve`) |
| `ADMIN` | tenant-bound (`privileged: false`) | **No** según interceptor + SECURITY-MIGRATION |
| Resto | tenant-bound | No |

**Trampa documentada:** `MetricsService.resolveOrganizationId` trata `ADMIN` como override de `query.organizationId` igual que `SUPER_ADMIN`. Eso diverge del contrato de seguridad. No copies ese patrón a módulos nuevos sin decisión explícita de producto/seguridad.

---

## Cómo llega `organizationId` en Prisma

Schema: `packages/database/prisma/schema.prisma`.

### Directo (`organizationId` en el modelo)

| Modelo | Notas |
|--------|--------|
| `Venue` | FK org |
| `Event` | FK org (+ `venueId`) |
| `EventSeries` | FK org |
| `Order` | FK org (`OrgOrders`) |
| `User` | `organizationId` opcional |
| `TenantTheme` | 1:1 org |
| `AuditEvent` | opcional |
| `CashierShift` | FK org |
| `PosTerminal` | FK org |
| `ApiKey` | FK org |
| `PromoterPayout` | FK org |
| `FiscalProfile` | único por org |
| `CfdiInvoice` | FK org |
| `SeasonPass` | FK org |
| `FraudFlag` | (ver schema; ligado a org en el modelo) |
| `Cart` / otros con columna org | Revisar el modelo concreto antes de consultar |

### Heredado (sin columna org — hay que join/filtrar por padre)

| Modelo | Camino al org |
|--------|----------------|
| `VenueLayout` | `venue.organizationId` |
| `Section` / `SeatRow` / `Seat` | `layout → venue → organizationId` |
| `EventSeatMap` | `event.organizationId` (o layout→venue) |
| `SeatHold` | `event.organizationId` |
| `AccessZone` | `venue.organizationId` |
| `TicketScan` | `ticket → event.organizationId` |
| `PaymentIntent` | vía `orderId` → `Order.organizationId` |
| `SalePhase` / `Offer` / `Ticket` | `event.organizationId` |
| `VenueBlackout` | `venue.organizationId` |
| `OrderItem` / `Payment` / `Refund` | `order.organizationId` |
| `ResaleListing` / `ResaleOffer` | vía ticket/event (revisar include) |
| `DynamicPrice` / `Promotion` | vía event |
| `WaitlistEntry` | vía event |
| `TicketTransfer` | vía ticket/event |
| `SeasonPassEvent` / `SeasonPassPurchase` | `seasonPass.organizationId` |
| `Session` | vía `user.organizationId` |
| `PosCashierSession` | vía `terminal.organizationId` |
| `EventAnalytics` | vía event/org según schema |

---

## CORRECTO vs INCORRECTO

### Correcto — lookup compuesto (event hub)

```403:413:apps/api/src/modules/event-management/event-management.service.ts
  async getEventHub(eventId: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      include: {
        venue: { select: { id: true, name: true, slug: true } },
        offers: true,
        seatMap: true,
        _count: { select: { tickets: true, orders: true } },
      },
    });
```

### Correcto — venue/event con assert (layout-access)

```64:85:apps/api/src/modules/venue-layout/layout-access.service.ts
  async requireVenue(venueId: string, organizationId?: string) {
    const orgId = this.resolveOrganizationId(organizationId);
    const venue = orgId
      ? await this.prisma.venue.findFirst({
          where: { id: venueId, organizationId: orgId },
        })
      : await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');
    this.tenant.assertOrganization(venue.organizationId);
    return venue;
  }

  async requireEvent(eventId: string, organizationId?: string) {
    const orgId = this.resolveOrganizationId(organizationId);
    const event = orgId
      ? await this.prisma.event.findFirst({
          where: { id: eventId, organizationId: orgId },
        })
      : await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }
```

Nota: el branch `findUnique` solo corre cuando `orgId` es `undefined` (SUPER_ADMIN privileged sin org explícito). Después **siempre** hay `assertOrganization`. Para código tenant-bound nuevo, preferí siempre el `findFirst` compuesto.

### Correcto — order taquilla

```111:123:apps/api/src/modules/taquilla-pos/pos-access.service.ts
  async requireOrder(orderId: string, organizationId?: string) {
    const orgId = organizationId ?? this.resolveOrganizationId();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId: orgId },
      include: {
        event: { select: { id: true, title: true, startsAt: true, organizationId: true } },
        items: { include: { tickets: true } },
        refunds: { select: { id: true, status: true, amount: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.tenant.assertOrganization(order.organizationId);
    return order;
  }
```

### Incorrecto — id-only en mutación de evento (canal)

```51:55:apps/api/src/modules/channel-management/channel-management.service.ts
    const existing = await this.prisma.event.findUnique({ where: { id: eventId } });
    const prev = this.asMetadataObject(existing?.metadata);

    const event = await this.prisma.event.update({
      where: { id: eventId },
```

Sin `organizationId` en el `where` ni `assertOrganization` sobre `existing.organizationId`.

### Incorrecto — merge metadata por id

```18:26:apps/api/src/modules/event-management/event-management.service.ts
  private async mergeMetadata(eventId: string, patch: EventMetadata) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');
    const current = (event.metadata as EventMetadata) ?? {};
    return this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...current, ...patch } as Prisma.InputJsonValue },
```

### Incorrecto — refund admin por id de orden

```294:298:apps/api/src/modules/admin/admin.service.ts
  async manualRefund(orderId: string, amount?: number, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { refunds: true },
    });
```

### Incorrecto — season purchase por id

```75:76:apps/api/src/modules/season/season.service.ts
    const pass = await this.prisma.seasonPass.findUnique({ where: { id: seasonPassId } });
    if (!pass?.active) throw new NotFoundException('Season pass not found');
```

(`list` del mismo service sí filtra `where: { organizationId: orgId }` — asimetría.)

### Incorrecto — hold release por id

```261:262:apps/api/src/modules/inventory/inventory.service.ts
  async releaseHold(holdId: string) {
    const hold = await this.prisma.seatHold.findUnique({ where: { id: holdId } });
```

`SeatHold` hereda org vía `event`; aquí no se aserta.

---

## Violaciones / riesgos reales (muestra)

Lista no exhaustiva de `findUnique({ where: { id } })` (o equivalente id-only) en código de servicios que tocan entidades tenant-owned. Úsala como backlog de hardening; algunas pueden estar detrás de guards de ruta o ser paths internos — **igual** deberían migrar al patrón compuesto.

| Archivo | Línea (aprox.) | Entidad |
|---------|----------------|---------|
| `modules/channel-management/channel-management.service.ts` | 51, 137 | `Event` |
| `modules/event-management/event-management.service.ts` | 19, 281 | `Event` |
| `modules/admin/admin.service.ts` | 295 | `Order` (refund) |
| `modules/season/season.service.ts` | 75 | `SeasonPass` |
| `modules/inventory/inventory.service.ts` | 262 | `SeatHold` |
| `modules/taquilla-pos/taquilla-pos.service.ts` | 67, 126, 252, 716, 793, … | `PosTerminal` / `Order` / `PosCashierSession` (hay `pos-access.service` correcto en paralelo — preferirlo) |
| `modules/campaign-execution/campaign-execution.service.ts` | 29, 35 | `Event` (otros métodos sí usan compuesto) |
| `modules/venue-layout/layout-sync.service.ts` | 238, 319 | `Section` / `Seat` (ids internos de sync; aún así conviene acotar por layout/venue org) |

Patrones buenos a emular: `pos-access.service.ts`, `layout-access.service.ts`, `event-scheduling.service.ts` (compuestos `id`+`organizationId`), `partners.service.ts`, `analytics.service.ts` (event+org).

---

## Advertencias finales

1. **Sin RLS / sin Prisma client extension** de tenant. Si omites el filtro, la fila de otro org es alcanzable.
2. `OrgAccessGuard` + interceptor **no sustituyen** el `where`.
3. `requireOrganization()` no sirve para SUPER_ADMIN (`privileged`); usa `TenantScopeService.resolve`.
4. Respuestas 404 vs 403: preferí `NotFound` en lookups compuestos fallidos para no filtrar existencia cross-tenant (como hacen `layout-access` / `pos-access`).
5. Al crear: escribe `organizationId: orgId` en el `data` (ej. `createEvent` en event-management).

## Enlaces

- [Nuevo endpoint API](./nuevo-endpoint-api.md)
- [SECURITY-MIGRATION](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md)
- [Ciclo de vida](../dominio/ciclo-de-vida.md)
- [Glosario](../dominio/glosario.md)
- [Índice](./README.md)
