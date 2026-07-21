// The intelligent classification board: contacts (leads) grouped into
// owners / clients / unknown, with an AI-suggestion step for the unknowns
// that the user can accept or reject.
'use strict';

const express = require('express');
const { listActiveLeads, setLeadRole, getLead } = require('../db/leads');
const { suggestRole } = require('../classify/suggestRole');

const router = express.Router();

// Grouped view for the board.
router.get('/', async (req, res) => {
  try {
    const leads = await listActiveLeads(req.userId);
    const groups = { owners: [], clients: [], unknown: [] };
    for (const lead of leads) {
      if (lead.role === 'owner') groups.owners.push(lead);
      else if (lead.role === 'client') groups.clients.push(lead);
      else groups.unknown.push(lead);
    }
    res.json({
      groups,
      counts: {
        owners: groups.owners.length,
        clients: groups.clients.length,
        unknown: groups.unknown.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ask the AI to suggest a category for one unknown contact.
router.post('/:id/suggest', async (req, res) => {
  try {
    const lead = await getLead(req.userId, req.params.id);
    if (!lead) return res.status(404).json({ error: 'لید پیدا نشد.' });
    const suggestion = await suggestRole(lead.raw_message || '', { senderName: lead.sender_name });
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept a suggestion / manually set a contact's category.
router.post('/:id/role', async (req, res) => {
  try {
    const { role } = req.body || {};
    const lead = await setLeadRole(req.userId, req.params.id, role);
    if (!lead) return res.status(404).json({ error: 'لید پیدا نشد.' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
