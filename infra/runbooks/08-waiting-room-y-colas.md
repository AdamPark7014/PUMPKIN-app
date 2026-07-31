# 08 — Waiting room y colas — límites de lo no implementable

## Distinción crítica

| Concepto | ¿Existe en Boletera? | Qué es |
|----------|----------------------|--------|
| **Waitlist** de evento | **SÍ** | Lista de espera de inventario (`/api/v1/waitlist/...`) cuando no hay cupo |
| **Waiting room / virtual queue** de tráfico | **NO (P-04)** | Cola de admisión antes de golpear API/checkout |
| **Cola offline taquilla** | **SÍ (cliente)** | IndexedDB en app taquilla; sync cuando API vuelve |
| **Bull/Redis jobs** | **SÍ** | Notificaciones/worker async — no es waiting room de compradores |
| **Cola de scanner offline** | **SÍ (admin cliente)** | Cola local de scans — irrelevante a on-sale web |

## Endpoints waitlist verificados (no son waiting room)

```text
POST /api/v1/waitlist/join
GET  /api/v1/waitlist/event/:eventId
GET  /api/v1/waitlist/organization/:orgId
GET  /api/v1/waitlist/event/:eventId/stats
POST /api/v1/waitlist/event/:eventId/notify
GET  /api/v1/metrics/waitlist    # JWT
```

Usar waitlist para sold-out / demanda residual. **No** sirve para absorber thundering herd al abrir venta.

## Qué SÍ se puede operar hoy (sin cambios de app)

1. **Rate limit existente:** 120/min throttler; 20/min anti-abuse en payment — protege algo, no hace cola justa.
2. **Scale + DB budget** (07) con techo explícito.
3. **CDN / WAF / Cloudflare Waiting Room / AWS CloudFront + Functions / Fastly** — **solo si el cloud del cliente ya lo tiene**. No hay config en este repo → documentar en el ticket de cloud, no fingir URLs.
4. **LB connection limits / max surge** en el edge.
5. **Comunicación** y staggered sale codes / fases vía `events/schedule` (staff) si el producto de ventanas/fases está configurado para el evento.
6. **Taquilla** como válvula humana.

## Qué NO es implementable solo con runbooks (requiere app y/o cloud)

| Capacidad | Por qué está bloqueada |
|-----------|------------------------|
| Cola FIFO con posición y JWT de admisión | No hay módulo/endpoints de waiting room |
| “Admit N users/sec to checkout” en API | No hay middleware de admisión |
| Página `/waiting-room` branded en web | No versionada como feature de tráfico |
| Pause sales HTTP dedicado | P-05 |
| Integración automática Cloudflare Waiting Room ↔ Boletera | Sin IaC ni secretos en repo |
| Bypass token por VIP en edge + app | No especificado en código inspeccionado |
| Métricas Prometheus `waiting_room_depth` | P-06 |

Cualquier promesa de “activar waiting room” en un SEV **sin** producto cloud ya cableado es **falsa**. Decir: “no disponible; mitigar con scale/shed/taquilla/comunicación”.

## Runbook si el cloud SÍ tiene Waiting Room (plantilla genérica)

Solo rellenar IDs reales del proveedor; no inventar paneles Boletera.

```powershell
# Ejemplo conceptual Cloudflare (IDs PENDIENTES — sustituir por los del tenant):
# npx wrangler / dashboard: Waiting Room → enable on checkout hostname
# Total active users / new users per minute = valores acordados en 06
# Status page / event bridge: "Waiting room ON"
```

Validación:

- Usuarios ven página del **proveedor cloud**, no un endpoint Boletera inventado.
- Cuando pasan, `GET /api/v1/ready` y `inventory/.../availability` responden 200.
- API no debe depender de un header mágico no implementado.

## Colas Bull (operación)

```powershell
# Redis ping
docker exec boletera-redis redis-cli ping
# No hay dashboard Bull versionado en Compose.
# Worker: pnpm dev:worker / contenedor worker si existe en el entorno (Compose root no define worker).
```

Compose actual **no** incluye servicio `worker`. Si prod corre worker aparte, documentar host en el inventario del entorno (PENDIENTE por entorno).

## Mensaje aprobado a negocio

> “Tenemos waitlist de inventario y rate limits. No tenemos sala de espera virtual propia. Para on-sales extremos necesitamos waiting room en el CDN/WAF o aceptar riesgo de 429/degradación; PgBouncer + HPA están pendientes en infra.”

## Escalamiento

Producto/eng para P-04/P-05. Cloud/CDN para waiting room externo. L1 no inventa endpoints de cola.
