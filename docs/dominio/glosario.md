# Glosario bilingüe (código ↔ negocio)

El código mezcla inglés (Prisma, módulos Nest) y español (UI admin/taquilla, mensajes de error). Esta tabla es la traducción operativa para un desarrollador nuevo.

| Término en el código | Español | Inglés | Qué es | Dónde vive |
|---|---|---|---|---|
| `Organization` / `organizationId` | Organización / inquilino | Organization / tenant | Cuenta dueña de eventos, venues, órdenes, CFDI y payouts. Tipos: `PROMOTER`, `VENUE`, `BOLETERA`, `ARTIST`, `DISTRIBUTOR`. | Modelo `Organization`; módulos `organization/`, `tenant/` |
| `PROMOTER` (OrgType / UserRole) | Promotor | Promoter | Quien produce/vende el evento (org) o el rol de usuario de esa org. | Enums `OrgType`, `UserRole` |
| `Venue` | Recinto | Venue | Lugar físico con capacidad y layouts. | Modelo `Venue`; `venue-layout/`, admin venues |
| `taquilla` / `SalesChannel.TAQUILLA` | Taquilla / punto de venta | Box office / POS | Canal y app de venta en mostrador. | Canal enum; app `apps/taquilla`; módulo `taquilla-pos/` |
| `Offer` | Oferta / zona de precio | Offer / price tier SKU | SKU vendible de un evento (zona + precio + inventario). | Modelo `Offer`; pricing + inventory |
| `tier` (`Seat.tier`, UI) | Nivel / categoría de asiento | Tier | Etiqueta geométrica/comercial del asiento; no es el modelo `Offer`. | `Seat.tier`; venue-engine color modes |
| `SeatHold` / `HoldStatus` | Reserva temporal / hold | Hold | Bloqueo corto de inventario durante checkout. | Modelo `SeatHold`; `inventory/` |
| `Ticket` | Boleto | Ticket | Unidad inventariable y de acceso (puede o no tener asiento). | Modelo `Ticket` |
| `Order` / `OrderItem` | Orden / partida | Order / line item | Compra (o reventa sintética) con montos y canal. | Modelos `Order`, `OrderItem`; `orders/` |
| `Seat` | Asiento | Seat | Punto geométrico numerado en un layout. | Modelo `Seat` |
| `SeatRow` / `row` | Fila | Row | Agrupación de asientos; también campo denormalizado en `Ticket.row`. | `SeatRow`; `Ticket.row` |
| `Section` / `section` | Sección / zona del mapa | Section / zone (map) | Zona geométrica del layout. Distinta de `Offer.zone` (nombre comercial). | Modelo `Section` |
| `AccessZone` | Zona de acceso / punto de acceso | Access zone / gate | Puerta o área de control de ingreso en el venue. | Modelo `AccessZone`; `access/` |
| `TicketScan` / scan | Escaneo | Scan / scan event | Intento de validación de boleto (éxito o rechazo). | Modelo `TicketScan`; `access/`; scanner admin |
| check-in (`checkedInAt`, `USED`) | Check-in / admisión | Check-in | Momento en que el boleto se admite; status pasa a `USED`. | `Ticket.checkedInAt` / `usedAt`; `AccessService` |
| no-show | No-show / inasistencia | No-show | Derivado: evento terminado y boleto nunca `USED`. **No hay enum.** | Métricas admin/analytics |
| `ResaleListing` / `ResaleOffer` | Reventa / oferta de reventa | Resale listing / offer | Marketplace secundario de un boleto ya vendido. | Modelos resale; `resale/` |
| `SeasonPass` / `SeasonPassPurchase` | Abono de temporada | Season pass | Paquete multi-evento; compra demo sin emitir tickets por fecha. | Modelos season; `season/` |
| `WaitlistEntry` / `WaitlistStatus` | Lista de espera | Waitlist | Cola cuando no hay inventario; se notifica al liberar holds. | Modelo `WaitlistEntry`; `waitlist/` |
| `PromoterPayout` / payout | Liquidación al promotor | Payout | Periodo de gross/commission/net a pagar a la org. | Modelo `PromoterPayout`; worker + metrics |
| settlement / `generateSettlementReport` | Liquidación / corte de periodo | Settlement | Cálculo/reporte de lo adeudado (a menudo sin SPEI-out aún). | `analytics/`, `reporting-service/`, `metrics/` |
| chargeback / `FraudType.CHARGEBACK` | Contracargo | Chargeback | Disputa bancaria del cargo; flag de fraude, no máquina de estados completa. | Enum `FraudType`; `PaymentStatus.DISPUTE` |
| `Refund` | Reembolso | Refund | Devolución total/parcial de una orden. | Modelo `Refund`; `payment/` |
| `CfdiInvoice` / CFDI | Factura CFDI 4.0 | Mexican e-invoice (CFDI) | Comprobante fiscal; hoy timbrado sandbox. | `FiscalProfile`, `CfdiInvoice`; `billing/` |
| `SPEI` / `PaymentMethod.SPEI` | SPEI | SPEI bank transfer | Transferencia bancaria MX para pagar la orden. | Banorte provider; worker reconcile |
| `OXXO` | OXXO | OXXO cash voucher | Referencia de pago en tienda. | Banorte provider |
| Payworks | Payworks (Banorte) | Banorte Payworks | Pasarela e-commerce/3DS de Banorte para tarjeta. | `packages/payments/src/banorte/` |
| IPN / webhook Banorte | Notificación instantánea de pago | Instant Payment Notification | Callback firmado que confirma/rechaza el pago. | `PaymentService.handleBanorteWebhook` |
| RFC (`FiscalProfile.rfc`, receptor) | RFC | Mexican tax ID | Identificador fiscal del emisor/receptor. | `FiscalProfile`, `CfdiInvoice` |
| CLABE (`BANORTE_ACCOUNT_CLABE`) | CLABE | Mexican bank account (CLABE) | Cuenta 18 dígitos para SPEI/depósito. | `packages/payments` config |
| GMV | GMV (volumen bruto) | Gross Merchandise Value | Suma de ventas/reventas brutas en dashboards. | Admin analytics/resale/channels |
| sell-through | Sell-through / % vendido | Sell-through | `sold / capacity` (o por offer). | Shared analytics contracts; inventory UI |
| occupancy / `occupancyRate` | Ocupación | Occupancy | Inventario vendido vs total; alimenta surge. | `pricing.service.ts` |
| sales pace / `sales_pace` | Ritmo de venta | Sales pace | Factor de pricing dinámico vs ritmo esperado. | `pricing.types.ts` FactorCode |
| dynamic pricing / `DynamicPrice` | Precio dinámico | Dynamic pricing | Ajuste de precio por demanda/tiempo/ocupación. | `Event.enableDynamic`; `pricing/` |
| `Promotion` / `PromotionType` | Promoción / cupón | Promotion / promo code | Descuento por código. | Modelo `Promotion`; pricing |
| `FraudFlag` | Bandera de fraude | Fraud flag | Señal de riesgo sobre orden/usuario/ticket. | Modelo `FraudFlag`; `fraud/` |
| `KYCStatus` | KYC | Know Your Customer | Verificación de identidad de la organización. | `Organization.kycStatus` |
| `AMLStatus` | AML / PLD | Anti–Money Laundering | Cumplimiento antilavado de la org. | `Organization.amlStatus` |
| tenant / `TenantContextService` | Inquilino / tenant | Tenant | Alcance multi-org del request (org actual vs privileged). | `tenant-context.*`; guards org |
| `UserRole.SUPER_ADMIN` | Super administrador | Super admin | Operador cross-tenant privilegiado. | Enum `UserRole` |
| `UserRole.ADMIN` | Administrador | Admin | Admin de plataforma/org con permisos amplios. | Enum `UserRole` |
| `UserRole.PROMOTER` | Promotor (usuario) | Promoter user | Staff del promotor. | Enum `UserRole` |
| `UserRole.VENUE_MANAGER` | Manager de recinto | Venue manager | Opera venue/acceso/layouts. | Enum `UserRole` |
| `UserRole.TAQUILLA` | Cajero de taquilla | Box-office cashier | Rol POS. | Enum `UserRole` |
| `UserRole.SCANNER` | Escáner / staff de acceso | Scanner staff | Puede emitir/validar QR de acceso. | Enum `UserRole` |
| `UserRole.CUSTOMER` / `ARTIST` | Cliente / artista | Customer / artist | Roles adicionales del enum. | Enum `UserRole` |
| sightline / `viewQuality` | Línea de visión | Sightline | Calidad de vista asiento→escenario (análisis geométrico). | `packages/venue-engine` sightlines; `Seat.viewQuality` |
| egress | Evacuación / egreso | Egress | Rutas de salida, bottlenecks y tiempo de vaciado del layout. | venue-engine + admin reports/egress |
| LOD | Nivel de detalle | Level of Detail | Simplificación visual de filas/asientos al alejar cámara. | venue-engine `render/lod.ts`; LayersPanel |
| instancing | Instancing (GPU) | GPU instancing | Técnica de render para dibujar muchos asientos como instancias. | venue-engine render buffers |

