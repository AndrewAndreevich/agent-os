# AgentOS Client Installer
# Usage:
#   .\install.ps1
#   .\install.ps1 -OrchestratorUrl ws://192.168.1.10:3000/ws -AgentId agent-2
#   .\install.ps1 -RepoUrl https://<token>@github.com/AndrewAndreevich/agent-os.git

param(
  [string]$RepoUrl         = "https://github.com/AndrewAndreevich/agent-os.git",
  [string]$InstallDir      = "",
  [string]$OrchestratorUrl = "",
  [string]$AgentId         = "",
  [string]$AgentRole       = "dev",
  [string]$Capabilities    = "base"
)

if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE "agent-os" }

$ErrorActionPreference = "Stop"

function Write-OK   { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "     $m" -ForegroundColor Cyan }
function Write-Warn { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Step { param($n) Write-Host "" ; Write-Host "---- $n ----" -ForegroundColor White }

Write-Host ""
Write-Host "==============================="
Write-Host " AgentOS Client Installer"
Write-Host "==============================="
Write-Host ""

# ---- Step 1: Node.js ----
Write-Step "1/5 Node.js"
$nodeOk = $false
try { $v = node --version 2>$null; if ($v) { Write-OK "node $v"; $nodeOk = $true } } catch {}
if (-not $nodeOk) {
  Write-Info "Installing Node.js via winget..."
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
  $v = node --version 2>$null
  if ($v) { Write-OK "node $v" } else { Write-Warn "Node install may need a terminal restart" }
}

# ---- Step 2: Git ----
Write-Step "2/5 Git"
$gitOk = $false
try { $v = git --version 2>$null; if ($v) { Write-OK $v; $gitOk = $true } } catch {}
if (-not $gitOk) {
  Write-Info "Installing Git via winget..."
  winget install Git.Git --accept-source-agreements --accept-package-agreements --silent
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
  Write-OK "Git installed"
}

# ---- Step 3: Clone / update repo ----
Write-Step "3/5 Repository"
if (Test-Path (Join-Path $InstallDir "package.json")) {
  Write-Info "Already exists at $InstallDir - pulling latest..."
  Set-Location $InstallDir
  git pull --ff-only 2>$null
  Write-OK "Updated"
} else {
  Write-Info "Cloning into $InstallDir ..."
  git clone $RepoUrl $InstallDir
  Write-OK "Cloned"
}
Set-Location $InstallDir

# ---- Step 4: npm install ----
Write-Step "4/5 Dependencies"
npm install --omit=dev --no-audit --no-fund 2>$null
Write-OK "npm install done"

# ---- Step 5: .env ----
Write-Step "5/5 Configuration"
$EnvFile = Join-Path $InstallDir ".env"

if (-not $OrchestratorUrl) {
  $OrchestratorUrl = Read-Host "  Orchestrator URL (e.g. ws://192.168.1.10:3000/ws)"
}
if (-not $AgentId) {
  $defId = "agent-" + ($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]','')
  $typed = Read-Host "  Agent ID (Enter for default: $defId)"
  if ($typed) { $AgentId = $typed } else { $AgentId = $defId }
}

# Detect claude path
$claudePath = ""
try { $claudePath = (Get-Command claude -ErrorAction Stop).Source } catch {}
if (-not $claudePath) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\claude\claude.exe"),
    (Join-Path $env:APPDATA "npm\claude.cmd")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $claudePath = $c; break }
  }
}

$lines = @(
  "ORCHESTRATOR_URL=$OrchestratorUrl",
  "AGENT_ID=$AgentId",
  "AGENT_ROLE=$AgentRole",
  "CAPABILITIES=$Capabilities"
)
if ($claudePath) {
  $lines += "CLAUDE_PATH=$claudePath"
  Write-OK "Claude detected: $claudePath"
} else {
  $lines += "CLAUDE_PATH="
  Write-Warn "Claude not found. Install: npm install -g @anthropic-ai/claude-code"
}

[System.IO.File]::WriteAllText($EnvFile, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)
Write-OK ".env written"

# ---- Done ----
Write-Host ""
Write-Host "==============================="
Write-Host " Installation complete!"
Write-Host "==============================="
Write-Host ""
Write-Host " Agent ID  : $AgentId"
Write-Host " Server    : $OrchestratorUrl"
Write-Host " Directory : $InstallDir"
Write-Host ""
Write-Host " To start the agent:"
Write-Host "   cd $InstallDir"
Write-Host "   node client\index.js"
Write-Host ""

Write-OK "Starting agent..."
node client\index.js
