// Inbox chats: list all conversations for a source, and manually override a
// chat's category label. Mounted behind requireAuth (acts on req.userId).
'use strict';

const express = require('express');
const { listChats, setChatRole } = require('../db/chats');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await listChats(req.userId, { source: req.query.source }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/role', async (req, res) => {
  try {
    const { role } = req.body || {};
    const chat = await setChatRole(req.userId, req.params.id, role);
    if (!chat) return res.status(404).json({ error: 'چت پیدا نشد.' });
    res.json(chat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
