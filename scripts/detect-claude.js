#!/usr/bin/env node
// Detects claude CLI path and saves CLAUDE_PATH to .env
// Usage: node scripts/detect-claude.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '../.env');
const isWindows = process.platform === 'win32';

function detectClaudePath() {
  // Try where/which first
  try {
    const cmd = isWindows ? 'where claude' : 'which claude';
    const result = execSync(cmd, { stdio: 'pipe', timeout: 5000, shell: true })
      .toString().trim().split('\n')[0].trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}

  // Try bare command
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000, shell: true });
    return 'claude';
  } catch {}

  // Windows candidates — env vars only
  if (isWindows) {
    const candidates = [
      path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.ps1')
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  }

  // Linux/Mac candidates
  if (!isWindows) {
    const candidates = [
      path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
      path.join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/homebrew/bin/claude'
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  }

  return null;
}

function saveToEnv(claudePath) {
  if (!fs.existsSync(envFile)) {
    console.log('[WARN] .env not found at', envFile);
    return false;
  }
  let content = fs.readFileSync(envFile, 'utf8');
  if (content.match(/^CLAUDE_PATH=.*/m)) {
    content = content.replace(/^CLAUDE_PATH=.*/m, `CLAUDE_PATH=${claudePath}`);
  } else {
    content = content.trimEnd() + `\nCLAUDE_PATH=${claudePath}\n`;
  }
  fs.writeFileSync(envFile, content);
  return true;
}

console.log('\n=== Claude CLI Path Detection ===\n');
const detected = detectClaudePath();

if (!detected) {
  console.log('[FAIL] claude not found. Install: npm install -g @anthropic-ai/claude-code');
  process.exit(1);
}

try {
  const ver = execSync(`"${detected}" --version`, { stdio: 'pipe', timeout: 5000, shell: true }).toString().trim();
  console.log(`[OK] ${detected}`);
  console.log(`[OK] ${ver}`);
} catch {
  console.log(`[WARN] found at ${detected} but --version failed`);
}

if (saveToEnv(detected)) {
  console.log(`[OK] CLAUDE_PATH saved to .env`);
} else {
  console.log(`[INFO] Add manually: CLAUDE_PATH=${detected}`);
}

console.log('\nDone.\n');
process.exit(0);
