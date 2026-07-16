// Extracts and verifies the JWT from `Authorization: Bearer <token>`, then
// sets req.userId. Every route that touches one tenant's data (WhatsApp
// connection, leads, listings...) must sit behind this — never trust a
// userId read from the URL or request body, since that would let anyone who
// knows/guesses another tenant's id read or control their account.
'use strict';

const { verifyToken } = require('./jwt');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'نیاز به ورود دارید (Authorization header یافت نشد).' });
  }

  try {
    req.userId = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'توکن نامعتبر یا منقضی‌شده است.' });
  }
}

module.exports = { requireAuth };
