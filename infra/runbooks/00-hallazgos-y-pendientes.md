# 00 — Hallazgos de inspección y pendientes

Fecha de inspección: 2026-07-30. Solo lectura de `apps/`, `packages/`, Compose y docs raíz. **No se inventan endpoints.**

## Estado de infraestructura en el repo

| Componente | Estado | Evidencia |
|------------|--------|-----------|
| `infra/` previo | **No existía** | Creado con estos runbooks |
| Docker Compose | **Presente** | `docker-compose.yml` — postgres:16, redis:7, api, web, admin |
| Dockerfiles | **Presente** | `Dockerfile.api`, `Dockerfile.web` |
| Manifiestos Kubernetes | **AUSENTE** | Sin `*.yaml` de Deployment/Service/HPA |
| Helm / Kustomize | **AUSENTE** | — |
| PgBouncer | **AUSENTE** | Sin config ni servicio |
| Pipeline deploy prod | **AUSENTE** | Solo CI build/test (`.github/workflows/ci.yml`) |
| Waiting room / traffic queue | **AUSENTE** | Existe `waitlist` (lista de espera de inventario), no cola de admisión |
| Pool Prisma custom | **AUSENTE** | `PrismaService` extiende `PrismaClient` sin `connection_limit` |
| `DIRECT_DATABASE_URL` | **Documentado, no cableado** | `.env.example`; schema Prisma solo usa `DATABASE_URL` |

## Puertos y healthchecks (Compose)

| Servicio | Contenedor | Host | Healthcheck |
|----------|------------|------|-------------|
| postgres | `boletera-postgres` | **5434→5432** | `pg_isready -U postgres` |
| redis | `boletera-redis` | 6379 | `redis-cli ping` |
| api | `boletera-api` | 4000 | `GET http://localhost:4000/api/v1/health` |
| web | `boletera-web` | 3000 | `GET /` |
| admin | `boletera-admin` | 3001→3000 | `GET /` |

> Nota: `DOCKER_SETUP.md` menciona Postgres en 5432; Compose actual publica **5434**. Usar 5434 en host Windows.

## Prefijo API

Global: `api/v1` (`apps/api/src/main.ts`). Swagger UI: `/api/docs` (sin prefijo v1).

## Endpoints operativos verificados en código

### Salud

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| `GET` | `/api/v1/health` | No | DB + Redis + `payments: BANORTE`. `status` = `ok`\|`degraded` |
| `GET` | `/api/v1/ready` | No | 503 si DB down; Redis down **no** es fatal (`redisRequired: false`) |

### Pagos (Banorte)

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| `GET` | `/api/v1/payments/config` | No | Config pública; `demo` si falta `BANORTE_MERCHANT_ID` |
| `GET` | `/api/v1/payments/config/validate` | JWT + rol ADMIN/SUPER_ADMIN/PROMOTER | Validación credenciales |
| `POST` | `/api/v1/payments/intents` | No (revisar en incidente) | Crear cobro |
| `POST` | `/api/v1/payments/confirm` | No | Confirm demo / return |
| `POST` | `/api/v1/payments/:orderId/refunds` | JWT staff | Reembolso |
| `POST` | `/api/v1/payments/refunds/:refundId/complete` | JWT staff | Cierre manual portal Banorte |
| `POST` | `/api/v1/payments/webhooks/banorte` | Firma `x-banorte-signature` o `x-signature` | IPN |
| `GET` | `/api/v1/payments/webhooks/banorte/return` | No | Return Payworks |
| `POST` | `/api/v1/payments/reconcile/spei` | Header `X-Internal-Secret` | SPEI/OXXO pendientes |

IPN URL construida: `{API_PUBLIC_URL}/api/v1/payments/webhooks/banorte`.

### Inventario / venta

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| `GET` | `/api/v1/inventory/:eventId/availability` | No | Disponibilidad |
| `GET` | `/api/v1/inventory/:eventId/map` | No | Mapa |
| `SSE` | `/api/v1/inventory/:eventId/stream` | No | Stream |
| `POST` | `/api/v1/inventory/holds` | Canal header | Hold asientos |
| `POST` | `/api/v1/inventory/holds/best-available` | Canal header | Best available |
| `DELETE` | `/api/v1/inventory/holds/:id` | No | Liberar hold |
| `POST` | `/api/v1/orders` | — | Crear orden |
| `GET` | `/api/v1/orders/:publicId/status` | — | Estado |
| `GET` | `/api/v1/events/schedule/public/events/:eventId/sale-state` | No | Estado de venta storefront |
| `POST` | `/api/v1/events/schedule/tick` | `X-Internal-Secret` | Transiciones temporales ON_SALE etc. |

