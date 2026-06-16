const session = require('./session');
const reporter = require('./reporter');

async function run(task) {
  const config = session.getSelfcheckConfig();

  if (!config.enabled) {
    console.log('[selfcheck] disabled for this agent — skipping');
    return { pass: true, skipped: true };
  }

  let attempts = 0;
  const maxAttempts = config.max_attempts || 2;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`[selfcheck] attempt ${attempts}/${maxAttempts}`);
    reporter.workflowEvent('selfcheck_running', { attempt: attempts, max: maxAttempts });

    const result = await runCheck(task);

    if (result.pass) {
      console.log('[selfcheck] passed');
      reporter.workflowEvent('selfcheck_passed', { attempts });
      return { pass: true, attempts };
    }

    console.log(`[selfcheck] failed: ${result.reason}`);

    if (attempts >= maxAttempts) {
      console.log('[selfcheck] max attempts reached — forwarding to QA with notes');
      reporter.workflowEvent('selfcheck_escalated', { attempts, reason: result.reason });
      return { pass: false, attempts, reason: result.reason, escalated: true };
    }
  }
}

async function runCheck(task) {
  // existing check logic by qa_check_type
  const { qa_check_type, qa_artifact_path } = task;
  const { execSync } = require('child_process');

  try {
    if (qa_check_type === 'file_exists') {
      const fs = require('fs');
      if (!fs.existsSync(qa_artifact_path)) return { pass: false, reason: `file not found: ${qa_artifact_path}` };
      const stat = fs.statSync(qa_artifact_path);
      if (stat.size === 0) return { pass: false, reason: `file is empty: ${qa_artifact_path}` };
      return { pass: true };
    }

    if (qa_check_type === 'compile') {
      execSync(`python -m py_compile "${qa_artifact_path}"`, { stdio: 'pipe' });
      return { pass: true };
    }

    if (qa_check_type === 'run_script') {
      execSync(`python "${qa_artifact_path}"`, { stdio: 'pipe', timeout: 30000 });
      return { pass: true };
    }

    return { pass: true }; // unknown type — pass through to QA
  } catch (e) {
    return { pass: false, reason: e.message };
  }
}

module.exports = { run };
