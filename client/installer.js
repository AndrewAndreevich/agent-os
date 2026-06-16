const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Receives an install script from the orchestrator, writes it to a temp
// file, executes it, and streams output back over the connection.
class Installer {
  constructor(connection, agentId) {
    this.connection = connection;
    this.agentId = agentId;
  }

  receive(toolName, script) {
    const isWin = process.platform === 'win32';
    const ext = isWin ? '.cmd' : '.sh';
    const file = path.join(os.tmpdir(), `agentos-install-${toolName}-${process.pid}${ext}`);
    fs.writeFileSync(file, script, { mode: 0o755 });

    const cmd = isWin ? 'cmd' : 'bash';
    const args = isWin ? ['/c', file] : [file];
    const child = spawn(cmd, args, { shell: false });

    const stream = (data) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        this.connection.send({
          type: 'INSTALL_PROGRESS',
          agent_id: this.agentId,
          tool: toolName,
          log_line: line
        });
      }
    };

    child.stdout.on('data', stream);
    child.stderr.on('data', stream);

    child.on('exit', (code) => {
      this.connection.send({
        type: 'INSTALL_DONE',
        agent_id: this.agentId,
        tool: toolName,
        success: code === 0
      });
      fs.unlink(file, () => {});
    });

    child.on('error', (err) => {
      this.connection.send({
        type: 'INSTALL_PROGRESS',
        agent_id: this.agentId,
        tool: toolName,
        log_line: `error: ${err.message}`
      });
      this.connection.send({
        type: 'INSTALL_DONE',
        agent_id: this.agentId,
        tool: toolName,
        success: false
      });
    });
  }
}

module.exports = Installer;
