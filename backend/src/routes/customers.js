'use strict';

const express = require('express');
const {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require('../db/customers');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { type, subtype, potential, status } = req.query;
    res.json(await listCustomers(req.userId, { type, subtype, potential, status }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const customer = await getCustomer(req.userId, req.params.id);
    if (!customer) return res.status(404).json({ error: 'مشتری پیدا نشد.' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).json(await createCustomer(req.userId, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const customer = await updateCustomer(req.userId, req.params.id, req.body || {});
    if (!customer) return res.status(404).json({ error: 'مشتری پیدا نشد.' });
    res.json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteCustomer(req.userId, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
