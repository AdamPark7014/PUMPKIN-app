#Requires -Version 5.1
<#
.SYNOPSIS
  Preflight de variables y herramientas para runbooks Boletera.
#>
$ErrorActionPreference = "Stop"

function Ok($m) { Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

if (-not $env:API_BASE) {
  $env:API_BASE = "http://127.0.0.1:4000"
  Warn "API_BASE no definido; usando $($env:API_BASE)"
} else { Ok "API_BASE=$($env:API_BASE)" }

foreach ($name in @("COMPOSE_FILE","PG_CONTAINER","API_CONTAINER","PG_USER","PG_DB","BACKUP_DIR","PG_HOST_PORT")) {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue).Value) {
    switch ($name) {
      "COMPOSE_FILE"   { $env:COMPOSE_FILE = "docker-compose.yml" }
      "PG_CONTAINER"   { $env:PG_CONTAINER = "boletera-postgres" }
      "API_CONTAINER"  { $env:API_CONTAINER = "boletera-api" }
      "PG_USER"        { $env:PG_USER = "postgres" }
      "PG_DB"          { $env:PG_DB = "boletera" }
      "BACKUP_DIR"     { $env:BACKUP_DIR = "C:\Backups\boletera" }
      "PG_HOST_PORT"   { $env:PG_HOST_PORT = "5434" }
    }
    Warn "$name default → $((Get-Item env:$name).Value)"
  } else { Ok "$name=$((Get-Item env:$name).Value)" }
}

if (Get-Command docker -ErrorAction SilentlyContinue) { Ok "docker disponible" }
else { Warn "docker no está en PATH (OK si solo operas K8s/HTTP)" }

if (Get-Command kubectl -ErrorAction SilentlyContinue) { Ok "kubectl disponible" }
else { Warn "kubectl ausente — camino K8s no usable (P-01)" }

if (Get-Command pnpm -ErrorAction SilentlyContinue) { Ok "pnpm disponible" }
else { Warn "pnpm ausente — migraciones locales no ejecutables aquí" }

Write-Host "Preflight completado." -ForegroundColor Cyan
