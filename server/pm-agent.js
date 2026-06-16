'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const youtrack = require('./youtrack');
const { CLAUDE_PATH, CLAUDE_AVAILABLE } = require('../shared/claude-path');

// PM system prompt
function getPMSystemPrompt() {
  const rolePath = path.join(__dirname, '../client/roles/pm.md');
  if (fs.existsSync(rolePath)) return fs.readFileSync(rolePath, 'utf8');
  return PM_DEFAULT_PROMPT;
}

const PM_DEFAULT_PROMPT = `You are a PM agent in a distributed AI development network.

Your job:
1. Receive a Service Definition from the user
2. Decompose it into waves where each wave contains independent services
3. For each service define exact contracts: input, output, done_when, qa_check_type
4. Present the wave plan and wait for user approval
5. After approval create YouTrack issues
6. After each wave completes plan the next wave

Rules:
- Always present wave plan BEFORE creating issues
- Wait for explicit approval (yes / approve / go / ok)
- Each service must have exact file paths
- done_when must be specific and testable
- required_capabilities must be from: base, blender, unity, comfyui, dotnet, playwright, qgis
- Never write implementation code

When presenting a wave plan use EXACTLY this format:

WAVE_PLAN_START
wave: 1
services:
  - id: service_id
    title: Short title
    description: What this does
    input: exact input paths
    output: exact output paths
    done_when: specific testable criteria
    required_capabilities: [base]
    qa_check_type: file_exists
    qa_artifact_path: ./pipeline/service_id/output.ext
    qa_expected_output: success criteria
WAVE_PLAN_END

When ready to create issues after approval:

CREATE_ISSUES_START
wave: 1
issues:
  - summary: Issue title
    description: Full description
    qa_check_type: file_exists
    qa_artifact_path: ./pipeline/service_id/output.ext
    qa_expected_output: success criteria
    required_capabilities: base
CREATE_ISSUES_END`;

