'use strict';
const express = require('express');
const router = express.Router();
const pm = require('../pm-agent');
const registry = require('../registry');

router.get('/status', (req, res) => res.json({
  claude_available: pm.checkClaudeCLI(),
  conversations_count: pm.listConversations().length
}));

router.get('/conversations', (req, res) => res.json(pm.listConversations()));

router.get('/conversations/:id', (req, res) => {
  const c = pm.getConversationWithMessages(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

router.patch('/conversations/:id', (req, res) => {
  if (req.body.title) pm.updateConversationTitle(req.params.id, req.body.title);
  res.json({ ok: true });
});

router.delete('/conversations/:id', (req, res) => {
  pm.deleteConversation(req.params.id);
  res.json({ ok: true });
});

router.post('/message', (req, res) => {
  const { conversation_id, conversation_title, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });
  if (!pm.checkClaudeCLI()) return res.status(503).json({ error: 'claude CLI not available — run: node scripts/detect-claude.js' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = d => { res.write(`data: ${JSON.stringify(d)}\n\n`); if (res.flush) res.flush(); };

  pm.sendMessage({
    conversationId: conversation_id,
    conversationTitle: conversation_title,
    message,
    onChunk: text => send({ type: 'chunk', text }),
    onDone: result => {
      registry.broadcastToUI({ type: 'PM_MESSAGE_DONE', ...result });
      send({ type: 'done', ...result });
      res.end();
    },
    onError: err => { send({ type: 'error', error: err }); res.end(); }
  });
});

router.post('/approve', async (req, res) => {
  const { conversation_id, wave_plan } = req.body;
  if (!conversation_id || !wave_plan) return res.status(400).json({ error: 'missing params' });
  try {
    const created = await pm.approveWavePlan(conversation_id, wave_plan);
    registry.broadcastToUI({ type: 'WAVE_APPROVED', conversation_id, wave: wave_plan.wave, created_issues: created });
    res.json({ ok: true, created_issues: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
