# 02 — Rollback

## Objetivo

Volver a la última versión conocida buena (LKG) de API/front sin perder datos, o restaurar DB solo si el deploy corrompió datos (coordinado con 03).

## Criterios de entrada

- [ ] Despliegue fallido o SEV-1 post-deploy.
- [ ] Identificado `$LKG_TAG` (tag/digest anterior).
- [ ] Decisión: **solo app** vs **app + restore DB**.
- [ ] Si hubo migrate forward incompatible → plan de restore (03) antes de reabrir venta.

## Decisión rápida

| Situación | Acción |
|-----------|--------|
| Ready/health fallan; migrate no corrió | Rollback solo imágenes/contenedores |
| Migrate aplicó y app nueva es incompatible | Rollback app **y** evaluar restore a backup `pre-deploy-*` |
| Solo web/admin rotos | Rollback front; API puede quedarse |
| Pagos rotos por config env | Revertir env/secret; no necesariamente imagen |

## Camino A — Compose

```powershell
.\infra\runbooks\scripts\rollback-compose.ps1 -ImageTag $LKG_TAG
# Manual:
# $env:IMAGE_TAG = $LKG_TAG
# docker compose -f $env:COMPOSE_FILE up -d --no-deps --force-recreate api
# (repetir web/admin según alcance)
```

Validar:

```powershell
.\infra\runbooks\scripts\health-check.ps1 -Strict
```

## Camino B — Kubernetes (P-01)

```powershell
kubectl -n $env:KUBE_NS rollout undo deploy/$env:KUBE_DEPLOY_API
kubectl -n $env:KUBE_NS rollout status deploy/$env:KUBE_DEPLOY_API --timeout=5m

# O pin a digest LKG:
kubectl -n $env:KUBE_NS set image deploy/$env:KUBE_DEPLOY_API "api=ghcr.io/ORG/boletera-api:$LKG_TAG"
```

Historial:

```powershell
kubectl -n $env:KUBE_NS rollout history deploy/$env:KUBE_DEPLOY_API
```

## Restore DB (solo si procede)

1. Congelar escrituras: scale API a 0 réplicas (Compose: `docker compose stop api`) **o** quitar tráfico en el LB (cloud; no versionado aquí).
2. Ejecutar [03-backup-restore-postgres.md](./03-backup-restore-postgres.md) restore del dump `pre-deploy-*`.
3. Levantar API con `$LKG_TAG`.
4. Health/ready + smoke pagos config.

## Validación

| Check | PASS |
|-------|------|
| health/ready | ok |
| `payments/config` | gateway BANORTE; prod no-demo |
| Orden de prueba (staging) o taquilla | Completa o hold+release |
| sale-state evento crítico | coherente |

```powershell
# Estado de venta (requiere EVENT_ID real)
Invoke-RestMethod "$env:API_BASE/api/v1/events/schedule/public/events/$env:EVENT_ID/sale-state"
```

## Criterios de salida

- Tráfico restaurado; SEV bajado o cerrado.
- Postmortem breve: causa, tag malo, tag LKG, ¿hubo restore?

## Escalamiento

L1 rollback app. L2+L3 si restore. Negocio si venta estuvo cerrada > 15 min.
