const WebSocket = require('ws');

// Resilient WebSocket connection to the orchestrator with auto-reconnect
// and an outbound queue that flushes once the socket is open.
class Connection {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = [];
    this.outbound = [];
    this.attempt = 0;
    this.connected = false;
    this.onOpenCb = null;
  }

  connect() {
    this.attempt += 1;
    console.log(`[connection] connecting to ${this.url} (attempt ${this.attempt})`);
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.connected = true;
      this.attempt = 0;
      console.log('[connection] connected');
      this.flush();
      if (this.onOpenCb) this.onOpenCb();
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.log('[connection] disconnected, retrying in 3s');
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (err) => {
      console.error('[connection] error:', err.message);
    });
  }

  onOpen(cb) {
    this.onOpenCb = cb;
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  send(message) {
    const payload = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.outbound.push(payload);
    }
  }

  flush() {
    while (this.outbound.length && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(this.outbound.shift());
    }
  }
}

module.exports = Connection;