### Observabilidad de negocio (requieren JWT + org)

| Método | Ruta | Uso en incidente |
|--------|------|------------------|
| `GET` | `/api/v1/metrics/orders` | Estados de pago / órdenes |
| `GET` | `/api/v1/metrics/inventory` | Holds / agotamiento |
| `GET` | `/api/v1/metrics/alerts` | Alertas agregadas |
| `GET` | `/api/v1/metrics/executive` | Resumen |
| `GET` | `/api/v1/channels/:eventId/health` | Salud por canal (web/taquilla) |
| `GET` | `/api/v1/waitlist/event/:eventId/stats` | Stats waitlist (inventario) |

### Rate limits observados

| Mecanismo | Valor |
|-----------|-------|
| `ThrottlerModule` default | **120 req / 60s** |
| Anti-abuse login | 5 / 60s |
| Anti-abuse payment/refund paths | **20 / 60s** |
| Auth `@Throttle` login/register | 5 / 60s |
| `.env.example` `RATE_LIMIT_*` | Documentado; Throttler usa valores hardcodeados arriba |

## Controllers presentes (prefijo bajo `/api/v1/`)

`access`, `admin`, `analytics`, `auth`, `billing`, `campaigns`, `channels`, `discovery`, `events/manage`, `events/schedule`, `fraud`, `inventory`, `layouts`, `metrics`, `orders`, `organization`, `partner/v1`, `partners`, `payments`, `pricing`, `reports`, `resale`, `search`, `season`, `3d`, `taquilla`, `tenant`, `tickets/transfer`, `venues`, `events` (venue-layout), `waitlist`, más raíz `health`/`ready`.

## Pendientes explícitos (no inventar)

| ID | Gap | Impacto operativo |
|----|-----|-------------------|
| P-01 | Sin manifiestos K8s / HPA / PDB | Runbooks K8s son **plantilla**; no hay `kubectl apply` reproducible desde repo |
| P-02 | Sin PgBouncer | Escalado horizontal de API sin pooler arriesga agotar `max_connections` |
| P-03 | Sin `connection_limit` en Prisma URL | Pool por proceso = default Prisma (~num CPUs * factor) |
| P-04 | Sin waiting room / edge queue | On-sale masivo depende de rate limit + capacidad; no hay admisión justa |
| P-05 | Sin endpoint de “pause sales” / kill-switch HTTP dedicado | Mitigación vía scale-down, feature flags cloud o tick/status de scheduling — **sin kill-switch dedicado verificado** |
| P-06 | Sin métricas Prometheus/Grafana en repo | Triage vía health/ready + logs + metrics JWT |
| P-07 | Sin runbook de deploy CD | Deploy = Compose local/manual o proceso externo no versionado |
| P-08 | `DIRECT_DATABASE_URL` no en schema | Migraciones vía pooler (si se añade) pueden fallar sin URL directa |
| P-09 | Docker full-stack marcado WIP | `DOCKER_SETUP.md`: build Compose de apps incompleto |
| P-10 | Docs antiguas citan Stripe | Código real: **Banorte**; ignorar Stripe en operación |

## Variables críticas (`.env.example`)

`DATABASE_URL`, `REDIS_URL`, `API_PORT`, `API_HOST`, `API_PUBLIC_URL`, `JWT_SECRET`, `INTERNAL_API_SECRET`, `CORS_ORIGIN`, Banorte (`BANORTE_MERCHANT_ID`, `BANORTE_AFFILIATION`, `BANORTE_USER`, `BANORTE_API_SECRET`, `BANORTE_WEBHOOK_SECRET`, `BANORTE_ACCOUNT_CLABE`, URLs Payworks/return/cancel), SMTP, AWS S3 opcionales.

## Scripts raíz útiles

```text
pnpm docker:up | docker:down | docker:logs
pnpm db:migrate:deploy | db:generate
pnpm build:api | build | smoke:api
```
