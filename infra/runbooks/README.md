# Runbooks operativos — Boletera

Documentación ejecutable en español para operaciones de producción y on-sale.
**Dueño exclusivo de esta carpeta:** `infra/runbooks/**`.

## Índice

| Runbook | Uso |
|---------|-----|
| [00-hallazgos-y-pendientes.md](./00-hallazgos-y-pendientes.md) | Inventario real del repo + endpoints verificados + gaps |
| [comunes.md](./comunes.md) | Variables, criterios Severidad, escalamiento, preflight |
| [01-despliegue.md](./01-despliegue.md) | Despliegue (Compose hoy; plantilla K8s pendiente) |
| [02-rollback.md](./02-rollback.md) | Rollback de versión / imagen |
| [03-backup-restore-postgres.md](./03-backup-restore-postgres.md) | Backup y restore PostgreSQL |
| [04-incidente-pagos.md](./04-incidente-pagos.md) | Incidente Banorte / pagos |
| [05-caida-api-durante-venta.md](./05-caida-api-durante-venta.md) | Caída API en ventana de venta |
| [06-onsale-masivo.md](./06-onsale-masivo.md) | Preparación y operación de on-sale masivo |
| [07-capacidad-db-scaling-pgbouncer.md](./07-capacidad-db-scaling-pgbouncer.md) | Pool DB, HPA, recursos, PgBouncer |
| [08-waiting-room-y-colas.md](./08-waiting-room-y-colas.md) | Waiting room / colas — límites de lo no implementado |

## Scripts PowerShell

| Script | Runbook |
|--------|---------|
| [scripts/preflight.ps1](./scripts/preflight.ps1) | comunes / despliegue / on-sale |
| [scripts/health-check.ps1](./scripts/health-check.ps1) | todos |
| [scripts/deploy-compose.ps1](./scripts/deploy-compose.ps1) | 01 |
| [scripts/rollback-compose.ps1](./scripts/rollback-compose.ps1) | 02 |
| [scripts/pg-backup.ps1](./scripts/pg-backup.ps1) | 03 |
| [scripts/pg-restore.ps1](./scripts/pg-restore.ps1) | 03 |
| [scripts/payments-triage.ps1](./scripts/payments-triage.ps1) | 04 |
| [scripts/onsale-watch.ps1](./scripts/onsale-watch.ps1) | 06 |

## Cómo usar

1. Leer [00-hallazgos-y-pendientes.md](./00-hallazgos-y-pendientes.md) antes del primer incidente.
2. Exportar variables de [comunes.md](./comunes.md).
3. Ejecutar el runbook correspondiente; preferir los `.ps1` cuando existan.
4. No inventar endpoints: si no aparece en hallazgos, está **PENDIENTE**.

## Alcance explícito

- **Hoy en repo:** Docker Compose (`postgres`, `redis`, `api`, `web`, `admin`), health/ready HTTP, Banorte, Prisma sin pool custom, waitlist (lista de espera de evento, no waiting room de tráfico).
- **No en repo:** manifiestos Kubernetes, PgBouncer, waiting room/CDN queue, HPA, ResourceQuota, pipelines de deploy a prod.
