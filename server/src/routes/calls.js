'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const calls = require('../services/calls');
const { errors } = require('../utils/errors');
const config = require('../config');

function createCallsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    res.json({ calls: calls.historyForUser(db, req.user.id, limit) });
  });

  router.get('/:callId', (req, res) => {
    const call = calls.getCall(db, req.params.callId);
    if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
    const participant = db
      .prepare('SELECT 1 AS ok FROM call_participants WHERE call_id = ? AND user_id = ?')
      .get(call.id, req.user.id);
    if (!participant) throw errors.forbidden('Você não faz parte desta chamada', 'NOT_IN_CALL');
    res.json({ call: calls.serializeCall(db, call) });
  });

  return router;
}

module.exports = { createCallsRouter };
