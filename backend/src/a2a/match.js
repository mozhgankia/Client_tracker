// Matching logic for the two-way search:
//   * a personal/colleague client's need  →  matching property listings
// Works over both "own" properties (properties table) and "A2A" listings
// (group leads with role=owner), by normalizing each into a common shape.
'use strict';

// buy/sell/sale collapse to 'sale'; rent/mortgage to 'rent'.
function normalizeType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (['rent', 'mortgage', 'اجاره', 'رهن'].includes(s)) return 'rent';
  if (['buy', 'sell', 'sale', 'خرید', 'فروش'].includes(s)) return 'sale';
  return null;
}

function includesLoose(hay, needle) {
  if (!needle) return true; // no region constraint
  if (!hay) return false;
  const h = String(hay).toLowerCase();
  const n = String(needle).toLowerCase();
  return h.includes(n) || n.includes(h);
}

// A single listing → { type, region, price } regardless of its origin.
function normalizeOwnProperty(p) {
  return {
    type: p.sub_category === 'rent' ? 'rent' : 'sale',
    region: p.location,
    price: p.price,
  };
}
function normalizeA2aLead(l) {
  return { type: normalizeType(l.request_type), region: l.region, price: l.listed_price };
}

/**
 * @param {{request_type?:string, region?:string, max_price?:number}} need
 * @param {Array} listings raw rows
 * @param {(row:any)=>{type:?string,region:?string,price:?number}} normalize
 * @param {number} [priceTolerance=0.15] how much over budget is still a match
 * @returns {Array} the subset of listings that match the need
 */
function matchListings(need, listings, normalize, priceTolerance = 0.15) {
  const wantType = normalizeType(need.request_type);
  const budget = need.max_price != null ? Number(need.max_price) : null;
  return listings.filter((row) => {
    const n = normalize(row);
    if (wantType && n.type && n.type !== wantType) return false;
    if (need.region && !includesLoose(n.region, need.region)) return false;
    if (budget != null && n.price != null && Number(n.price) > budget * (1 + priceTolerance)) return false;
    return true;
  });
}

module.exports = { matchListings, normalizeOwnProperty, normalizeA2aLead, normalizeType, includesLoose };
