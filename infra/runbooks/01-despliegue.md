# 01 — Despliegue

## Objetivo

Publicar una nueva versión de API / web / admin con validación de salud y criterio de aborto.

## Criterios de entrada

- [ ] CI verde en el commit/tag a desplegar (`.github/workflows/ci.yml`: generate, db push en CI, typecheck API, build payments, unit tests).
- [ ] Tag o digest de imagen conocido (`$IMAGE_TAG`).
- [ ] Backup reciente de Postgres si el deploy incluye migraciones (runbook 03).
- [ ] Ventana acordada; si hay on-sale en < 2 h → **no desplegar** salvo hotfix SEV-1 (ver 06).
- [ ] Variables de [comunes.md](./comunes.md) cargadas.

## Camino A — Docker Compose (soportado hoy en repo)

### 1. Preflight

```powershell
.\infra\runbooks\scripts\preflight.ps1
.\infra\runbooks\scripts\health-check.ps1 -Baseline
```

### 2. Backup si hay migraciones

```powershell
.\infra\runbooks\scripts\pg-backup.ps1 -Label "pre-deploy-$IMAGE_TAG"
```

### 3. Migraciones (desde host con `DATABASE_URL` apuntando al Postgres del entorno)

```powershell
# Ejemplo host Windows + Compose (puerto 5434):
# $env:DATABASE_URL = "postgresql://postgres:****@127.0.0.1:5434/boletera?schema=public"
pnpm db:migrate:deploy
```

**Abortar** si migrate falla. No continuar con build/up.

### 4. Deploy Compose

```powershell
.\infra\runbooks\scripts\deploy-compose.ps1 -ImageTag $IMAGE_TAG
# Equivalente manual:
# docker compose -f $env:COMPOSE_FILE build api web admin
# docker compose -f $env:COMPOSE_FILE up -d api web admin
```

> **P-09:** el build Docker de apps puede fallar por monorepo/tsconfig. Si falla, desplegar artefactos preconstruidos fuera de Compose o corregir Dockerfile (fuera del alcance de runbooks).

### 5. Validación post-deploy

```powershell
.\infra\runbooks\scripts\health-check.ps1 -Strict
```

Checks obligatorios:

| Check | Criterio PASS |
|-------|---------------|
| `GET $API_BASE/api/v1/health` | `status=ok`, `database=up`, `service=boletera-api` |
| `GET $API_BASE/api/v1/ready` | 200 + `ready=true` |
| `GET $API_BASE/api/v1/payments/config` | JSON con `gateway=BANORTE` |
| Web / Admin | HTTP 200 en `$WEB_BASE` / `$ADMIN_BASE` |
| Smoke opcional | `pnpm smoke:api` si el entorno lo permite |

### 6. Scheduler (si el entorno no tiene cron externo)

```powershell
Invoke-RestMethod -Method POST -Uri "$env:API_BASE/api/v1/events/schedule/tick" `
  -Headers @{ "X-Internal-Secret" = $env:INTERNAL_API_SECRET }
```

## Camino B — Kubernetes (plantilla; P-01)

**No hay manifiestos en el repo.** Solo ejecutar si el cluster y los Deployment names existen y coinciden con `$KUBE_*`.

```powershell
kubectl -n $env:KUBE_NS set image deploy/$env:KUBE_DEPLOY_API `
  "api=ghcr.io/ORG/boletera-api:$IMAGE_TAG"
kubectl -n $env:KUBE_NS rollout status deploy/$env:KUBE_DEPLOY_API --timeout=5m

kubectl -n $env:KUBE_NS set image deploy/$env:KUBE_DEPLOY_WEB `
  "web=ghcr.io/ORG/boletera-web:$IMAGE_TAG"
kubectl -n $env:KUBE_NS set image deploy/$env:KUBE_DEPLOY_ADMIN `
  "admin=ghcr.io/ORG/boletera-admin:$IMAGE_TAG"

kubectl -n $env:KUBE_NS get pods -l app.kubernetes.io/name=boletera
kubectl -n $env:KUBE_NS rollout undo deploy/$env:KUBE_DEPLOY_API   # si falla validación → runbook 02
```

Probes sugeridas (cuando se creen manifiestos):

- liveness: `GET /api/v1/health`
- readiness: `GET /api/v1/ready`

## Criterios de salida (PASS)

- Health/ready OK ≥ 3 sondeos consecutivos (script `-Strict`).
- Sin error rate anómalo en logs 10 min (`docker compose logs --since 10m api` o `kubectl logs`).
- Pagos: `demo=false` en prod.
- Ticket de deploy cerrado con tag, backup id, y operador.

## Abortar → Rollback

Cualquier fallo en migrate, ready, o pagos config en prod → [02-rollback.md](./02-rollback.md).

## Escalamiento

L1 ejecuta. L2 si migrate o Banorte config. L3 si el host/Compose no levanta.
