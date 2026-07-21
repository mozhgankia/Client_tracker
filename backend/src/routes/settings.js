// Per-tenant settings. Currently just the classifier's editable keyword lists,
// but kept as its own resource so more settings can be added later.
'use strict';

const express = require('express');
const { getSettings, updateSettings } = require('../db/settings');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getSettings(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { owner_keywords, client_keywords } = req.body || {};
    if (owner_keywords !== undefined && !Array.isArray(owner_keywords)) {
      return res.status(400).json({ error: 'owner_keywords باید فهرست باشد.' });
    }
    if (client_keywords !== undefined && !Array.isArray(client_keywords)) {
      return res.status(400).json({ error: 'client_keywords باید فهرست باشد.' });
    }
    res.json(await updateSettings(req.userId, { owner_keywords, client_keywords }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
