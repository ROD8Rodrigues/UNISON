'use strict';

const rateLimit = require('express-rate-limit').rateLimit;
const config = require('../config');

function makeLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    },
  });
}

const generalLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 240,
  message: 'Muitas requisições. Aguarde um pouco e tente novamente.',
});

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  message: 'Muitas tentativas de autenticação. Tente novamente em alguns minutos.',
});

const verificationResendLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  message: 'Muitos pedidos de verificação. Aguarde alguns minutos antes de tentar novamente.',
});

const messageLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 90,
  message: 'Você está enviando mensagens rápido demais.',
});

const uploadLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: 'Limite de upload atingido. Tente novamente mais tarde.',
});

const searchLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  message: 'Muitas buscas. Tente novamente em instantes.',
});

module.exports = {
  generalLimiter,
  authLimiter,
  verificationResendLimiter,
  messageLimiter,
  uploadLimiter,
  searchLimiter,
};
