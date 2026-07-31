#Requires -Version 5.1
<#
.SYNOPSIS
  Validates infra artifacts that DevOps owns (compose, turbo, dockerfiles, observability).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$failures = @()

function Check([string]$Name, [scriptblock]$Block) {
  Write-Host "==> $Name"
  try {
    & $Block
    Write-Host "OK  $Name"
  } catch {
    Write-Host "FAIL $Name : $($_.Exception.Message)"
    $script:failures += $Name
  }
}

Check 'package.json + turbo.json parse' {
  node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('turbo.json','utf8'));"
}

Check 'turbo build dry-run' {
  pnpm exec turbo run build --dry=json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "turbo dry-run failed" }
}

Check 'docker compose config (root)' {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not installed' }
  docker compose config | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'compose config failed' }
}

Check 'observability compose config' {
  if (-not (Test-Path 'infra/observability/compose.yaml')) { throw 'missing compose.yaml' }
  $env:GRAFANA_ADMIN_PASSWORD = 'change-me-local-only'
  docker compose -f infra/observability/compose.yaml config | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'observability compose config failed' }
}

Check 'dockerfiles present' {
  $needed = @(
    'docker/api.Dockerfile',
    'docker/worker.Dockerfile'
  )
  foreach ($f in $needed) {
    if (-not (Test-Path $f)) { throw "missing $f" }
  }
}

Check 'runbook PowerShell syntax' {
  Get-ChildItem -Path infra/runbooks -Filter *.ps1 -Recurse | ForEach-Object {
    $tokens = $null
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) {
      throw "$($_.Name): $($errs[0].Message)"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Error ("Infra verification failed: " + ($failures -join ', '))
  exit 1
}

Write-Host "All infra checks passed."
