'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { messageLimiter, searchLimiter } = require('../middleware/rateLimit');
const {
  sendMessageSchema,
  editMessageSchema,
  reactionSchema,
  markReadSchema,
} = require('../utils/schemas');
const { errors } = require('../utils/errors');
const messages = require('../services/messages');
const conversations = require('../services/conversations');
const config = require('../config');

const listQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  q: z.string().trim().max(100).optional(),
});
const pinSchema = z.object({ pinned: z.boolean() });

function createMessagesRouter(db) {
  const router = express.Router();
  const requireAuth = authenticate(db, config);
  router.use(['/conversations', '/messages'], requireAuth);

  router.get(
    '/conversations/:conversationId/messages',
    validate(listQuerySchema, 'query'),
    (req, res) => {
      const { before, limit, q } = req.validated.query;
      res.json(messages.listMessages(db, req.params.conversationId, req.user.id, { before, limit, query: q }));
    },
  );

  router.post(
    '/conversations/:conversationId/messages',
    messageLimiter,
    validate(sendMessageSchema),
    (req, res) => {
      const message = messages.createMessage(
        db,
        req.params.conversationId,
        req.user.id,
        req.body,
      );
      res.status(201).json({ message });
    },
  );

  router.post(
    '/conversations/:conversationId/read',
    validate(markReadSchema),
    (req, res) => {
      const result = conversations.markRead(
        db,
        req.params.conversationId,
        req.user.id,
        req.body.messageId,
      );
      res.json(result);
    },
  );

  router.get('/conversations/:conversationId/pins', (req, res) => {
    res.json({ messages: messages.listPinned(db, req.params.conversationId, req.user.id) });
  });

  router.get(
    '/conversations/:conversationId/search',
    searchLimiter,
    validate(listQuerySchema, 'query'),
    (req, res) => {
      if (!req.validated.query.q) throw errors.badRequest('O termo de busca é obrigatório', 'QUERY_REQUIRED');
      res.json(
        messages.listMessages(db, req.params.conversationId, req.user.id, {
          before: req.validated.query.before,
          limit: req.validated.query.limit,
          query: req.validated.query.q,
        }),
      );
    },
  );

  router.patch('/messages/:messageId', validate(editMessageSchema), (req, res) => {
    res.json({
      message: messages.editMessage(db, req.params.messageId, req.user.id, req.body.content),
    });
  });

  router.delete('/messages/:messageId', (req, res) => {
    res.json(messages.deleteMessage(db, req.params.messageId, req.user.id));
  });

  router.post('/messages/:messageId/reactions', validate(reactionSchema), (req, res) => {
    res.json({
      message: messages.toggleReaction(db, req.params.messageId, req.user.id, req.body.emoji),
    });
  });

  router.post('/messages/:messageId/pin', validate(pinSchema), (req, res) => {
    res.json({
      message: messages.togglePin(db, req.params.messageId, req.user.id, req.body.pinned),
    });
  });

  return router;
}

module.exports = { createMessagesRouter };
