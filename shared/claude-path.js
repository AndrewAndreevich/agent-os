'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '../.env'), override: false });
} catch {}

function resolveClaudePath() {
  // 1. CLAUDE_PATH env var set by bootstrap
  if (process.env.CLAUDE_PATH) {
    const p = process.env.CLAUDE_PATH;
    if (fs.existsSync(p)) return p;
    console.warn(`[claude-path] CLAUDE_PATH="${p}" not found — falling back`);
  }

  // 2. Try bare 'claude' in PATH
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000, shell: true });
    return 'claude';
  } catch {}

  // 3. Windows — use env vars only, never hardcode usernames
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.ps1'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'claude.cmd')
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        console.log(`[claude-path] found at: ${c}`);
        return c;
      }
    }

    // Try where.exe
    try {
      const whereOut = execSync('where claude', { stdio: 'pipe', timeout: 5000, shell: true })
        .toString().trim().split('\n')[0].trim();
      if (whereOut && fs.existsSync(whereOut)) return whereOut;
    } catch {}
  }

  // 4. Linux/Mac
  if (process.platform !== 'win32') {
    const candidates = [
      path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
      path.join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/homebrew/bin/claude'
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        console.log(`[claude-path] found at: ${c}`);
        return c;
      }
    }

    try {
      const whichOut = execSync('which claude', { stdio: 'pipe', timeout: 5000 })
        .toString().trim();
      if (whichOut && fs.existsSync(whichOut)) return whichOut;
    } catch {}
  }

  console.warn('[claude-path] not found in known locations — using bare "claude"');
  return 'claude';
}

function verifyClaudeCLI(claudePath) {
  const cmds = [`"${claudePath}" --version`, `${claudePath} --version`];
  for (const cmd of cmds) {
    try {
      return execSync(cmd, { stdio: 'pipe', timeout: 5000, shell: true }).toString().trim();
    } catch {}
  }
  return null;
}

const CLAUDE_PATH = resolveClaudePath();
const CLAUDE_AVAILABLE = verifyClaudeCLI(CLAUDE_PATH) !== null;

module.exports = { CLAUDE_PATH, CLAUDE_AVAILABLE, resolveClaudePath, verifyClaudeCLI };
