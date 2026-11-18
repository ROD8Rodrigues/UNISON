'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  dmSchema,
  groupSchema,
  updateConversationSchema,
} = require('../utils/schemas');
const { errors } = require('../utils/errors');
const { now } = require('../utils/helpers');
const conversations = require('../services/conversations');
const { createSystemMessage } = require('../services/messages');
const { emitToUsers } = require('../realtime/bus');
const config = require('../config');

const memberSchema = z.object({ userId: z.string().uuid() });
const muteSchema = z.object({ muted: z.boolean() });

function createConversationsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    res.json({ conversations: conversations.listConversations(db, req.user.id) });
  });

  router.post('/dm', validate(dmSchema), (req, res) => {
    res.json(conversations.createDm(db, req.user.id, req.body.userId));
  });

  router.post('/group', validate(groupSchema), (req, res) => {
    const result = conversations.createGroup(db, req.user.id, req.body);
    const message = createSystemMessage(
      db,
      result.conversation.id,
      `${req.user.display_name} criou o grupo "${req.body.title}"`,
    );
    res.status(201).json({ conversation: result.conversation, message });
  });

  router.get('/:conversationId', (req, res) => {
    const { conversation } = conversations.assertAccess(db, req.params.conversationId, req.user.id);
    res.json({
      conversation: conversations.serializeConversation(db, conversation, req.user.id),
    });
  });

  router.patch('/:conversationId', validate(updateConversationSchema), (req, res) => {
    res.json({
      conversation: conversations.updateConversation(
        db,
        req.params.conversationId,
        req.user.id,
        req.body,
      ),
    });
  });

  router.post('/:conversationId/members', validate(memberSchema), (req, res) => {
    const conversation = conversations.addMember(
      db,
      req.params.conversationId,
      req.user.id,
      req.body.userId,
    );
    const added = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.body.userId);
    createSystemMessage(
      db,
      conversation.id,
      `${req.user.display_name} adicionou ${added?.display_name || 'um membro'}`,
    );
    res.json({ conversation });
  });

  router.delete('/:conversationId/members/:userId', (req, res) => {
    conversations.removeMember(
      db,
      req.params.conversationId,
      req.user.id,
      req.params.userId,
    );
    res.json({ ok: true });
  });

  router.post('/:conversationId/leave', (req, res) => {
    const { conversation } = conversations.assertAccess(
      db,
      req.params.conversationId,
      req.user.id,
    );
    if (conversation.type === 'dm') {
      db.prepare(
        'UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND user_id = ?',
      ).run(conversation.id, req.user.id);
      emitToUsers([req.user.id], 'conversation:hidden', { conversationId: conversation.id });
      return res.json({ ok: true, hidden: true });
    }
    if (conversation.type === 'channel') {
      throw errors.badRequest('Saia do espaço para sair dos canais dele', 'CHANNEL_LEAVE_VIA_SPACE');
    }
    const members = conversations.listMembers(db, conversation.id);
    if (conversation.owner_id === req.user.id) {
      const successor = members.find((member) => member.user_id !== req.user.id);
      if (successor) {
        db.prepare("UPDATE conversations SET owner_id = ?, updated_at = ? WHERE id = ?").run(
          successor.user_id,
          now(),
          conversation.id,
        );
        db.prepare(
          "UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?",
        ).run(conversation.id, successor.user_id);
        db.prepare(
          "UPDATE conversation_members SET role = 'member' WHERE conversation_id = ? AND user_id = ?",
        ).run(conversation.id, req.user.id);
      }
    }
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
      conversation.id,
      req.user.id,
    );
    const remaining = conversations.listMembers(db, conversation.id).map((member) => member.user_id);
    if (remaining.length === 0) {
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id);
    } else {
      createSystemMessage(db, conversation.id, `${req.user.display_name} saiu do grupo`);
    }
    emitToUsers([req.user.id], 'conversation:removed', { conversationId: conversation.id });
    emitToUsers(remaining, 'conversation:member-removed', {
      conversationId: conversation.id,
      userId: req.user.id,
    });
    res.json({ ok: true });
  });

  router.post('/:conversationId/hide', (req, res) => {
    const { conversation } = conversations.assertAccess(
      db,
      req.params.conversationId,
      req.user.id,
    );
    if (conversation.type === 'channel') {
      throw errors.badRequest('Canais não podem ser ocultados', 'CHANNEL_HIDE');
    }
    db.prepare(
      'UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND user_id = ?',
    ).run(conversation.id, req.user.id);
    emitToUsers([req.user.id], 'conversation:hidden', { conversationId: conversation.id });
    res.json({ ok: true });
  });

  router.patch('/:conversationId/mute', validate(muteSchema), (req, res) => {
    const { conversation } = conversations.assertAccess(
      db,
      req.params.conversationId,
      req.user.id,
    );
    db.prepare(
      'UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?',
    ).run(req.body.muted ? 1 : 0, conversation.id, req.user.id);
    res.json({ muted: req.body.muted });
  });

  return router;
}

module.exports = { createConversationsRouter };
