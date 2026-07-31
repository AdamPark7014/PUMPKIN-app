# 05 — Caída de API durante venta

## Objetivo

Restaurar capacidad de compra (holds → orders → payments) cuando la API degrada o cae en ventana de venta.

## Síntomas → severidad

| Síntoma | Check | SEV |
|---------|-------|-----|
| Web/admin timeout / 502 | health falla | SEV-1 |
| `ready` 503 `database_unavailable` | DB | SEV-1 |
| `health` ok pero `redis=down` | holds en DB only | SEV-2 |
| 429 masivos | throttling 120/min | SEV-2 |
| Solo un pod/contenedor reiniciando | crashloop | SEV-1/2 |

## Endpoints de triage (verificados)

```text
GET /api/v1/health
GET /api/v1/ready
GET /api/v1/inventory/:eventId/availability
GET /api/v1/events/schedule/public/events/:eventId/sale-state
GET /api/v1/channels/:eventId/health          # JWT según controller
GET /api/v1/metrics/alerts                    # JWT
POST /api/v1/events/schedule/tick             # X-Internal-Secret
```

**PENDIENTE (P-05):** no hay `POST /sales/pause` ni kill-switch HTTP dedicado.

## Procedimiento

### 1. Declarar incidente + congelar cambios

No desplegar features. Solo hotfix/rollback/restore.

```powershell
.\infra\runbooks\scripts\health-check.ps1 -Strict
```

### 2. Clasificar dependencia

| health | ready | Acción |
|--------|-------|--------|
| database=down | 503 | L3 DB: `docker exec boletera-postgres pg_isready`; disco, conexiones, restore si corrupción |
| redis=down | 200 | Continuar con cautela; holds sin Redis; priorizar estabilidad DB |
| ambos up, 5xx | — | Logs app, OOM, crashloop → restart/rollback (02) |
| 429 | — | Scale out (07) / waiting room edge (08, cloud) / bajar bots |

### 3. Restart controlado (Compose)

```powershell
docker compose -f $env:COMPOSE_FILE restart api
Start-Sleep -Seconds 15
.\infra\runbooks\scripts\health-check.ps1 -Strict
```

### 3b. Kubernetes (P-01)

```powershell
kubectl -n $env:KUBE_NS rollout restart deploy/$env:KUBE_DEPLOY_API
kubectl -n $env:KUBE_NS rollout status deploy/$env:KUBE_DEPLOY_API --timeout=5m
kubectl -n $env:KUBE_NS get hpa  # puede no existir
kubectl -n $env:KUBE_NS top pods  # metrics-server puede no existir
```

### 4. Si DB exhausta conexiones

Ver [07-capacidad-db-scaling-pgbouncer.md](./07-capacidad-db-scaling-pgbouncer.md):

```powershell
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -d $env:PG_DB -c `
  "SELECT count(*) AS total, state FROM pg_stat_activity GROUP BY state;"
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -d postgres -c "SHOW max_connections;"
```

Mitigar: reducir réplicas API temporalmente; matar idle; **no** subir réplicas sin pooler (P-02).

### 5. Mitigación de negocio sin kill-switch

Opciones **reales** hoy:

1. Quitar tráfico en load balancer / DNS / CDN (cloud — no en repo).
2. `docker compose stop api` (cierra toda la API; taquilla online también cae).
3. Escalar a 0 en K8s (si existe).
4. Comunicar a usuarios; operar **taquilla offline** si el POS local tiene cola offline (`apps/taquilla` IndexedDB) — sync posterior vía endpoints taquilla cuando API vuelva.

**No** asumir pause de `sale-state` sin confirmar que el scheduling lo permite para el evento; usar:

```powershell
Invoke-RestMethod "$env:API_BASE/api/v1/events/schedule/public/events/$env:EVENT_ID/sale-state"
```

Cambios de ventanas/fases requieren endpoints autenticados de `events/schedule` (staff) — coordinar L2, no inventar rutas.

### 6. Recuperación

1. Health/ready OK ×3.
2. Availability del evento responde.
3. Hold de prueba + release:

```powershell
# Solo staging o con asientos de prueba — body real según oferta del evento
# POST /api/v1/inventory/holds  then  DELETE /api/v1/inventory/holds/:id
```

4. `payments/config` OK.
5. Tick de scheduler si se atrasaron transiciones:

```powershell
Invoke-RestMethod -Method POST -Uri "$env:API_BASE/api/v1/events/schedule/tick" `
  -Headers @{ "X-Internal-Secret" = $env:INTERNAL_API_SECRET }
```

6. Reconcile SPEI si hubo pagos en vuelo (runbook 04).

## Criterios de salida

- ready=true; error rate normalizado.
- Venta verificada (hold o orden).
- Timeline en el bridge; postmortem si SEV-1.

## Escalamiento

L1 → L2 app → L3 DB/red. Negocio si downtime > 10 min en on-sale.
