#Requires -Version 5.1
# AgentOS Bootstrap for Windows
# Run as Administrator in PowerShell
#
# Usage:
#   .\bootstrap.ps1
#   .\bootstrap.ps1 -AgentId agent-1 -Role dev -OrchestratorUrl ws://192.168.1.100:3000/ws -Capabilities base,blender
#
# First time: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

param(
  [string]$AgentId = "",
  [string]$Role = "dev",
  [string]$OrchestratorUrl = "",
  [string]$Capabilities = "base",
  [string]$RepoUrl = "",
  [switch]$SkipInstall = $false
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $ProjectDir ".env"

# --- Helpers ------------------------------------------------------------------

function Write-Header($text) {
  Write-Host ""
  Write-Host "=======================================" -ForegroundColor Cyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host "=======================================" -ForegroundColor Cyan
}

function Write-Step($n, $text) {
  Write-Host ""
  Write-Host "[$n] $text" -ForegroundColor Yellow
}

function Write-OK($text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [WARN] $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "  [FAIL] $text" -ForegroundColor Red }

function Test-Command($cmd) {
  try { $null = Get-Command $cmd -ErrorAction Stop; return $true } catch { return $false }
}

function Refresh-Path {
  $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
  $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
  $env:PATH    = "$machinePath;$userPath"
}

function Install-WithWinget($id, $name) {
  Write-Host "  Installing $name via winget..."
  try {
    winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null
    Refresh-Path
    Write-OK "$name installed"
    return $true
  } catch {
    Write-Warn "winget failed for $name - $_"
    return $false
  }
}

function Set-EnvValue($file, $key, $value) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { $content = "" }
  if ($content -match "(?m)^$key=") {
    $content = $content -replace "(?m)^$key=.*", "$key=$value"
  } else {
    $content = $content.TrimEnd() + "`r`n$key=$value"
  }
  Set-Content $file $content -NoNewline
}

function Get-EnvValue($file, $key) {
  $content = Get-Content $file -ErrorAction SilentlyContinue
  foreach ($line in $content) {
    if ($line -match "^$key=(.*)$") { return $matches[1].Trim() }
  }
  return ""
}

# --- Start --------------------------------------------------------------------

Write-Header "AgentOS Bootstrap v1.0 - Windows"

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Warn "Not running as Administrator. Some installs may fail."
  Write-Host "  Tip: Right-click PowerShell -> Run as Administrator"
}

# Check PowerShell version
Write-Host "PowerShell version: $($PSVersionTable.PSVersion)"
Write-Host "Windows: $([System.Environment]::OSVersion.VersionString)"

# --- Step 1: Execution Policy -------------------------------------------------

Write-Step 1 "Setting PowerShell execution policy"
try {
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
  Write-OK "Execution policy: RemoteSigned (CurrentUser)"
} catch {
  Write-Warn "Could not set execution policy: $_"
}

# --- Step 2: Check winget -----------------------------------------------------

Write-Step 2 "Checking winget"
if (Test-Command "winget") {
  $wv = winget --version 2>$null
  Write-OK "winget $wv"
} else {
  Write-Warn "winget not found. Install 'App Installer' from Microsoft Store."
  Write-Host "  https://www.microsoft.com/store/productId/9NBLGGH4NNS1"
  Write-Host "  Continuing - some installs may fail without winget."
}

# --- Step 3: Install Git for Windows ------------------------------------------

Write-Step 3 "Git for Windows"
if (Test-Command "git") {
  $v = git --version
  Write-OK $v
} else {
  Install-WithWinget "Git.Git" "Git for Windows"
  Refresh-Path
  if (-not (Test-Command "git")) {
    $env:PATH += ";C:\Program Files\Git\bin;C:\Program Files\Git\cmd"
    Write-Warn "Added Git to PATH for this session. Restart PowerShell after bootstrap."
  }
}

# --- Step 4: Install Node.js --------------------------------------------------

