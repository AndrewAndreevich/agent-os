#!/usr/bin/env node
// Registers this machine with the AgentOS orchestrator
// Auto-detects installed tools unless CAPABILITIES is set in .env

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const WebSocket = require('ws');
const { execSync } = require('child_process');
const os = require('os');
const tools = require('../installer/tools');

const url = process.env.ORCHESTRATOR_URL;
const agentId = process.env.AGENT_ID;
const role = process.env.AGENT_ROLE || 'dev';
const capabilitiesEnv = process.env.CAPABILITIES;

if (!url) { console.log('[FAIL] ORCHESTRATOR_URL not set in .env'); process.exit(1); }
if (!agentId) { console.log('[FAIL] AGENT_ID not set in .env'); process.exit(1); }

const isWindows = process.platform === 'win32';

function detectCapabilities() {
  if (capabilitiesEnv) {
    return capabilitiesEnv.split(',').map(c => c.trim()).filter(Boolean);
  }

  const caps = ['base'];
  tools.extended.forEach(tool => {
    const cmd = isWindows && tool.check_cmd_windows ? tool.check_cmd_windows : tool.check_cmd;
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 5000, shell: true });
      if (tool.capability) {
        caps.push(tool.capability);
        console.log(`  [detected] ${tool.capability}`);
      }
    } catch {}
  });
  return caps;
}

function getMachineIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of (interfaces[name] || [])) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

console.log('\n=== AgentOS Registration ===');
console.log('Detecting capabilities...');
const capabilities = detectCapabilities();
const machineIP = getMachineIP();

console.log(`\nAgent ID:      ${agentId}`);
console.log(`Role:          ${role}`);
console.log(`Capabilities:  ${capabilities.join(', ')}`);
console.log(`Machine IP:    ${machineIP}`);
console.log(`Orchestrator:  ${url}`);
console.log('');

let ws;
let registered = false;
let attempt = 0;
const maxAttempts = 3;

function connect() {
  attempt++;
  console.log(`Connecting... (attempt ${attempt}/${maxAttempts})`);

  ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'REGISTER', agent_id: agentId, role, capabilities, machine_ip: machineIP }));
  });

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'REGISTERED') {
        console.log(`[OK] Registered as ${agentId}`);
        registered = true;
        ws.close();
        process.exit(0);
      }
    } catch {}
  });

  ws.on('error', e => {
    console.log(`[FAIL] ${e.message.slice(0, 80)}`);
    if (attempt < maxAttempts) {
      console.log('Retrying in 3 seconds...');
      setTimeout(connect, 3000);
    } else {
      console.log('\nCould not reach orchestrator after 3 attempts.');
      console.log('Check ORCHESTRATOR_URL in .env and make sure the server is running.');
      process.exit(1);
    }
  });

  ws.on('close', () => {
    if (!registered && attempt >= maxAttempts) {
      console.log('[FAIL] Connection closed without REGISTERED response.');
      process.exit(1);
    }
  });

  setTimeout(() => {
    if (!registered) {
      console.log('[FAIL] Timeout waiting for REGISTERED.');
      ws.terminate();
      if (attempt < maxAttempts) connect();
      else process.exit(1);
    }
  }, 10000);
}

connect();
