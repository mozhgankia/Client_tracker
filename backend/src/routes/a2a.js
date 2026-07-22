// Agent-to-Agent (colleague market) endpoints. A2A listings and colleague
// clients are the group-context leads the AI pulled from colleague chats; this
// router exposes them with advanced filtering plus the two-way matching search.
'use strict';

const express = require('express');
const { listGroupLeads, getLead } = require('../db/leads');
const { listProperties } = require('../db/properties');
const {
  matchListings,
  normalizeOwnProperty,
  normalizeA2aLead,
  normalizeType,
  includesLoose,
} = require('../a2a/match');

const router = express.Router();

const num = (v) => (v === undefined || v === '' ? null : Number(v));

// Property-Finder-style advanced filters over A2A listings (owner group-leads).
function applyFilters(leads, q) {
  const type = normalizeType(q.request_type);
  const minP = num(q.min_price);
  const maxP = num(q.max_price);
  const minA = num(q.min_area);
  const maxA = num(q.max_area);
  const beds = num(q.bedrooms);
  return leads.filter((l) => {
    if (type && normalizeType(l.request_type) && normalizeType(l.request_type) !== type) return false;
    if (q.region && !includesLoose(l.region, q.region)) return false;
    if (minP != null && (l.listed_price == null || l.listed_price < minP)) return false;
    if (maxP != null && (l.listed_price == null || l.listed_price > maxP)) return false;
    if (minA != null && (l.area_sqft == null || l.area_sqft < minA)) return false;
    if (maxA != null && (l.area_sqft == null || l.area_sqft > maxA)) return false;
    if (beds != null && (l.bedrooms == null || l.bedrooms !== beds)) return false;
    return true;
  });
}

// Colleague property listings (A2A) with advanced filters.
router.get('/properties', async (req, res) => {
  try {
    const leads = await listGroupLeads(req.userId, 'owner');
    res.json(applyFilters(leads, req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Colleague clients (a colleague announced their client's requirement).
router.get('/clients', async (req, res) => {
  try {
    res.json(await listGroupLeads(req.userId, 'client'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A colleague client → matches from MY OWN properties only (so I can see what I
// have to offer that colleague's client).
router.get('/clients/:id/matches', async (req, res) => {
  try {
    const lead = await getLead(req.userId, req.params.id);
    if (!lead) return res.status(404).json({ error: 'مشتری همکار پیدا نشد.' });
    const need = { request_type: lead.request_type, region: lead.region, max_price: lead.listed_price };
    const own = await listProperties(req.userId, {});
    res.json({ need, matches: matchListings(need, own, normalizeOwnProperty) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Two-way search for a personal client: find offers from 'own' or 'a2a'.
// Body/query: { source: 'own'|'a2a', request_type, region, max_price }
router.post('/match', async (req, res) => {
  try {
    const { source = 'own', request_type, region, max_price } = req.body || {};
    const need = { request_type, region, max_price: max_price === '' ? null : max_price };
    if (source === 'a2a') {
      const leads = await listGroupLeads(req.userId, 'owner');
      return res.json({ source, matches: matchListings(need, leads, normalizeA2aLead) });
    }
    const own = await listProperties(req.userId, {});
    res.json({ source: 'own', matches: matchListings(need, own, normalizeOwnProperty) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
