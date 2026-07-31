# Probes infra readiness endpoints on localhost.
$ErrorActionPreference = "Continue"
$targets = @(
  @{ Name = "otel-collector"; Url = "http://127.0.0.1:13133/" },
  @{ Name = "prometheus"; Url = "http://127.0.0.1:9090/-/ready" },
  @{ Name = "loki"; Url = "http://127.0.0.1:3100/ready" },
  @{ Name = "tempo"; Url = "http://127.0.0.1:3200/ready" },
  @{ Name = "grafana"; Url = "http://127.0.0.1:3003/api/health" }
)
$failed = 0
foreach ($t in $targets) {
  try {
    $resp = Invoke-WebRequest -Uri $t.Url -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      Write-Host ("OK  {0,-16} {1}" -f $t.Name, $t.Url)
    } else {
      Write-Host ("BAD {0,-16} HTTP {1}" -f $t.Name, $resp.StatusCode)
      $failed++
    }
  } catch {
    Write-Host ("DOWN {0,-16} {1}" -f $t.Name, $_.Exception.Message)
    $failed++
  }
}
if ($failed -gt 0) {
  Write-Host "Health check failed ($failed targets). Is the stack up?"
  exit 1
}
Write-Host "All infra probes healthy."