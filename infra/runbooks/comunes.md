# Comunes — variables, severidad y escalamiento

## Variables de entorno del operador (PowerShell)

Definir en la sesión antes de cualquier runbook:

```powershell
# --- Ajustar por entorno ---
$env:BOLETERA_ENV        = "prod"   # local|staging|prod
$env:API_BASE            = "https://api.ejemplo.com"   # sin slash final; local: http://127.0.0.1:4000
$env:WEB_BASE            = "https://www.ejemplo.com"
$env:ADMIN_BASE          = "https://admin.ejemplo.com"
$env:COMPOSE_FILE        = "docker-compose.yml"
$env:PG_CONTAINER        = "boletera-postgres"
$env:API_CONTAINER       = "boletera-api"
$env:PG_USER             = "postgres"
$env:PG_DB               = "boletera"
$env:PG_HOST_PORT        = "5434"   # Compose actual; no asumir 5432
$env:BACKUP_DIR          = "C:\Backups\boletera"
$env:INTERNAL_API_SECRET = $env:INTERNAL_API_SECRET  # ya en .env de prod
$env:EVENT_ID            = ""       # rellenar en on-sale / incidente
$env:JWT_STAFF           = ""       # Bearer para /metrics y validate (opcional)

# Kubernetes (solo si el cluster existe — P-01)
$env:KUBE_NS             = "boletera"
$env:KUBE_DEPLOY_API     = "boletera-api"
$env:KUBE_DEPLOY_WEB     = "boletera-web"
$env:KUBE_DEPLOY_ADMIN   = "boletera-admin"
$env:KUBE_DEPLOY_WORKER  = "boletera-worker"
```

Cargar `.env` local (solo no-prod):

```powershell
Get-Content .\.env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k,$v = $_.Split('=',2)
  [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
}
```

## Criterios de severidad

| Severidad | Criterio | Tiempo respuesta | Ejemplo |
|-----------|----------|------------------|---------|
| **SEV-1** | Venta activa caída o cobros fallando a escala | ≤ 15 min ack | API 5xx masivo; Banorte IPN caído en on-sale |
| **SEV-2** | Degradación parcial; canal alterno viable | ≤ 30 min | Redis down (holds en DB); un método de pago |
| **SEV-3** | Impacto limitado / cosmético | ≤ 4 h | Métricas admin lentas |
| **SEV-4** | Mejora / deuda | Backlog | P-01…P-10 |

## Escalamiento

| Nivel | Quién | Cuándo |
|-------|-------|--------|
| L1 | On-call plataforma | Primer triage, runbooks 01–06 |
| L2 | Backend API + pagos | SEV-1/2 pagos, órdenes inconsistentes, reconcile |
| L3 | DBA / infra cloud | Postgres, conexiones, restore, PgBouncer (cuando exista) |
| L4 | Banorte / ejecutivo comercio | Afiliación, IPN portal, SPEI bancario |
| Negocio | Promotor / ops evento | Pausar marketing, comunicar a compradores, taquilla |

Canal sugerido: bridge de incidente + hilo con `EVENT_ID`, `BOLETERA_ENV`, severidad, y salida de `scripts/health-check.ps1`.

## Preflight mínimo (siempre)

```powershell
.\infra\runbooks\scripts\preflight.ps1
.\infra\runbooks\scripts\health-check.ps1
```

Criterio GO:

- `GET /api/v1/health` → `status=ok`, `database=up`, `payments=BANORTE`
- `GET /api/v1/ready` → HTTP 200, `ready=true`
- Compose/K8s: contenedores/pods Ready
- En prod: `GET /api/v1/payments/config` → `demo=false` y `productionReady=true` (o validar con JWT)

## Comunicación plantilla

```text
INCIDENTE: [título]
SEV: [1-4]  ENV: [prod|staging]
INICIO: [ISO8601]
SÍNTOMA: [...]
ENDPOINTS AFECTADOS: [lista verificada]
MITIGACIÓN EN CURSO: [runbook N]
PRÓXIMA UPDATE: [+15/+30 min]
```