Roles completos del enum `UserRole` (schema): `CUSTOMER`, `PROMOTER`, `VENUE_MANAGER`, `ARTIST`, `ADMIN`, `SUPER_ADMIN`, `TAQUILLA`, `SCANNER`.

---

## Trampas de nomenclatura

Casos reales donde el mismo nombre engaña o hay dos nombres para una cosa:

1. **`Offer` ≠ `offer` de reventa**  
   `Offer` es el SKU primario del evento. `ResaleOffer` es una puja sobre un listing secundario. Ambos se llaman “offer” en código/UI.

2. **`Section` vs `Offer.zone` vs `AccessZone`**  
   Tres “zonas”: geométrica (`Section`), comercial (`Offer.zone` string), y de torniquete (`AccessZone`). No están unificadas por FK.

3. **`EventStatus` vs `SaleState`**  
   `LIVE`/`SCHEDULED` son estados del evento. “En venta / preventa / anunciado” es `SaleState` de `resolveSaleStatus` en `@boletera/shared`. Un evento `SCHEDULED` puede estar `ON_SALE` o `ANNOUNCED`.

4. **`holdExpiration` (Event) vs TTL real**  
   El campo del evento default 900 s no gobierna el hold. Mandan `HOLD_TTL_WEB_SECONDS=900` y `HOLD_TTL_TAQUILLA_SECONDS=300` en `inventory.service.ts`.

