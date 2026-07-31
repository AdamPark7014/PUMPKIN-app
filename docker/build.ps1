# Build a Boletera image using docker/.dockerignore (repo-root context).
# The Docker CLI here does not support --ignorefile; this script temporarily
# replaces the root .dockerignore contents and always restores the original.
#
# Usage (from repo root or docker/):
#   ./docker/build.ps1 -Dockerfile docker/api.Dockerfile -Tag boletera-api
#   ./docker/build.ps1 -Dockerfile docker/web.Dockerfile -Tag boletera-web -BuildArgs @{ NEXT_PUBLIC_API_URL = "https://api.example.com/api/v1" }

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Dockerfile,

  [Parameter(Mandatory = $true)]
  [string] $Tag,

  [string] $Target,

  [hashtable] $BuildArgs = @{},

  [string[]] $ExtraArgs = @()
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DockerIgnore = Join-Path $Root ".dockerignore"
$PreferredIgnore = Join-Path $PSScriptRoot ".dockerignore"

if (-not (Test-Path (Join-Path $Root $Dockerfile)) -and -not (Test-Path $Dockerfile)) {
  throw "Dockerfile not found: $Dockerfile"
}

$df = if (Test-Path $Dockerfile) { (Resolve-Path $Dockerfile).Path } else { (Resolve-Path (Join-Path $Root $Dockerfile)).Path }

$hadIgnore = Test-Path $DockerIgnore
$originalIgnore = if ($hadIgnore) { [System.IO.File]::ReadAllText($DockerIgnore) } else { $null }
$preferred = [System.IO.File]::ReadAllText($PreferredIgnore)

Push-Location $Root
try {
  [System.IO.File]::WriteAllText($DockerIgnore, $preferred)

  $cmd = @("build", "-f", $df, "-t", $Tag)
  if ($Target) { $cmd += @("--target", $Target) }
  foreach ($key in $BuildArgs.Keys) {
    $cmd += @("--build-arg", "$key=$($BuildArgs[$key])")
  }
  if ($ExtraArgs.Count -gt 0) { $cmd += $ExtraArgs }
  $cmd += "."

  Write-Host ">> docker $($cmd -join ' ')" -ForegroundColor Cyan
  & docker @cmd
  if ($LASTEXITCODE -ne 0) { throw "docker build failed with exit $LASTEXITCODE" }
}
finally {
  if ($null -ne $originalIgnore) {
    [System.IO.File]::WriteAllText($DockerIgnore, $originalIgnore)
  }
  elseif ((Test-Path $DockerIgnore) -and -not $hadIgnore) {
    Remove-Item -Force $DockerIgnore -ErrorAction SilentlyContinue
  }
  Pop-Location
}
