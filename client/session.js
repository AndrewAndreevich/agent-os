const fs = require('fs');
const path = require('path');

// Holds the agent's current task and role, and assembles the full
// prompt handed to the executor.
class Session {
  constructor() {
    this.currentTask = null;
    this.currentRole = null;
    this.roleContent = '';
    this.selfcheckConfig = { enabled: true, max_attempts: 2, token_budget: 50000 };
  }

  setSelfcheckConfig(config) {
    this.selfcheckConfig = config || { enabled: true, max_attempts: 2, token_budget: 50000 };
  }

  getSelfcheckConfig() {
    return this.selfcheckConfig;
  }

  loadRole(roleName) {
    const file = path.join(__dirname, 'roles', `${roleName}.md`);
    try {
      this.roleContent = fs.readFileSync(file, 'utf8');
      this.currentRole = roleName;
    } catch (err) {
      console.error(`[session] could not load role ${roleName}:`, err.message);
      this.roleContent = `You are a ${roleName} agent.`;
      this.currentRole = roleName;
    }
    return this.roleContent;
  }

  setTask(taskData) {
    // Normalize an `id` alias so reporters/workflow events can use task.id
    // even though ASSIGN_TASK carries the id as `task_id`.
    if (taskData && taskData.id == null && taskData.task_id != null) {
      taskData.id = taskData.task_id;
    }
    this.currentTask = taskData;
    const role = taskData.role || process.env.AGENT_ROLE || 'dev';
    if (this.currentRole !== role || !this.roleContent) {
      this.loadRole(role);
    }
  }

  getPrompt() {
    if (!this.currentTask) return this.roleContent;
    const t = this.currentTask;
    const parts = [
      this.roleContent,
      '',
      '## Task',
      `ID: ${t.task_id}`,
      `Title: ${t.title || ''}`,
      '',
      '## Paths',
      JSON.stringify(t.paths || {}, null, 2),
      '',
      '## Contract',
      JSON.stringify(t.contract || {}, null, 2)
    ];
    if (t.feedback) {
      parts.push('', '## QA Feedback (fix exactly this)', t.feedback);
    }
    return parts.join('\n');
  }

  clear() {
    this.currentTask = null;
  }
}

module.exports = new Session();