5. **`TicketStatus.TRANSFERRED` vs transferencia real**  
   Aceptar un `TicketTransfer` **no** pone el boleto en `TRANSFERRED`; sigue `SOLD` con otro buyer. El enum existe pero el flujo no lo usa como estado vivo.

6. **`TicketStatus.REFUNDED` vs refund total**  
   El refund completo suele devolver el ticket a `AVAILABLE` (reventa de inventario), no dejarlo `REFUNDED`.

7. **`commissionRate` (org) vs `0.15` hardcode en órdenes**  
   Schema/reportes usan `Organization.commissionRate`. `OrdersService` graba `commissionAmount = subtotal * 0.15` fijo.

8. **`resaleCommission` (org) vs `RESALE_FEE_PERCENT`**  
   Ambos default 0.08, pero el servicio de reventa ignora el campo de la org y usa la constante.

9. **`PaymentGateway` vs `PaymentMethod`**  
   `OXXO`/`SPEI`/`CASH` aparecen en ambos enums. En la práctica Banorte es el gateway y el método selecciona el riel (CARD/SPEI/OXXO); `CASH` usa provider `cash`.

10. **`PaymentIntent` (modelo) vs intent del provider**  
    Tabla Prisma `PaymentIntent` + `intentId` string del BanorteProvider. No es Stripe PaymentIntent aunque el nombre lo sugiera (Stripe está marcado legacy).

11. **Serie legacy vs `EventSeries`**  
    `event-management` puede crear “series/residencias” solo con metadata JSON. `event-scheduling` crea el modelo real `EventSeries` con recurrence. Misma palabra, dos implementaciones.

12. **Offline scanner ≠ offline admission**  
    La UI dice “cola offline”, pero no autoriza entrada sin API. Solo encola el payload para reintentar `/access/scan`.

13. **`checkedInAt` vs `usedAt`**  
    El acceso setea ambos al mismo instante. No hay semántica distinta implementada (re-entry parcial, etc.).

14. **Taquilla `PosCashierSession` vs `CashierShift`**  
    Sesión de terminal + turno de caja son dos filas ligadas por metadata (`posSessionId`). Cerrar una intenta cerrar la otra.

15. **Pesos en DB vs centavos en shared**  
    Columnas `Decimal` guardan unidades mayores; `packages/shared/src/money.ts` exige minor units para aritmética. Mezclarlos es la trampa clásica de redondeo.

---

## Enlaces

- Ciclo de vida: [./ciclo-de-vida.md](./ciclo-de-vida.md)
- Índice: [./README.md](./README.md)
- Arquitectura: [../arquitectura.md](../arquitectura.md)
- API: [../api/README.md](../api/README.md)
- README: [../../README.md](../../README.md)
