#Requires -Version 5.1
<#
.SYNOPSIS
  pg_dump -Fc desde el contenedor Postgres Compose.
#>
param(
  [string]$Label = "manual"
)

$ErrorActionPreference = "Stop"
$container = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "boletera-postgres" }
$user = if ($env:PG_USER) { $env:PG_USER } else { "postgres" }
$db = if ($env:PG_DB) { $env:PG_DB } else { "boletera" }
$dir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "C:\Backups\boletera" }

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeLabel = ($Label -replace "[^\w\-]", "_")
$fileName = "boletera-$safeLabel-$stamp.dump"
$file = Join-Path $dir $fileName

Write-Host "Backup $db desde $container → $file" -ForegroundColor Cyan

docker exec -t $container pg_dump -U $user -d $db -Fc -f "/tmp/boletera.dump"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker cp "${container}:/tmp/boletera.dump" $file
docker exec $container rm -f /tmp/boletera.dump

$hash = Get-FileHash $file -Algorithm SHA256
$hash | Tee-Object -FilePath "$file.sha256.txt"
$item = Get-Item $file
if ($item.Length -le 0) {
  Write-Error "Backup vacío"
}

Write-Host "[OK] Backup $($item.Length) bytes SHA256=$($hash.Hash)" -ForegroundColor Green
Write-Output $file
