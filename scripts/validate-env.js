#!/usr/bin/env node
// Validates all required tools are installed and in PATH
// Usage: node validate-env.js [--base-only] [--tool=name]

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { execSync } = require('child_process');
const path = require('path');
const tools = require('../installer/tools');

const args = process.argv.slice(2);
const baseOnly = args.includes('--base-only');
const specificTool = args.find(a => a.startsWith('--tool='))?.split('=')[1];

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const os = isWindows ? 'windows' : isMac ? 'mac' : 'linux';

function compareVersions(v1, v2) {
  const p1 = String(v1).split('.').map(Number);
  const p2 = String(v2).split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0, b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function tryExec(cmd) {
  try {
    return { ok: true, output: execSync(cmd, { stdio: 'pipe', timeout: 10000, shell: true }).toString().trim() };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 100) };
  }
}

function checkTool(tool) {
  // Pick correct check command for platform
  const cmd = isWindows && tool.check_cmd_windows
    ? tool.check_cmd_windows
    : (!isWindows && tool.check_cmd_linux)
      ? tool.check_cmd_linux
      : tool.check_cmd;

  let result = tryExec(cmd);

  // Fallback command if primary fails
  if (!result.ok && tool.check_cmd_fallback) {
    result = tryExec(tool.check_cmd_fallback);
  }

  // Try path_hint on Windows if command not in PATH
  if (!result.ok && isWindows && tool.path_hint?.windows) {
    const hintPath = tool.path_hint.windows.replace('%USERNAME%', process.env.USERNAME || '');
    const exeName = tool.name === 'python' ? 'python.exe' : `${tool.name}.exe`;
    const fullPath = path.join(hintPath, exeName);
    result = tryExec(`"${fullPath}" --version`);
    if (result.ok) {
      return {
        name: tool.name,
        status: 'WARN',
        message: `found at ${hintPath} but NOT in PATH — add to PATH`,
        hint: `Add to PATH: ${hintPath}`
      };
    }
  }

  if (!result.ok) {
    return { name: tool.name, status: 'FAIL', message: `not found — run: node scripts/install-tool.js ${tool.name}` };
  }

  const match = result.output.match(tool.check_regex);
  if (!match) {
    return { name: tool.name, status: 'WARN', message: `found but version undetected: ${result.output.slice(0, 50)}` };
  }

  const version = match[1];
  if (tool.min_version && compareVersions(version, tool.min_version) < 0) {
    return { name: tool.name, status: 'FAIL', message: `v${version} below minimum v${tool.min_version}` };
  }

  return { name: tool.name, status: 'PASS', version };
}

function main() {
  console.log('\n=== AgentOS Environment Validation ===');
  console.log(`Platform: ${process.platform} | OS bucket: ${os}`);
  if (isWindows) {
    const psResult = tryExec('powershell -Command "$PSVersionTable.PSVersion.Major"');
    console.log(`PowerShell version: ${psResult.ok ? psResult.output : 'unknown'}`);
  }
  console.log('');

  let toolsToCheck = [];
  if (specificTool) {
    const all = [...tools.base, ...tools.extended];
    const found = all.find(t => t.name === specificTool);
    if (!found) { console.log(`Unknown tool: ${specificTool}`); process.exit(1); }
    toolsToCheck = [found];
  } else if (baseOnly) {
    toolsToCheck = tools.base;
  } else {
    toolsToCheck = [...tools.base, ...tools.extended];
  }

  const results = toolsToCheck.map(checkTool);
  let passed = 0, failed = 0, warned = 0;

  results.forEach(r => {
    const icon = r.status === 'PASS' ? '[OK]' : r.status === 'WARN' ? '[WARN]' : '[FAIL]';
    const detail = r.version ? `v${r.version}` : r.message;
    console.log(`  ${icon.padEnd(7)} ${r.name.padEnd(16)} ${detail}`);
    if (r.hint) console.log(`           ${r.hint}`);
    if (r.status === 'PASS') passed++;
    else if (r.status === 'WARN') warned++;
    else failed++;
  });

  console.log('');
  console.log(`Results: ${passed} passed, ${warned} warned, ${failed} failed out of ${results.length}`);

  if (failed > 0) {
    console.log('\nTo install missing tools:');
    console.log('  node scripts/install-tool.js <tool-name>');
    console.log('  or run: .\\scripts\\bootstrap.ps1');
    process.exit(1);
  }

  if (warned > 0) {
    console.log('\nWarned tools are installed but not in PATH.');
    console.log('Add them to PATH or restart PowerShell after install.');
  }

  console.log('\n[OK] Environment ready\n');
  process.exit(0);
}

main();
