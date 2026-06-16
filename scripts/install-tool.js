#!/usr/bin/env node
// Installs a single tool by name using winget (Windows) or apt/brew
// Usage: node install-tool.js <tool-name>

const { execSync } = require('child_process');
const path = require('path');
const tools = require('../installer/tools');

const toolName = process.argv[2];
if (!toolName) {
  console.log('Usage: node install-tool.js <tool-name>');
  const all = [...tools.base, ...tools.extended];
  console.log('Available tools:', all.map(t => t.name).join(', '));
  process.exit(1);
}

const all = [...tools.base, ...tools.extended];
const tool = all.find(t => t.name === toolName);
if (!tool) {
  console.log(`Unknown tool: ${toolName}`);
  console.log('Available:', all.map(t => t.name).join(', '));
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const os = isWindows ? 'windows' : isMac ? 'mac' : 'linux';

const installCmd = tool.install?.[os];
if (!installCmd) {
  console.log(`No install command for ${toolName} on ${os}`);
  process.exit(1);
}

// On Windows check winget is available
if (isWindows && installCmd.startsWith('winget')) {
  try {
    execSync('winget --version', { stdio: 'pipe' });
  } catch {
    console.log('winget is not available on this system.');
    console.log('Install App Installer from Microsoft Store, or install manually:');
    console.log(`  ${toolName}: https://winget.run/${toolName}`);
    process.exit(1);
  }
}

console.log(`\n=== Installing ${toolName} on ${os} ===`);
console.log(`Command: ${installCmd}\n`);

try {
  execSync(installCmd, { stdio: 'inherit', timeout: 300000, shell: true });
  console.log(`\n[OK] ${toolName} installed`);

  // Refresh PATH on Windows
  if (isWindows) {
    const machinePath = execSync(
      'powershell -Command "[System.Environment]::GetEnvironmentVariable(\'PATH\',\'Machine\')"',
      { stdio: 'pipe' }
    ).toString().trim();
    const userPath = execSync(
      'powershell -Command "[System.Environment]::GetEnvironmentVariable(\'PATH\',\'User\')"',
      { stdio: 'pipe' }
    ).toString().trim();
    process.env.PATH = machinePath + ';' + userPath;
    console.log('[OK] PATH refreshed in current session');
  }

  // Post-install
  if (tool.post_install?.[os]) {
    console.log(`\nRunning post-install...`);
    try {
      if (isWindows && tool.post_install[os].startsWith('$env:')) {
        // PowerShell command — run via powershell
        execSync(`powershell -Command "${tool.post_install[os]}"`, { stdio: 'inherit', timeout: 30000 });
      } else {
        execSync(tool.post_install[os], { stdio: 'inherit', timeout: 60000, shell: true });
      }
    } catch (e) {
      console.log(`[WARN] Post-install warning (non-fatal): ${e.message.slice(0, 100)}`);
    }
  }

  // Windows notes
  if (isWindows && tool.notes_windows) {
    console.log(`\n[NOTE] ${tool.notes_windows}`);
  }

  // Verify
  console.log(`\nVerifying ${toolName}...`);
  const checkCmd = isWindows && tool.check_cmd_windows ? tool.check_cmd_windows : tool.check_cmd;
  try {
    const out = execSync(checkCmd, { stdio: 'pipe', timeout: 10000, shell: true }).toString().trim();
    console.log(`[OK] Verified: ${out.slice(0, 80)}`);
    process.exit(0);
  } catch {
    console.log(`[WARN] Installed but not yet in PATH.`);
    if (isWindows) {
      console.log('Restart PowerShell or open a new terminal window and try again.');
      if (tool.path_hint?.windows) {
        console.log(`Add to PATH manually: ${tool.path_hint.windows}`);
      }
    }
    process.exit(0);
  }

} catch (e) {
  console.log(`\n[FAIL] Installation failed: ${e.message.slice(0, 200)}`);
  if (isWindows) {
    console.log('\nTroubleshooting:');
    console.log('1. Run PowerShell as Administrator');
    console.log('2. Check winget: winget --version');
    console.log('3. Try manual install from: https://winget.run');
  }
  process.exit(1);
}
