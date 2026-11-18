'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { serializeNotification } = require('../services/users');
const { errors } = require('../utils/errors');
const { now } = require('../utils/helpers');
const config = require('../config');

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

function createNotificationsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/', validate(listSchema, 'query'), (req, res) => {
    const rows = db
      .prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(req.user.id, req.validated.query.limit);
    const unread = db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id).count;
    res.json({
      notifications: rows.map(serializeNotification),
      unreadCount: unread,
    });
  });

  router.get('/unread-count', (req, res) => {
    const unread = db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id).count;
    res.json({ unreadCount: unread });
  });

  router.post('/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(
      now(),
      req.user.id,
    );
    res.json({ ok: true });
  });

  router.post('/:notificationId/read', (req, res) => {
    const row = db
      .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
      .get(req.params.notificationId, req.user.id);
    if (!row) throw errors.notFound('Notificação não encontrada', 'NOTIFICATION_NOT_FOUND');
    if (!row.read_at) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now(), row.id);
    }
    res.json({
      notification: serializeNotification(
        db.prepare('SELECT * FROM notifications WHERE id = ?').get(row.id),
      ),
    });
  });

  router.delete('/:notificationId', (req, res) => {
    db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(
      req.params.notificationId,
      req.user.id,
    );
    res.json({ ok: true });
  });

  router.delete('/', (req, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createNotificationsRouter };