Write-Step 4 "Node.js LTS"
if (Test-Command "node") {
  $v = node --version
  Write-OK "node $v"
} else {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  Refresh-Path
  if (-not (Test-Command "node")) {
    $env:PATH += ";C:\Program Files\nodejs"
    Write-Warn "Added Node.js to PATH for this session."
  }
}

# Verify npm
if (Test-Command "npm") {
  Write-OK "npm $(npm --version)"
} else {
  Write-Fail "npm not found after Node.js install - check installation"
}

# --- Step 5: Install Python ---------------------------------------------------

Write-Step 5 "Python 3.11"
if (Test-Command "python") {
  $v = python --version
  Write-OK $v
} else {
  Install-WithWinget "Python.Python.3.11" "Python 3.11"
  Refresh-Path
  # Python installer may add to user PATH
  $pyPath = "$env:LOCALAPPDATA\Programs\Python\Python311"
  if (Test-Path $pyPath) {
    $env:PATH += ";$pyPath;$pyPath\Scripts"
    Write-Warn "Added Python to PATH for this session."
  }
}

# --- Step 6: Install PM2 ------------------------------------------------------

Write-Step 6 "PM2 (process manager)"
if (Test-Command "pm2") {
  $v = pm2 --version
  Write-OK "pm2 $v"
} else {
  Write-Host "  Installing PM2..."
  npm install -g pm2 2>&1 | Out-Null
  npm install -g pm2-windows-startup 2>&1 | Out-Null
  Refresh-Path
  if (Test-Command "pm2") {
    Write-OK "PM2 installed"
    # Setup Windows Task Scheduler autostart
    try {
      pm2-startup install 2>&1 | Out-Null
      Write-OK "PM2 autostart configured via Windows Task Scheduler"
    } catch {
      Write-Warn "PM2 autostart setup failed - run 'pm2-startup install' manually after reboot"
    }
  } else {
    Write-Fail "PM2 install failed - try: npm install -g pm2"
  }
}

# --- Step 7: Install Claude Code ----------------------------------------------

Write-Step 7 "Claude Code CLI"
if (Test-Command "claude") {
  Write-OK "claude installed"
} else {
  Write-Host "  Installing Claude Code..."
  try {
    npm install -g @anthropic-ai/claude-code 2>&1 | Out-Null
    Refresh-Path
    Write-OK "Claude Code installed"
  } catch {
    Write-Warn "Claude Code install failed: $_"
  }
}

# --- Detect claude path (saved to .env in Step 10 once .env exists) ---
Write-Host "  Detecting claude CLI path..."
$claudeDetected = $null

try {
  $claudeCmd = Get-Command claude -ErrorAction Stop
  $claudeDetected = $claudeCmd.Source
} catch {}

if (-not $claudeDetected) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\claude\claude.exe"),
    (Join-Path $env:APPDATA "npm\claude.cmd"),
    (Join-Path $env:APPDATA "npm\claude.ps1")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $claudeDetected = $c; break }
  }
}

if (-not $claudeDetected) {
  try {
    $whereResult = (where.exe claude 2>$null) | Select-Object -First 1
    if ($whereResult -and (Test-Path $whereResult.Trim())) {
      $claudeDetected = $whereResult.Trim()
    }
  } catch {}
}

if ($claudeDetected) {
  Write-OK "claude found: $claudeDetected"
} else {
  Write-Warn "claude path not detected. Run: node scripts/detect-claude.js after install"
}

# --- Step 8: Clone or update repo ---------------------------------------------

Write-Step 8 "Project repository"
if (Test-Path (Join-Path $ProjectDir "package.json")) {
  Write-OK "Project already at $ProjectDir"
  Set-Location $ProjectDir
  try {
    git pull origin main 2>&1 | Out-Null
    Write-OK "Pulled latest changes"
  } catch {
    Write-Warn "Could not pull latest (continuing with current version)"
  }
} elseif ($RepoUrl) {
  Write-Host "  Cloning $RepoUrl..."
  git clone $RepoUrl $ProjectDir
  Set-Location $ProjectDir
  Write-OK "Repository cloned"
} else {
  Set-Location $ProjectDir
  Write-OK "Using existing project at $ProjectDir"
}

