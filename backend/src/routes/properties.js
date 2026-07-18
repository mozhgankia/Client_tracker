'use strict';

const express = require('express');
const {
  listProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
} = require('../db/properties');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { category, sub_category: subCategory, delivery_status: deliveryStatus } = req.query;
    res.json(
      await listProperties(req.userId, { category, sub_category: subCategory, delivery_status: deliveryStatus })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const property = await getProperty(req.userId, req.params.id);
    if (!property) return res.status(404).json({ error: 'ملک پیدا نشد.' });
    res.json(property);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).json(await createProperty(req.userId, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const property = await updateProperty(req.userId, req.params.id, req.body || {});
    if (!property) return res.status(404).json({ error: 'ملک پیدا نشد.' });
    res.json(property);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteProperty(req.userId, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
