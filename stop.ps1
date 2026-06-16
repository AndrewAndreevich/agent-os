# AgentOS Stop Script

Write-Host ""
Write-Host "=== AgentOS Stopping ==="
Write-Host ""

# Kill by port 3000 (server)
$conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($conn) {
  $p = ($conn | Select-Object -First 1).OwningProcess
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
  Write-Host "[OK] Server stopped (pid $p)"
} else {
  Write-Host "[--] Server was not running"
}

# Kill node processes named client/index.js
$nodes = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
foreach ($proc in $nodes) {
  $cmd = $proc.CommandLine
  if ($cmd -and ($cmd -like "*client/index.js*" -or $cmd -like "*client\index.js*")) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Client stopped (pid $($proc.ProcessId))"
  }
}

Write-Host ""
Write-Host "Done."
Write-Host ""
