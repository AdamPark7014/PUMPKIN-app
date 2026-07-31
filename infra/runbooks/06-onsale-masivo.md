# 06 — On-sale masivo (preparación y operación)

## Objetivo

Preparar y operar un on-sale de alta demanda con checklist ejecutable, monitoreo y playbooks de degradación.  
**Límite claro:** no existe waiting room de admisión en la app (ver 08, P-04).

## T−7 a T−1 días

### Capacidad y datos

- [ ] Backup Postgres etiquetado `pre-onsale-$EVENT_ID` (script 03).
- [ ] `pnpm db:migrate:deploy` al día; sin migraciones el día D.
- [ ] Inventario cargado; `GET /api/v1/inventory/$EVENT_ID/availability` coherente.
- [ ] `sale-state` muestra ventana futura correcta:

```powershell
Invoke-RestMethod "$env:API_BASE/api/v1/events/schedule/public/events/$env:EVENT_ID/sale-state"
```

- [ ] Banorte prod: `payments/config` → `demo=false`, `productionReady=true`; IPN registrada.
- [ ] Cron/worker: `POST /api/v1/events/schedule/tick` con secret (cada 1–5 min recomendado).
- [ ] Rate limits conocidos: **120/min** global; **20/min** payment paths — dimensionar expectativa de usuarios concurrentes.
- [ ] Plan de scale (07): réplicas API, Redis, DB connections; **sin PgBouncer = techo bajo**.
- [ ] Edge waiting room (Cloudflare/etc.) si el cloud lo permite — **fuera de repo** (08).
- [ ] Canal taquilla staffed como bypass controlado.
- [ ] Waitlist de inventario configurada si aplica (`/api/v1/waitlist/...`) — no sustituye waiting room.

### Freeze

- [ ] Freeze de deploy 24 h (solo SEV-1 hotfix).
- [ ] Contactos L1–L4 + Banorte en el bridge.

## T−60 minutos

```powershell
.\infra\runbooks\scripts\preflight.ps1
.\infra\runbooks\scripts\health-check.ps1 -Strict
.\infra\runbooks\scripts\payments-triage.ps1
.\infra\runbooks\scripts\pg-backup.ps1 -Label "pre-onsale-$env:EVENT_ID"
```

Scale-out preventivo (Compose: recrear con más instancias solo si hay orquestación; Compose default = 1 réplica):

```powershell
# K8s plantilla (P-01):
kubectl -n $env:KUBE_NS scale deploy/$env:KUBE_DEPLOY_API --replicas=4
# Verificar conexiones DB antes (07) — no exceder presupuesto de pool
```

## T−0 / durante el on-sale

```powershell
.\infra\runbooks\scripts\onsale-watch.ps1 -EventId $env:EVENT_ID -IntervalSec 15
```

Monitorear:

| Señal | Fuente | Umbral acción |
|-------|--------|---------------|
| ready | `/ready` | ≠200 → runbook 05 |
| availability latency | `/inventory/.../availability` | p95 alta → scale / shed edge |
| sale-state | schedule public | no ON_SALE esperado → tick + L2 |
| pagos demo | `/payments/config` | demo=true → SEV-1 runbook 04 |
| 429 | logs | edge queue / bajar bots |
| channel health | `/channels/:eventId/health` | degradado → reasignar ops (staff) |
| metrics alerts | `/metrics/alerts` | JWT |

Tick manual si el scheduler falla:

```powershell
Invoke-RestMethod -Method POST -Uri "$env:API_BASE/api/v1/events/schedule/tick" `
  -Headers @{ "X-Internal-Secret" = $env:INTERNAL_API_SECRET }
```

## Degradación ordenada

1. Activar waiting room **CDN/cloud** (08) si está aprovisionado.
2. Priorizar checkout: no desplegar; reducir jobs no esenciales del worker.
3. Si DB connections alto: **bajar** réplicas API (contraintuitivo pero evita meltdown sin PgBouncer).
4. Empujar demanda a taquilla física.
5. Si API down: runbook 05; reconcile pagos al volver (04).

## T+ post on-sale

- [ ] Backup `post-onsale-$EVENT_ID`
- [ ] Reconcile SPEI: `POST /payments/reconcile/spei`
- [ ] Revisar `metrics/orders`, `metrics/inventory`, fraud
- [ ] Scale-in a baseline
- [ ] Retro: ¿faltó waiting room? ¿pool? ¿réplicas?

## Criterios GO / NO-GO (T−60)

| GO | NO-GO |
|----|-------|
| health ok, ready true | database down / ready false |
| Banorte productionReady | demo mode en prod |
| Backup pre-onsale OK | Sin backup |
| sale-state coherente | Ventana/fase incorrecta sin fix |
| Contactos L4 Banorte | Sin escalamiento bancario |

NO-GO → retrasar apertura de venta (staff scheduling) + comunicar. No inventar endpoint de postpone.