// Conversations
function createConversation(title) {
  const id = randomUUID();
  const sessionId = randomUUID();
  const now = Date.now();
  db.prepare(
    'INSERT INTO pm_conversations (id, title, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title, sessionId, now, now);
  return getConversation(id);
}

function getConversation(id) {
  const c = db.prepare('SELECT * FROM pm_conversations WHERE id = ?').get(id);
  if (!c) return null;
  return { ...c, youtrack_issues: JSON.parse(c.youtrack_issues || '[]') };
}

function listConversations() {
  return db.prepare('SELECT * FROM pm_conversations ORDER BY updated_at DESC').all()
    .map(c => ({ ...c, youtrack_issues: JSON.parse(c.youtrack_issues || '[]') }));
}

function getConversationWithMessages(id) {
  const conv = getConversation(id);
  if (!conv) return null;
  const messages = db.prepare(
    'SELECT * FROM pm_messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id).map(m => ({ ...m, meta: JSON.parse(m.meta || '{}') }));
  return { ...conv, messages };
}

function deleteConversation(id) {
  db.prepare('DELETE FROM pm_messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM pm_conversations WHERE id = ?').run(id);
}

function saveMessage(conversationId, role, content, meta = {}) {
  db.prepare(
    'INSERT INTO pm_messages (conversation_id, role, content, created_at, meta) VALUES (?, ?, ?, ?, ?)'
  ).run(conversationId, role, content, Date.now(), JSON.stringify(meta));
  db.prepare('UPDATE pm_conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId);
}

function updateConversationTitle(id, title) {
  db.prepare('UPDATE pm_conversations SET title = ? WHERE id = ?').run(title, id);
}

// Parsing
function parseWavePlan(text) {
  const match = text.match(/WAVE_PLAN_START([\s\S]*?)WAVE_PLAN_END/);
  if (!match) return null;
  try {
    const block = match[1].trim();
    const wave = parseInt((block.match(/wave:\s*(\d+)/) || [, 1])[1]);
    const services = [];
    block.split(/\n\s+-\s+id:/).slice(1).forEach(part => {
      const lines = part.split('\n');
      const get = k => {
        const l = lines.find(l => l.trim().startsWith(k + ':'));
        return l ? l.replace(new RegExp(`^\\s*${k}:\\s*`), '').trim() : '';
      };
      const getCaps = p => {
        const m = p.match(/required_capabilities:\s*\[([^\]]+)\]/);
        if (m) return m[1].split(',').map(s => s.trim());
        const l = p.split('\n').find(l => l.includes('required_capabilities:'));
        return l ? l.replace(/.*required_capabilities:\s*/, '').split(',').map(s => s.trim()) : ['base'];
      };
      services.push({
        id: lines[0].trim(),
        title: get('title'), description: get('description'),
        input: get('input'), output: get('output'), done_when: get('done_when'),
        required_capabilities: getCaps(part),
        qa_check_type: get('qa_check_type'),
        qa_artifact_path: get('qa_artifact_path'),
        qa_expected_output: get('qa_expected_output')
      });
    });
    return { wave, services };
  } catch (e) {
    console.error('[pm-agent] parse wave plan error:', e.message);
    return null;
  }
}

function parseCreateIssues(text) {
  const match = text.match(/CREATE_ISSUES_START([\s\S]*?)CREATE_ISSUES_END/);
  if (!match) return null;
  try {
    const block = match[1].trim();
    const wave = parseInt((block.match(/wave:\s*(\d+)/) || [, 1])[1]);
    const issues = [];
    block.split(/\n\s+-\s+summary:/).slice(1).forEach(part => {
      const lines = part.split('\n');
      const get = k => {
        const l = lines.find(l => l.trim().startsWith(k + ':'));
        return l ? l.replace(new RegExp(`^\\s*${k}:\\s*`), '').trim() : '';
      };
      issues.push({
        summary: lines[0].trim(),
        description: get('description'),
        qa_check_type: get('qa_check_type'),
        qa_artifact_path: get('qa_artifact_path'),
        qa_expected_output: get('qa_expected_output'),
        required_capabilities: get('required_capabilities') || 'base'
      });
    });
    return { wave, issues };
  } catch (e) {
    console.error('[pm-agent] parse issues error:', e.message);
    return null;
  }
}

// YouTrack
async function createIssuesInYouTrack(conversationId, plan) {
  const created = [];
  for (const issue of plan.issues) {
    try {
      const id = await youtrack.createIssue(
        issue.summary,
        [issue.description, `Wave: ${plan.wave}`, `QA: ${issue.qa_check_type}`, `Path: ${issue.qa_artifact_path}`].join('\n'),
        [issue.required_capabilities], issue.qa_check_type,
        issue.qa_artifact_path, issue.qa_expected_output
      );
      if (id) { created.push(id); console.log(`[pm-agent] created ${id}: ${issue.summary}`); }
    } catch (e) { console.error(`[pm-agent] issue create failed: ${e.message}`); }
  }
  if (created.length) {
    const conv = db.prepare('SELECT youtrack_issues FROM pm_conversations WHERE id = ?').get(conversationId);
    const existing = JSON.parse(conv?.youtrack_issues || '[]');
    db.prepare('UPDATE pm_conversations SET youtrack_issues = ?, current_wave = ? WHERE id = ?')
      .run(JSON.stringify([...existing, ...created]), plan.wave, conversationId);
  }
  return created;
}

// Send message — uses CLAUDE_PATH
function sendMessage({ conversationId, conversationTitle, message, onChunk, onDone, onError }) {
  if (!CLAUDE_AVAILABLE) {
    onError(`claude CLI not available at "${CLAUDE_PATH}". Run: node scripts/detect-claude.js`);
    return null;
  }

  let conv = conversationId ? getConversation(conversationId) : null;
  if (!conv) conv = createConversation(conversationTitle || message.slice(0, 60).replace(/\n/g, ' '));

  const isFirst = db.prepare(
    'SELECT COUNT(*) as n FROM pm_messages WHERE conversation_id = ?'
  ).get(conv.id).n === 0;

  saveMessage(conv.id, 'user', message);

  const os = require('os');
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
  let tmpPromptFile = null;
  if (isFirst) {
    args.push('--session-id', conv.session_id);
    // Write system prompt to a temp file to avoid shell escaping issues on Windows
    tmpPromptFile = path.join(os.tmpdir(), `pm-prompt-${randomUUID()}.txt`);
    fs.writeFileSync(tmpPromptFile, getPMSystemPrompt(), 'utf8');
    args.push('--system-prompt-file', tmpPromptFile);
  } else {
    args.push('--resume', conv.session_id);
  }
  args.push(message);

  console.log(`[pm-agent] conv=${conv.id} session=${conv.session_id} first=${isFirst} path=${CLAUDE_PATH}`);

  const proc = spawn(CLAUDE_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true
  });

  // Clean up temp file after process starts
  if (tmpPromptFile) {
    setTimeout(() => { try { fs.unlinkSync(tmpPromptFile); } catch {} }, 5000);
  }

  let fullResponse = '';
  let buf = '';

  proc.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
          fullResponse += obj.delta.text;
          onChunk(obj.delta.text);
        } else if (obj.type === 'result' && obj.result && !fullResponse) {
          fullResponse = obj.result;
          onChunk(obj.result);
        }
      } catch {
        fullResponse += line + '\n';
        onChunk(line + '\n');
      }
    }
  });

  proc.stdout.on('end', () => {
    if (buf.trim()) {
      try {
        const obj = JSON.parse(buf);
        if (obj.type === 'result' && obj.result && !fullResponse) {
          fullResponse = obj.result; onChunk(obj.result);
        }
      } catch { if (buf.trim()) { fullResponse += buf; onChunk(buf); } }
    }
  });

  proc.stderr.on('data', chunk => {
    const t = chunk.toString();
    if (t.toLowerCase().includes('error')) console.error('[pm-agent stderr]', t.slice(0, 200));
  });

  proc.on('close', async code => {
    if (code !== 0 && !fullResponse) { onError(`claude exited ${code} with no output`); return; }
    const wavePlan = parseWavePlan(fullResponse);
    const createIssues = parseCreateIssues(fullResponse);
    const meta = {};
    if (wavePlan) meta.wave_plan = wavePlan;
    if (createIssues) meta.create_issues = createIssues;
    saveMessage(conv.id, 'assistant', fullResponse, meta);
    let created = [];
    if (createIssues) {
      try { created = await createIssuesInYouTrack(conv.id, createIssues); } catch {}
    }
    onDone({ conversation_id: conv.id, session_id: conv.session_id, response: fullResponse, wave_plan: wavePlan, created_issues: created });
  });

  proc.on('error', e => onError(`spawn error: ${e.message}`));
  return conv.id;
}

async function approveWavePlan(conversationId, wavePlan) {
  return createIssuesInYouTrack(conversationId, {
    wave: wavePlan.wave,
    issues: wavePlan.services.map(s => ({
      summary: s.title || s.id,
      description: `${s.description}\nInput: ${s.input}\nOutput: ${s.output}\nDone when: ${s.done_when}`,
      qa_check_type: s.qa_check_type || 'file_exists',
      qa_artifact_path: s.qa_artifact_path || '',
      qa_expected_output: s.qa_expected_output || '',
      required_capabilities: Array.isArray(s.required_capabilities)
        ? s.required_capabilities.join(',') : (s.required_capabilities || 'base')
    }))
  });
}

function checkClaudeCLI() { return CLAUDE_AVAILABLE; }

module.exports = {
  checkClaudeCLI, createConversation, getConversation,
  getConversationWithMessages, listConversations,
  deleteConversation, updateConversationTitle,
  sendMessage, approveWavePlan, parseWavePlan, parseCreateIssues
};
