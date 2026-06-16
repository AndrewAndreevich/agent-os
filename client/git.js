const { execSync } = require('child_process');
const reporter = require('./reporter');

// Thin wrapper over git CLI plus a GitHub PR helper. All commands run in
// the agent's workspace directory.

function workspace() {
  return process.env.WORKSPACE_PATH || process.cwd();
}

function sh(cmd) {
  return execSync(cmd, { cwd: workspace(), stdio: 'pipe' }).toString().trim();
}

function setup() {
  const name = process.env.GIT_USERNAME || process.env.AGENT_ID || 'agent';
  const email = process.env.GIT_EMAIL || `${name}@agentos.local`;
  sh(`git config user.name "${name}"`);
  sh(`git config user.email "${email}"`);
  return { name, email };
}

function createBranch(taskId, stageName) {
  const id = process.env.AGENT_ID || 'agent';
  const branch = `agent-${id}/${taskId}-${stageName}`;
  try {
    sh(`git checkout -b ${branch}`);
  } catch {
    // Branch may already exist; switch to it.
    sh(`git checkout ${branch}`);
  }
  return branch;
}

function commitAll(message) {
  sh(`git add -A`);
  reporter.workflowEvent('committing', {});

  // Count staged files before committing (the set that the commit will include).
  let filesChanged = 0;
  try {
    filesChanged = sh(`git diff --cached --name-only`).split('\n').filter(Boolean).length;
  } catch {
    /* ignore */
  }

  try {
    const out = sh(`git commit -m ${JSON.stringify(message)}`);
    let hash = '';
    try {
      hash = sh(`git rev-parse HEAD`);
    } catch {
      /* ignore */
    }
    reporter.workflowEvent('committed', { hash, files_changed: filesChanged });
    return out;
  } catch (err) {
    return `nothing to commit: ${err.message}`;
  }
}

function currentBranch() {
  return sh(`git rev-parse --abbrev-ref HEAD`);
}

function push() {
  const branch = currentBranch();
  const out = sh(`git push origin ${branch}`);
  reporter.workflowEvent('pushed', { branch });
  return out;
}

async function createPR(title, body) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    throw new Error('GITHUB_REPO and GITHUB_TOKEN required to create PR');
  }
  const branch = currentBranch();
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, body, head: branch, base: 'main' })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub PR failed ${res.status}: ${text}`);
  }
  const pr = await res.json();
  reporter.workflowEvent('pr_created', { url: pr.html_url });
  return pr;
}

module.exports = { setup, createBranch, commitAll, push, createPR, currentBranch };
