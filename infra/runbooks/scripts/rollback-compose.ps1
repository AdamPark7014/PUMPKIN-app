#Requires -Version 5.1
<#
.SYNOPSIS
  Recrea api/web/admin. Con ImageTag documenta LKG; Compose del repo no versiona tags nativamente.
.PARAMETER ImageTag
  Tag LKG (informativo / para operadores que inyectan IMAGE en override).
.PARAMETER Services
  Lista de servicios a recrear.
#>
param(
  [Parameter(Mandatory = $true)][string]$ImageTag,
  [string[]]$Services = @("api", "web", "admin")
)

$ErrorActionPreference = "Stop"
$compose = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { "docker-compose.yml" }

Write-Host "Rollback Compose → LKG=$ImageTag services=$($Services -join ',')" -ForegroundColor Yellow
Write-Host "Si usas imágenes taggeadas, exporta variables/override antes de este script." -ForegroundColor Yellow

$env:IMAGE_TAG = $ImageTag
docker compose -f $compose up -d --no-deps --force-recreate @Services
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Start-Sleep -Seconds 15
& "$PSScriptRoot\health-check.ps1" -Strict
exit $LASTEXITCODE
