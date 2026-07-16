'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '7d';

function signToken(userId) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET تنظیم نشده است.');
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET تنظیم نشده است.');
  const payload = jwt.verify(token, JWT_SECRET); // throws on invalid/expired
  return payload.sub; // userId
}

module.exports = { signToken, verifyToken };
