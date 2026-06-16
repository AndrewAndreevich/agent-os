# AgentOS — Tool Installer
# Run from the agent-os folder after extracting the archive:
#   .\install.ps1
#   .\install.ps1 -OrchestratorUrl ws://192.168.1.10:3000/ws -AgentId agent-2

param(
  [string]$OrchestratorUrl = "",
  [string]$AgentId         = "",
  [string]$AgentRole       = "dev",
  [string]$Capabilities    = "base"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-OK   { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "     $m" -ForegroundColor Cyan }
function Write-Warn { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Step { param($n) Write-Host ""; Write-Host "---- $n ----" -ForegroundColor White }

Write-Host ""
Write-Host "==============================="
Write-Host " AgentOS Tool Installer"
Write-Host "==============================="

# ---- Node.js ----
Write-Step "1/4 Node.js"
$nodeOk = $false
try { $v = node --version 2>$null; if ($v) { Write-OK "node $v"; $nodeOk = $true } } catch {}
if (-not $nodeOk) {
  Write-Info "Installing via winget..."
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
  try { $v = node --version 2>$null; Write-OK "node $v" } catch { Write-Warn "Restart terminal if node not found" }
}

# ---- Git ----
Write-Step "2/4 Git"
$gitOk = $false
try { $v = git --version 2>$null; if ($v) { Write-OK $v; $gitOk = $true } } catch {}
if (-not $gitOk) {
  Write-Info "Installing via winget..."
  winget install Git.Git --accept-source-agreements --accept-package-agreements --silent
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
  Write-OK "Git installed"
}

# ---- PM2 ----
Write-Step "3/4 PM2"
$pm2Ok = $false
try { $v = pm2 --version 2>$null; if ($v) { Write-OK "pm2 $v"; $pm2Ok = $true } } catch {}
if (-not $pm2Ok) {
  Write-Info "Installing pm2 globally..."
  npm install -g pm2
  Write-OK "PM2 installed"
}

# ---- Claude Code ----
Write-Step "4/4 Claude Code"
$claudePath = ""
try { $claudePath = (Get-Command claude -ErrorAction Stop).Source; Write-OK "already installed: $claudePath" } catch {}
if (-not $claudePath) {
  Write-Info "Installing claude globally..."
  npm install -g @anthropic-ai/claude-code
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
  try { $claudePath = (Get-Command claude -ErrorAction Stop).Source; Write-OK $claudePath } catch {}
}
if (-not $claudePath) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\claude\claude.exe"),
    (Join-Path $env:APPDATA "npm\claude.cmd"),
    (Join-Path $env:APPDATA "npm\claude.ps1")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $claudePath = $c; Write-OK "found: $claudePath"; break }
  }
}
if (-not $claudePath) { Write-Warn "claude not found after install" }

# ---- npm install (project deps) ----
Write-Host ""
Write-Host "---- Installing project dependencies ----"
Set-Location $Root
npm install --no-audit --no-fund 2>$null
Write-OK "dependencies ready"

# ---- .env ----
Write-Host ""
Write-Host "---- Configuration ----"
$EnvFile = Join-Path $Root ".env"

if (-not $OrchestratorUrl) {
  $OrchestratorUrl = Read-Host "  Orchestrator URL (e.g. ws://192.168.1.10:3000/ws)"
}
if (-not $AgentId) {
  $defId = "agent-" + ($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]','')
  $typed = Read-Host "  Agent ID (Enter for: $defId)"
  if ($typed) { $AgentId = $typed } else { $AgentId = $defId }
}

$lines = @(
  "ORCHESTRATOR_URL=$OrchestratorUrl",
  "AGENT_ID=$AgentId",
  "AGENT_ROLE=$AgentRole",
  "CAPABILITIES=$Capabilities",
  "CLAUDE_PATH=$claudePath"
)
[System.IO.File]::WriteAllText($EnvFile, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)
Write-OK ".env saved"

# ---- Start ----
Write-Host ""
Write-Host "==============================="
Write-Host " Done! Starting agent..."
Write-Host "==============================="
Write-Host ""
node client\index.js
