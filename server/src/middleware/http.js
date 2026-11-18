'use strict';

const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

function requestContext(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user ? req.user.id : undefined,
    });
  });
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  next();
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next(); // Native clients and same-origin form posts may omit Origin.
  try {
    const host = new URL(origin).host;
    const target = req.get('host');
    if (host === target) return next();
    if (config.corsOrigins.includes(origin)) return next();
  } catch {
    // fall through
  }
  res.status(403).json({ error: { code: 'BAD_ORIGIN', message: 'Origem não permitida' } });
}

module.exports = { requestContext, securityHeaders, sameOrigin };
