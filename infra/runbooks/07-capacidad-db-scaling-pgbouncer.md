# 07 — Capacidad: pool DB, horizontal scaling, recursos, PgBouncer

## Hallazgos (código / repo)

| Tema | Realidad |
|------|----------|
| Prisma pool | `PrismaService` sin config; schema solo `DATABASE_URL`; **sin** `connection_limit` en URL |
| `DIRECT_DATABASE_URL` | Comentado en `.env.example`; **no** usado por schema (P-08) |
| PgBouncer | **No** hay servicio ni config (P-02) |
| HPA / resources K8s | **No** hay manifiestos (P-01) |
| Compose | 1 contenedor por servicio; sin `deploy.resources` ni scale declarado |
| Redis | Holds preferidos; ready permite Redis down con fallback DB |
| Throttle | 120 req/min/default; pagos 20/min anti-abuse |

## Presupuesto de conexiones (fórmula operativa)

```text
conexiones_app ≈ replicas_api × (connection_limit_por_proceso)
                 + replicas_worker × pool_worker
                 + admin_jobs + margen

connection_limit_por_proceso:
  - Hoy: default Prisma (no fijado en repo) → TRATAR COMO DESCONOCIDO
  - Recomendación al cablear: ?connection_limit=5&pool_timeout=30
    en DATABASE_URL vía PgBouncer transaction mode
```

Ejemplo conservador **cuando** exista PgBouncer:

| Componente | Réplicas | Limit/proceso | Total |
|------------|----------|---------------|-------|
| API | 4 | 5 | 20 |
| Worker | 2 | 3 | 6 |
| Migrate/jobs | 1 | 2 | 2 |
| Margen | — | — | 10 |
| **Suma client→PgBouncer** | | | **38** |
| Postgres `max_connections` | | | ≥ 100 (dejar headroom para superuser) |

**Sin PgBouncer:** no escalar API a N>2–3 en el mismo Postgres sin medir `pg_stat_activity`. Preferir vertical o edge shed (08).

## Comandos de medición (Postgres)

```powershell
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -d $env:PG_DB -c @"
SHOW max_connections;
SELECT count(*) AS total,
       count(*) FILTER (WHERE state = 'active') AS active,
       count(*) FILTER (WHERE state = 'idle') AS idle,
       count(*) FILTER (WHERE wait_event_type IS NOT NULL) AS waiting
FROM pg_stat_activity
WHERE datname = current_database();
SELECT usename, application_name, state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1,2,3
ORDER BY 4 DESC;
"@
```

Umbrales de acción:

| Métrica | Warning | Crítico |
|---------|---------|---------|
| total / max_connections | > 70% | > 85% |
| waiting | > 5 sostenido | > 20 |
| idle en transacción | cualquier prolongado | matar con cautela |

## Horizontal scaling

### Compose (limitado)

```powershell
# Compose v2 scale (si el servicio lo permite; red/puertos host pueden chocar)
docker compose -f $env:COMPOSE_FILE up -d --scale api=2
# OJO: mapeo "4000:4000" no admite 2 réplicas en el mismo host sin LB.
# En la práctica Compose del repo = 1 API publicada.
```

Para multi-réplica real hace falta LB + red overlay / K8s (P-01).

### Kubernetes (plantilla P-01)

```powershell
kubectl -n $env:KUBE_NS scale deploy/$env:KUBE_DEPLOY_API --replicas=4
kubectl -n $env:KUBE_NS autoscale deploy/$env:KUBE_DEPLOY_API --min=2 --max=8 --cpu-percent=70
# Solo si metrics-server existe:
kubectl -n $env:KUBE_NS get hpa
kubectl -n $env:KUBE_NS top pods
```

Orden seguro on-sale:

1. Medir conexiones DB.
2. Subir réplicas **solo** si cabe en presupuesto.
3. Si conexiones altas → **bajar** réplicas o activar shed edge, no seguir subiendo.

## Recursos sugeridos (cuando se escriban manifiestos — no están en repo)

| Workload | requests | limits | Notas |
|----------|----------|--------|-------|
| API | 250m CPU / 512Mi | 1–2 CPU / 1–2Gi | Node 22; watch heap holds+Prisma |
| Web/Admin | 100m / 256Mi | 500m / 512Mi | Next.js |
| Worker | 100m / 256Mi | 500m / 1Gi | Bull/Redis |
| Postgres | 500m / 1Gi | 2 CPU / 4Gi+ | SSD; shared_buffers tune L3 |
| Redis | 100m / 256Mi | 500m / 1Gi | persistence según RPO |

Probes: liveness `/api/v1/health`, readiness `/api/v1/ready`.  
PDB API: `minAvailable: 1` (o 2 en on-sale).

## PgBouncer — estado y diseño objetivo

**Hoy: no implementable desde repo (P-02).** Checklist para cuando se añada (infra futura, fuera de apps/packages de este encargo):

1. Servicio PgBouncer delante de Postgres.
2. `DATABASE_URL` app → pgbouncer:6432 `?pgbouncer=true&connection_limit=5`.
3. `DIRECT_DATABASE_URL` → Postgres:5432 para `pnpm db:migrate:deploy` (requiere cablear schema/Prisma — cambio de app/packages, **PENDIENTE**).
4. Pool mode: **transaction** (Prisma).
5. `default_pool_size` / `max_client_conn` documentados junto a HPA max replicas.
6. Health: `pgbouncer` SHOW POOLS en incidente.

Validación post-PgBouncer:

```text
- migrate vía DIRECT OK
- API ready OK bajo carga de prueba
- pg_stat_activity en Postgres estable pese a muchos clients en pgbouncer
```

## Redis y Bull

- `REDIS_URL` obligatorio para colas de notificación/worker.
- Caída Redis: API ready sigue; holds degradan a DB — SEV-2, no reiniciar Postgres “por si acaso”.

## Escalamiento

L3 dueño de DB/pooler. L1/L2 no cambian `max_connections` sin L3.
