#Requires -Version 5.1
<#
.SYNOPSIS
  Restaura un dump custom (-Fc) en el contenedor Postgres. DESTRUCTIVO.
.PARAMETER DumpFile
  Ruta local al .dump
.PARAMETER Force
  Confirma drop/create de la base.
#>
param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $DumpFile)) { Write-Error "No existe $DumpFile" }

$container = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "boletera-postgres" }
$user = if ($env:PG_USER) { $env:PG_USER } else { "postgres" }
$db = if ($env:PG_DB) { $env:PG_DB } else { "boletera" }

if (-not $Force) {
  $confirm = Read-Host "DESTRUCTIVO: drop+create '$db' en $container. Escribir RESTORE para continuar"
  if ($confirm -ne "RESTORE") {
    Write-Host "Cancelado." -ForegroundColor Yellow
    exit 2
  }
}

Write-Host "Copiando dump..." -ForegroundColor Cyan
docker cp $DumpFile "${container}:/tmp/restore.dump"

Write-Host "Terminando sesiones y recreando DB..." -ForegroundColor Yellow
docker exec -t $container psql -U $user -d postgres -c `
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();"
docker exec -t $container dropdb -U $user --if-exists $db
docker exec -t $container createdb -U $user $db
docker exec -t $container pg_restore -U $user -d $db --no-owner --role=$user /tmp/restore.dump
$code = $LASTEXITCODE
docker exec $container rm -f /tmp/restore.dump

# pg_restore puede devolver 1 con warnings; 0 ideal
if ($code -gt 1) {
  Write-Error "pg_restore falló con código $code"
}

Write-Host "[OK] Restore aplicado (exit=$code). Validar con health-check y \dt." -ForegroundColor Green
docker exec -t $container psql -U $user -d $db -c "\dt"
exit 0
