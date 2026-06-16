#!/usr/bin/env node
// Removes a capability from this agent's registration
// Does NOT uninstall the software from the machine
// Usage: node uninstall-tool.js <capability-name>

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const WebSocket = require('ws');

const capability = process.argv[2];
if (!capability) {
  console.log('Usage: node uninstall-tool.js <capability-name>');
  console.log('Example: node uninstall-tool.js blender');
  process.exit(1);
}

const url = process.env.ORCHESTRATOR_URL;
const agentId = process.env.AGENT_ID;

if (!url || !agentId) {
  console.log('[FAIL] ORCHESTRATOR_URL and AGENT_ID must be set in .env');
  process.exit(1);
}

console.log(`Removing capability '${capability}' from agent ${agentId}...`);

const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'REMOVE_CAPABILITY', agent_id: agentId, capability }));
  setTimeout(() => { ws.close(); console.log('[OK] Done'); process.exit(0); }, 1000);
});
ws.on('error', e => {
  console.log(`[FAIL] Could not connect: ${e.message}`);
  process.exit(1);
});
