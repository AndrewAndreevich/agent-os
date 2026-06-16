# AgentOS Start Script
# Runs server + client in separate windows, then opens browser

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host ""
Write-Host "=== AgentOS Starting ==="
Write-Host ""

# Kill anything already on port 3000
$existing = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($existing) {
  $pid3000 = ($existing | Select-Object -First 1).OwningProcess
  Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue
  Write-Host "[OK] Cleared port 3000"
  Start-Sleep -Milliseconds 500
}

# Start server in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; node server/index.js" -WindowStyle Normal

Write-Host "[OK] Server window opened"

# Wait for server to bind
Start-Sleep -Seconds 2

# Check server is up
$up = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $null = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -ErrorAction Stop
    $up = $true
    break
  } catch {}
  Start-Sleep -Milliseconds 500
}

if ($up) {
  Write-Host "[OK] Server is up at http://localhost:3000"
} else {
  Write-Host "[WARN] Server did not respond in time, continuing anyway"
}

# Start client in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; node client/index.js" -WindowStyle Normal

Write-Host "[OK] Client window opened"
Start-Sleep -Milliseconds 800

# Open browser
Start-Process "http://localhost:3000"
Write-Host "[OK] Browser opened"

Write-Host ""
Write-Host "AgentOS is running."
Write-Host "  Dashboard : http://localhost:3000"
Write-Host "  Stop      : .\stop.ps1"
Write-Host ""
