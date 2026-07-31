# 03 — Backup y restore PostgreSQL

## Objetivo

Generar dumps consistentes y restaurar con validación. Aplicable a Compose (`boletera-postgres`) y a Postgres administrado (comandos `pg_dump`/`psql` equivalentes).

## Criterios de entrada

- [ ] Acceso al contenedor o a credenciales DB.
- [ ] Disco en `$BACKUP_DIR` con espacio ≥ 2× tamaño DB.
- [ ] En restore productivo: ventana + aprobación L3 + freeze de API.

## Backup (Compose / contenedor)

```powershell
.\infra\runbooks\scripts\pg-backup.ps1 -Label "manual"
```

Equivalente manual:

```powershell
New-Item -ItemType Directory -Force -Path $env:BACKUP_DIR | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $env:BACKUP_DIR "boletera-$stamp.dump"

docker exec -t $env:PG_CONTAINER pg_dump -U $env:PG_USER -d $env:PG_DB -Fc -f "/tmp/boletera.dump"
docker cp "${env:PG_CONTAINER}:/tmp/boletera.dump" $file
docker exec $env:PG_CONTAINER rm -f /tmp/boletera.dump

Get-FileHash $file -Algorithm SHA256 | Out-File "$file.sha256.txt"
Write-Host "Backup OK: $file"
```

### Postgres en host (sin Docker)

```powershell
# Puerto Compose host = 5434
$env:PGPASSWORD = "****"
pg_dump -h 127.0.0.1 -p $env:PG_HOST_PORT -U $env:PG_USER -d $env:PG_DB -Fc -f $file
```

### Kubernetes (si el pod DB existe — P-01)

```powershell
$pgPod = kubectl -n $env:KUBE_NS get pod -l app=postgres -o jsonpath="{.items[0].metadata.name}"
kubectl -n $env:KUBE_NS exec $pgPod -- pg_dump -U $env:PG_USER -d $env:PG_DB -Fc -f /tmp/boletera.dump
kubectl -n $env:KUBE_NS cp "$env:KUBE_NS/${pgPod}:/tmp/boletera.dump" $file
```

## Verificación de backup

```powershell
# Tamaño > 0 y hash presente
Get-Item $file | Select-Object FullName, Length
# Listar TOC del dump custom
docker run --rm -v "${env:BACKUP_DIR}:/b" postgres:16-alpine `
  pg_restore -l "/b/$(Split-Path $file -Leaf)"
```

PASS: listado TOC sin error; tamaño estable vs backup previo (± umbral esperado).

## Restore

**Destructivo.** Congelar API primero.

```powershell
docker compose -f $env:COMPOSE_FILE stop api web admin
# o: kubectl -n $env:KUBE_NS scale deploy/$env:KUBE_DEPLOY_API --replicas=0

.\infra\runbooks\scripts\pg-restore.ps1 -DumpFile $file
```

Manual:

```powershell
docker cp $file "${env:PG_CONTAINER}:/tmp/restore.dump"
# Opción segura: restaurar a DB nueva y renombrar (preferida en prod)
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$env:PG_DB' AND pid <> pg_backend_pid();"
docker exec -t $env:PG_CONTAINER dropdb -U $env:PG_USER --if-exists $env:PG_DB
docker exec -t $env:PG_CONTAINER createdb -U $env:PG_USER $env:PG_DB
docker exec -t $env:PG_CONTAINER pg_restore -U $env:PG_USER -d $env:PG_DB --no-owner --role=$env:PG_USER /tmp/restore.dump
```

## Post-restore

```powershell
docker compose -f $env:COMPOSE_FILE start api web admin
.\infra\runbooks\scripts\health-check.ps1 -Strict

# Sanity SQL
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -d $env:PG_DB -c "SELECT COUNT(*) AS orders FROM \"Order\";"
# Nota: nombres de tabla Prisma pueden ser distintos; si falla, \dt y ajustar.
docker exec -t $env:PG_CONTAINER psql -U $env:PG_USER -d $env:PG_DB -c "\dt"
```

PASS: ready=true; conteos coherentes con el momento del dump; login admin OK.

## Retención sugerida

| Tipo | Retención |
|------|-----------|
| Pre-deploy | 14 días |
| Diario | 7–30 días según política org |
| Pre-onsale | Hasta 7 días post-evento |

## Escalamiento

L3 lidera restore prod. L2 valida app. Negocio comunica downtime.
