#!/usr/bin/env bash
# AgentOS Bootstrap
# On Windows: run this from Git Bash — it calls bootstrap.ps1
# On Linux/Mac: runs natively

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Detect platform
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
  echo "Windows detected (Git Bash) — delegating to bootstrap.ps1"
  AGENT_ID="" ROLE="dev" ORCHESTRATOR_URL="" CAPABILITIES="base"

  for arg in "$@"; do
    case $arg in
      --agent-id=*) AGENT_ID="${arg#*=}" ;;
      --role=*) ROLE="${arg#*=}" ;;
      --orchestrator=*) ORCHESTRATOR_URL="${arg#*=}" ;;
      --capabilities=*) CAPABILITIES="${arg#*=}" ;;
    esac
  done

  powershell.exe -ExecutionPolicy RemoteSigned -File "$(cygpath -w "$SCRIPT_DIR/bootstrap.ps1")" \
    -AgentId "$AGENT_ID" \
    -Role "$ROLE" \
    -OrchestratorUrl "$ORCHESTRATOR_URL" \
    -Capabilities "$CAPABILITIES"
  exit $?
fi

# Linux / Mac path
OS="unknown"
[[ "$OSTYPE" == "linux-gnu"* ]] && OS="linux"
[[ "$OSTYPE" == "darwin"* ]] && OS="mac"

echo ""
echo "=== AgentOS Bootstrap ($OS) ==="
echo ""

# git
command -v git &>/dev/null || { [[ "$OS" == "linux" ]] && apt-get install -y git || brew install git; }
echo "[OK] git $(git --version)"

# node
command -v node &>/dev/null || {
  [[ "$OS" == "linux" ]] && { curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; apt-get install -y nodejs; }
  [[ "$OS" == "mac" ]] && brew install node@20
}
echo "[OK] node $(node --version)"

# python3
command -v python3 &>/dev/null || {
  [[ "$OS" == "linux" ]] && apt-get install -y python3.11 python3-pip
  [[ "$OS" == "mac" ]] && brew install python@3.11
}
echo "[OK] python3 $(python3 --version)"

# pm2
command -v pm2 &>/dev/null || npm install -g pm2
echo "[OK] pm2 $(pm2 --version)"

# claude-code
command -v claude &>/dev/null || npm install -g @anthropic-ai/claude-code
echo "[OK] claude-code"

cd "$PROJECT_DIR"
npm install

[[ ! -f ".env" ]] && cp .env.example .env
ENV_FILE=".env"

# Detect and save claude path
DETECTED_CLAUDE=""
command -v claude &>/dev/null && DETECTED_CLAUDE=$(which claude)
if [[ -z "$DETECTED_CLAUDE" ]]; then
  for c in "$HOME/.local/bin/claude" "$HOME/.npm-global/bin/claude" "/usr/local/bin/claude" "/usr/bin/claude" "/opt/homebrew/bin/claude"; do
    [[ -f "$c" ]] && DETECTED_CLAUDE="$c" && break
  done
fi
if [[ -n "$DETECTED_CLAUDE" ]]; then
  grep -q "^CLAUDE_PATH=" "$ENV_FILE" 2>/dev/null \
    && sed -i.bak "s|^CLAUDE_PATH=.*|CLAUDE_PATH=$DETECTED_CLAUDE|" "$ENV_FILE" && rm -f "$ENV_FILE.bak" \
    || echo "CLAUDE_PATH=$DETECTED_CLAUDE" >> "$ENV_FILE"
  echo "[OK] CLAUDE_PATH=$DETECTED_CLAUDE saved to .env"
else
  echo "[WARN] claude not found. Run: node scripts/detect-claude.js"
fi

node scripts/validate-env.js --base-only
node scripts/register-agent.js

pm2 delete agentOS-client 2>/dev/null || true
pm2 start ecosystem.config.js --only agentOS-client
pm2 save

echo ""
echo "[OK] Bootstrap complete"
echo ""
