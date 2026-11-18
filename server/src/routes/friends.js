'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { friendRequestSchema } = require('../utils/schemas');
const { errors } = require('../utils/errors');
const { id, now, transaction } = require('../utils/helpers');
const {
  serializeUser,
  isFriend,
  getPublicUser,
  getPublicUserByUsername,
  createNotification,
} = require('../services/users');
const { emitToUsers } = require('../realtime/bus');
const config = require('../config');

const uuidSchema = z.string().uuid();

function requireUuid(value) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw errors.badRequest('Identificador inválido', 'INVALID_ID');
  return parsed.data;
}

function createFriendsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const friendIds = db
      .prepare('SELECT friend_id FROM friendships WHERE user_id = ?')
      .all(req.user.id)
      .map((row) => row.friend_id);
    if (friendIds.length === 0) return res.json({ friends: [] });
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
                u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
                COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
         FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
         WHERE u.id IN (${friendIds.map(() => '?').join(',')})
         ORDER BY u.presence = 'offline' ASC, u.display_name COLLATE NOCASE`,
      )
      .all(...friendIds);
    res.json({ friends: rows.map((row) => serializeUser(row, { friend: true })) });
  });

  router.get('/requests', (req, res) => {
    const incoming = db
      .prepare(
        `SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending'
         ORDER BY created_at DESC`,
      )
      .all(req.user.id);
    const outgoing = db
      .prepare(
        `SELECT * FROM friend_requests WHERE from_user_id = ? AND status = 'pending'
         ORDER BY created_at DESC`,
      )
      .all(req.user.id);
    const decorate = (row, direction) => {
      const sender = getPublicUser(db, row.from_user_id);
      const receiver = getPublicUser(db, row.to_user_id);
      return {
        id: row.id,
        direction,
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
        sender: serializeUser(sender),
        receiver: serializeUser(receiver),
      };
    };
    res.json({
      incoming: incoming.map((row) => decorate(row, 'incoming')),
      outgoing: outgoing.map((row) => decorate(row, 'outgoing')),
    });
  });

  router.post('/requests', validate(friendRequestSchema), (req, res) => {
    const target = getPublicUserByUsername(db, req.body.username);
    if (!target) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
    if (target.id === req.user.id) {
      throw errors.badRequest('Você não pode adicionar a si mesmo', 'SELF_REQUEST');
    }
    const blocked = db
      .prepare(
        'SELECT 1 AS ok FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      )
      .get(req.user.id, target.id, target.id, req.user.id);
    if (blocked) throw errors.forbidden('Pedido de amizade indisponível', 'BLOCKED');
    if (isFriend(db, req.user.id, target.id)) {
      throw errors.conflict('Vocês já são amigos', 'ALREADY_FRIENDS');
    }
    const existing = db
      .prepare(
        `SELECT * FROM friend_requests WHERE status = 'pending' AND
         ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      )
      .get(req.user.id, target.id, target.id, req.user.id);
    if (existing) {
      if (existing.from_user_id === target.id) {
        throw errors.conflict('Este usuário já enviou uma solicitação para você', 'REQUEST_INCOMING');
      }
      throw errors.conflict('Pedido de amizade já enviado', 'REQUEST_PENDING');
    }
    const requestId = id();
    db.prepare(
      "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    ).run(requestId, req.user.id, target.id, now());
    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
    const payload = {
      id: requestId,
      direction: 'outgoing',
      status: 'pending',
      createdAt: new Date(row.created_at).toISOString(),
      sender: serializeUser(req.user),
      receiver: serializeUser(target),
    };
    emitToUsers([target.id], 'friend:request', {
      request: { ...payload, direction: 'incoming' },
    });
    emitToUsers([req.user.id], 'friend:request', { request: payload });
    const notification = createNotification(db, {
      userId: target.id,
      type: 'friend_request',
      title: `${req.user.display_name} quer ser seu amigo`,
      body: `@${req.user.username}`,
      data: { requestId, userId: req.user.id },
    });
    emitToUsers([target.id], 'notification:new', { notification });
    res.status(201).json({ request: payload });
  });

  router.post('/requests/:requestId/accept', (req, res) => {
    const requestId = requireUuid(req.params.requestId);
    const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
    if (!request || request.to_user_id !== req.user.id) {
      throw errors.notFound('Pedido de amizade não encontrado', 'REQUEST_NOT_FOUND');
    }
    if (request.status !== 'pending') {
      throw errors.badRequest('Esta solicitação não está mais pendente', 'REQUEST_NOT_PENDING');
    }
    const sender = getPublicUser(db, request.from_user_id);
    if (!sender) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
    const blocked = db
      .prepare(
        'SELECT 1 AS ok FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      )
      .get(req.user.id, sender.id, sender.id, req.user.id);
    if (blocked) throw errors.forbidden('Não é possível aceitar esta solicitação', 'BLOCKED');
    transaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(
        req.user.id,
        sender.id,
        now(),
      );
      db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(
        sender.id,
        req.user.id,
        now(),
      );
      db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?").run(
        now(),
        requestId,
      );
      db.prepare(
        "UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE status = 'pending' AND (from_user_id = ? AND to_user_id = ?)",
      ).run(now(), req.user.id, sender.id);
    });
    const friend = serializeUser(getPublicUser(db, sender.id), { friend: true });
    emitToUsers([req.user.id], 'friend:accepted', {
      friend: serializeUser(getPublicUser(db, sender.id), { friend: true }),
    });
    emitToUsers([sender.id], 'friend:accepted', {
      friend: serializeUser(getPublicUser(db, req.user.id), { friend: true }),
    });
    const notification = createNotification(db, {
      userId: sender.id,
      type: 'friend_accepted',
      title: `${req.user.display_name} aceitou seu pedido`,
      body: 'Vocês agora são amigos no UNISON.',
      data: { userId: req.user.id },
    });
    emitToUsers([sender.id], 'notification:new', { notification });
    res.json({ friend });
  });

  router.post('/requests/:requestId/reject', (req, res) => {
    const requestId = requireUuid(req.params.requestId);
    const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
    if (!request || request.to_user_id !== req.user.id) {
      throw errors.notFound('Pedido de amizade não encontrado', 'REQUEST_NOT_FOUND');
    }
    if (request.status !== 'pending') {
      throw errors.badRequest('Esta solicitação não está mais pendente', 'REQUEST_NOT_PENDING');
    }
    db.prepare("UPDATE friend_requests SET status = 'rejected', responded_at = ? WHERE id = ?").run(
      now(),
      requestId,
    );
    emitToUsers([request.from_user_id], 'friend:request-rejected', { requestId });
    emitToUsers([req.user.id], 'friend:request-rejected', { requestId });
    res.json({ ok: true });
  });

  router.delete('/:userId', (req, res) => {
    const friendId = requireUuid(req.params.userId);
    transaction(db, () => {
      db.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(
        req.user.id,
        friendId,
        friendId,
        req.user.id,
      );
      db.prepare(
        "UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
      ).run(now(), req.user.id, friendId, friendId, req.user.id);
    });
    emitToUsers([req.user.id], 'friend:removed', { userId: friendId });
    emitToUsers([friendId], 'friend:removed', { userId: req.user.id });
    res.json({ ok: true });
  });

  router.get('/blocks/list', (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
                u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
                COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
         FROM blocks b JOIN users u ON u.id = b.blocked_id
         LEFT JOIN user_settings us ON us.user_id = u.id
         WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ blockedUsers: rows.map((row) => serializeUser(row)) });
  });

  router.post('/blocks/:userId', (req, res) => {
    const targetId = requireUuid(req.params.userId);
    if (targetId === req.user.id) throw errors.badRequest('Você não pode bloquear a si mesmo');
    const target = getPublicUser(db, targetId);
    if (!target) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
    transaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
        req.user.id,
        targetId,
        now(),
      );
      db.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(
        req.user.id,
        targetId,
        targetId,
        req.user.id,
      );
      db.prepare(
        "UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
      ).run(now(), req.user.id, targetId, targetId, req.user.id);
    });
    emitToUsers([req.user.id], 'friend:removed', { userId: targetId });
    emitToUsers([targetId], 'friend:removed', { userId: req.user.id });
    emitToUsers([req.user.id], 'user:blocked', { userId: targetId });
    res.json({ ok: true });
  });

  router.delete('/blocks/:userId', (req, res) => {
    const targetId = requireUuid(req.params.userId);
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(req.user.id, targetId);
    emitToUsers([req.user.id], 'user:unblocked', { userId: targetId });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createFriendsRouter };
