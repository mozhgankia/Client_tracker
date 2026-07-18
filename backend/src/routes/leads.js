// Leads are read-mostly from the dashboard's perspective: list what the AI
// pipeline found, then either dismiss it or convert it into a real customer
// or property record. There's no generic PATCH/POST for arbitrary lead
// fields — leads are machine-extracted, not hand-edited.
'use strict';

const express = require('express');
const {
  listLeads,
  getLead,
  updateLeadStatus,
  deleteLead,
  convertLeadToCustomer,
  convertLeadToProperty,
} = require('../db/leads');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { status, source } = req.query;
    res.json(await listLeads(req.userId, { status, source }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const lead = await getLead(req.userId, req.params.id);
    if (!lead) return res.status(404).json({ error: 'لید پیدا نشد.' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    const lead = await updateLeadStatus(req.userId, req.params.id, 'dismissed');
    if (!lead) return res.status(404).json({ error: 'لید پیدا نشد.' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/convert-to-customer', async (req, res) => {
  try {
    res.status(201).json(await convertLeadToCustomer(req.userId, req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/convert-to-property', async (req, res) => {
  try {
    res.status(201).json(await convertLeadToProperty(req.userId, req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteLead(req.userId, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
