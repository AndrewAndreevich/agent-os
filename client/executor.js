'use strict';

const { spawn } = require('child_process');
const { CLAUDE_PATH } = require('../shared/claude-path');

// Runs a task by spawning the claude CLI with persistent-session flags.
// First turn: --print --session-id <uuid> --system-prompt <role>
// Later turns: --print --resume <uuid>
function run(task, rolePrompt, onChunk, onDone, onError) {
  const sessionId = task.session_id;
  const isFirst = !task.resumed;
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
  if (isFirst) {
    args.push('--session-id', sessionId);
    if (rolePrompt) args.push('--system-prompt', rolePrompt);
  } else {
    args.push('--resume', sessionId);
  }
  args.push(buildTaskPrompt(task));

  const proc = spawn(CLAUDE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true });
  let out = '', buf = '';

  proc.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') { out += obj.delta.text; if (onChunk) onChunk(obj.delta.text); }
        if (obj.type === 'result' && obj.result && !out) { out = obj.result; if (onChunk) onChunk(obj.result); }
      } catch { out += line + '\n'; if (onChunk) onChunk(line + '\n'); }
    }
  });

  proc.stderr.on('data', chunk => { if (chunk.toString().toLowerCase().includes('error')) console.error('[executor]', chunk.toString().slice(0, 200)); });
  proc.on('close', code => { if (code !== 0 && !out) { if (onError) onError(`claude exited ${code}`); return; } if (onDone) onDone({ output: out, session_id: sessionId }); });
  proc.on('error', e => { if (onError) onError(e.message); });
  return proc;
}

function buildTaskPrompt(task) {
  const parts = [`TASK: ${task.title || task.id}`];
  if (task.contract) parts.push(`CONTRACT:\n${JSON.stringify(task.contract, null, 2)}`);
  if (task.description) parts.push(`DESCRIPTION: ${task.description}`);
  if (task.qa_artifact_path) parts.push(`OUTPUT: ${task.qa_artifact_path}`);
  if (task.qa_expected_output) parts.push(`DONE WHEN: ${task.qa_expected_output}`);
  if (task.feedback) parts.push(`QA FEEDBACK (fix this):\n${task.feedback}`);
  if (task.paths) parts.push(`PATHS:\n${JSON.stringify(task.paths, null, 2)}`);
  return parts.join('\n\n');
}

module.exports = { run, buildTaskPrompt };