# --- Step 9: npm install ------------------------------------------------------

Write-Step 9 "Installing npm dependencies"
npm install
Write-OK "Dependencies installed"

# --- Step 10: Configure .env --------------------------------------------------

Write-Step 10 "Configuring .env"

if (-not (Test-Path $EnvFile)) {
  $exampleFile = Join-Path $ProjectDir ".env.example"
  if (Test-Path $exampleFile) {
    Copy-Item $exampleFile $EnvFile
    Write-OK "Created .env from .env.example"
  } else {
    New-Item $EnvFile -ItemType File | Out-Null
    Write-OK "Created empty .env"
  }
}

# Write values from params
if ($AgentId)        { Set-EnvValue $EnvFile "AGENT_ID" $AgentId }
if ($OrchestratorUrl){ Set-EnvValue $EnvFile "ORCHESTRATOR_URL" $OrchestratorUrl }
if ($Role)           { Set-EnvValue $EnvFile "AGENT_ROLE" $Role }
if ($Capabilities)   { Set-EnvValue $EnvFile "CAPABILITIES" $Capabilities }

# Save detected claude path (from Step 7) now that .env exists
if ($claudeDetected) {
  Set-EnvValue $EnvFile "CLAUDE_PATH" $claudeDetected
  Write-OK "CLAUDE_PATH saved to .env"
}

# Check required fields
$missingFields = @()
$reqAgentId = Get-EnvValue $EnvFile "AGENT_ID"
$reqOrcUrl  = Get-EnvValue $EnvFile "ORCHESTRATOR_URL"
$reqApiKey  = Get-EnvValue $EnvFile "ANTHROPIC_API_KEY"

if (-not $reqAgentId)  { $missingFields += "AGENT_ID" }
if (-not $reqOrcUrl)   { $missingFields += "ORCHESTRATOR_URL" }
if (-not $reqApiKey)   { $missingFields += "ANTHROPIC_API_KEY" }

if ($missingFields.Count -gt 0) {
  Write-Host ""
  Write-Warn "Missing required .env values: $($missingFields -join ', ')"
  Write-Host ""
  Write-Host "  Edit the file and fill in the missing values:" -ForegroundColor White
  Write-Host "  notepad $EnvFile" -ForegroundColor White
  Write-Host ""
  Write-Host "  Then re-run bootstrap:" -ForegroundColor White
  Write-Host "  .\scripts\bootstrap.ps1" -ForegroundColor White
  Write-Host ""
  exit 1
}

Write-OK ".env configured"

# --- Step 11: Validate environment --------------------------------------------

Write-Step 11 "Validating environment"
node (Join-Path $ScriptDir "validate-env.js") --base-only

# --- Step 12: Register with orchestrator --------------------------------------

Write-Step 12 "Registering with orchestrator"
node (Join-Path $ScriptDir "register-agent.js")

# --- Step 13: Start with PM2 --------------------------------------------------

Write-Step 13 "Starting agent client via PM2"
pm2 delete agentOS-client 2>$null | Out-Null
pm2 start (Join-Path $ProjectDir "ecosystem.config.js") --only agentOS-client
pm2 save
Write-OK "Agent client started"

# --- Done ---------------------------------------------------------------------

$finalAgentId = Get-EnvValue $EnvFile "AGENT_ID"

Write-Host ""
Write-Header "Bootstrap Complete"
Write-Host ""
Write-Host "  Agent '$finalAgentId' is now online." -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard: http://<orchestrator-ip>:3000" -ForegroundColor White
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor White
Write-Host "    pm2 status                     - check agent status"
Write-Host "    pm2 logs agentOS-client        - view live logs"
Write-Host "    pm2 restart agentOS-client     - restart agent"
Write-Host "    node scripts/validate-env.js   - check all tools"
Write-Host "    node scripts/install-tool.js blender  - add a tool"
Write-Host ""
