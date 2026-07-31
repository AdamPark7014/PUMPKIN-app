#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap local TicketOS/Boletera from a clean machine (PowerShell).

.DESCRIPTION
  Minimum path for a new developer:
    1) copy .env.example -> .env (if missing)
    2) start postgres + redis
    3) install deps
    4) migrate + seed
    5) optionally start apps with pnpm dev

  Does NOT write secrets. Placeholders stay as placeholders.
#>
[CmdletBinding()]
param(
  [switch]$SkipSeed,
  [switch]$SkipDev,
  [switch]$InfraOnly
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Write-Host "==> Preflight"
Assert-Command node
Assert-Command pnpm
Assert-Command docker

$nodeMajor = [int]((node -v) -replace '[^0-9].*', '')
if ($nodeMajor -lt 22) {
  throw "Node.js >= 22 required (found $(node -v))"
}

Write-Host "==> Environment file"
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host "Created .env from .env.example — replace SECRET placeholders before production use."
} else {
  Write-Host ".env already present; leaving untouched."
}

Write-Host "==> Docker infra (postgres + redis)"
# Prefer infra-only profile if compose defines one; otherwise start named services.
$composeServices = & docker compose config --services
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }

$infra = @('postgres', 'redis') | Where-Object { $composeServices -contains $_ }
if ($infra.Count -lt 2) {
  throw "docker-compose.yml must expose postgres and redis services. Found: $($composeServices -join ', ')"
}

& docker compose up -d --wait @infra
if ($LASTEXITCODE -ne 0) { throw "Failed to start infra services" }

if ($InfraOnly) {
  Write-Host "Infra-only bootstrap complete."
  exit 0
}

Write-Host "==> Install dependencies"
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
  Write-Warning "frozen-lockfile install failed; retrying without freeze for local bootstrap"
  & pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
}

Write-Host "==> Prisma generate + migrate"
& pnpm db:generate
if ($LASTEXITCODE -ne 0) { throw "db:generate failed" }
& pnpm db:migrate:deploy
if ($LASTEXITCODE -ne 0) {
  Write-Warning "db:migrate:deploy failed; attempting db push for empty local DB"
  & pnpm --filter @boletera/database exec prisma db push --skip-generate
  if ($LASTEXITCODE -ne 0) { throw "Schema apply failed" }
}

if (-not $SkipSeed) {
  Write-Host "==> Seed"
  & pnpm db:seed
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Seed failed (non-fatal for bootstrap). Inspect packages/database seed logs."
  }
}

if (-not $SkipDev) {
  Write-Host "==> Starting apps (pnpm dev). Stop with Ctrl+C."
  & pnpm dev
} else {
  Write-Host @"

Bootstrap complete.

Next:
  pnpm dev
  # or selectively:
  pnpm dev:api
  pnpm dev:web
  pnpm dev:admin
  pnpm dev:taquilla
  pnpm dev:worker

Health:
  curl http://127.0.0.1:4000/api/v1/health
  curl http://127.0.0.1:4000/api/v1/ready
"@
}
