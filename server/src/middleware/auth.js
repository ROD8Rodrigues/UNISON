'use strict';

const { resolveSessionUser } = require('../services/auth');
const { errors } = require('../utils/errors');

function extractToken(req) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function authenticate(db, config) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) return next(errors.unauthorized());
    try {
      const auth = resolveSessionUser(db, config, token);
      req.user = auth.user;
      req.settings = auth.settings;
      req.sessionId = auth.sessionId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function optionalAuth(db, config) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) return next();
    try {
      const auth = resolveSessionUser(db, config, token);
      req.user = auth.user;
      req.settings = auth.settings;
      req.sessionId = auth.sessionId;
    } catch {
      // Optional authentication silently ignores invalid credentials.
    }
    next();
  };
}

module.exports = { authenticate, optionalAuth, extractToken };
