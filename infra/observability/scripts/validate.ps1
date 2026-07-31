# Validates observability YAML/JSON configs locally (PowerShell).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "==> Root: $Root"

function Assert-File([string]$Rel) {
  $p = Join-Path $Root $Rel
  if (-not (Test-Path $p)) { throw "Missing file: $Rel" }
  Write-Host "OK file $Rel"
}

Assert-File "compose.yaml"
Assert-File "otel-collector/config.yaml"
Assert-File "prometheus/prometheus.yml"
Assert-File "prometheus/rules/ticketing-slo.yml"
Assert-File "loki/config.yaml"
Assert-File "tempo/config.yaml"
Assert-File "grafana/provisioning/datasources/datasources.yaml"
Assert-File "grafana/provisioning/dashboards/dashboards.yaml"
Assert-File "grafana/provisioning/alerting/ticketing-slo.yaml"
Assert-File "grafana/dashboards/ticketing-slo.json"
Assert-File "grafana/dashboards/infra-health.json"
Assert-File ".env.example"

Get-ChildItem -Recurse -Filter *.json | ForEach-Object {
  try {
    Get-Content -Raw $_.FullName | ConvertFrom-Json | Out-Null
    $rel = $_.FullName.Substring($Root.Length + 1)
    Write-Host "OK json $rel"
  } catch {
    throw "Invalid JSON: $($_.Exception.Message)"
  }
}

$pyCheck = Join-Path $Root "scripts/_yaml_check.py"
@(
  "import pathlib, sys"
  "try:"
  "    import yaml"
  "except ImportError:"
  "    sys.exit(2)"
  "root = pathlib.Path('.')"
  "files = list(root.rglob('*.yml')) + list(root.rglob('*.yaml'))"
  "for f in files:"
  "    list(yaml.safe_load_all(f.read_text(encoding='utf-8-sig')))"
  "    print(f'OK yaml {f.as_posix()}')"
) | Set-Content -Encoding utf8 $pyCheck

$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
  $result = & python $pyCheck 2>&1
  if ($LASTEXITCODE -eq 0) {
    $result | ForEach-Object { Write-Host $_ }
  } elseif ($LASTEXITCODE -eq 2) {
    Write-Host "PyYAML not installed; skipping python YAML parse"
  } else {
    $result | ForEach-Object { Write-Host $_ }
    throw "YAML validation failed via python"
  }
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Host "==> docker compose config"
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
  }
  docker compose --env-file .env -f compose.yaml config --quiet
  if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }
  Write-Host "OK docker compose config"

  Write-Host "==> otel collector validate"
  docker run --rm -v "${Root}/otel-collector/config.yaml:/etc/otelcol-contrib/config.yaml:ro" otel/opentelemetry-collector-contrib:0.120.0 validate --config=/etc/otelcol-contrib/config.yaml
  if ($LASTEXITCODE -ne 0) { throw "otel collector validate failed" }
  Write-Host "OK otel collector config"

  Write-Host "==> promtool check config"
  docker run --rm -v "${Root}/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" -v "${Root}/prometheus/rules:/etc/prometheus/rules:ro" --entrypoint promtool prom/prometheus:v3.2.1 check config /etc/prometheus/prometheus.yml
  if ($LASTEXITCODE -ne 0) { throw "promtool check config failed" }
  Write-Host "OK prometheus config"

  Write-Host "==> promtool check rules"
  docker run --rm -v "${Root}/prometheus/rules:/etc/prometheus/rules:ro" --entrypoint promtool prom/prometheus:v3.2.1 check rules /etc/prometheus/rules/ticketing-slo.yml
  if ($LASTEXITCODE -ne 0) { throw "promtool check rules failed" }
  Write-Host "OK prometheus rules"

  Write-Host "==> loki verify-config"
  docker run --rm -v "${Root}/loki/config.yaml:/etc/loki/config.yaml:ro" grafana/loki:3.4.2 "-config.file=/etc/loki/config.yaml" "-verify-config"
  if ($LASTEXITCODE -ne 0) { throw "loki verify-config failed" }
  Write-Host "OK loki config"

  Write-Host "==> tempo config.verify"
  docker run --rm -v "${Root}/tempo/config.yaml:/etc/tempo/config.yaml:ro" grafana/tempo:2.7.1 "-config.file=/etc/tempo/config.yaml" "-config.verify=true"
  if ($LASTEXITCODE -ne 0) { throw "tempo config.verify failed" }
  Write-Host "OK tempo config"
} else {
  Write-Host "WARN: docker not available"
}

Write-Host ""
Write-Host "Validation finished successfully."