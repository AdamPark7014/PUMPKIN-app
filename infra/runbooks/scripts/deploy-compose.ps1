#Requires -Version 5.1
<#
.SYNOPSIS
  Build + up de api/web/admin vía Docker Compose.
.PARAMETER ImageTag
  Etiqueta informativa (Compose del repo no parametriza tag por defecto).
.PARAMETER SkipBuild
  Solo up -d.
#>
param(
  [string]$ImageTag = "local",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$compose = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { "docker-compose.yml" }

if (-not (Test-Path $compose)) {
  Write-Error "No se encuentra $compose en $(Get-Location). Ejecutar desde la raíz del repo."
}

Write-Host "Deploy Compose tag=$ImageTag file=$compose" -ForegroundColor Cyan

if (-not $SkipBuild) {
  docker compose -f $compose build api web admin
  if ($LASTEXITCODE -ne 0) {
    Write-Host @"
[FAIL] build Compose falló.
P-09: el Dockerfile monorepo puede estar incompleto.
Abortar o desplegar artefacto preconstruido fuera de este script.
"@ -ForegroundColor Red
    exit 1
  }
}

docker compose -f $compose up -d postgres redis
docker compose -f $compose up -d api web admin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Esperando health..." -ForegroundColor Cyan
Start-Sleep -Seconds 20
& "$PSScriptRoot\health-check.ps1" -Strict
exit $LASTEXITCODE
