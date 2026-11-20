'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimit');
const {
  updateProfileSchema,
  updateSettingsSchema,
  updatePresenceSchema,
  deleteAccountSchema,
} = require('../utils/schemas');
const { errors } = require('../utils/errors');
const { now, reservedUsernames } = require('../utils/helpers');
const {
  serializeUser,
  serializeSettings,
  getSettingsRow,
  isFriend,
} = require('../services/users');
const authService = require('../services/auth');
const presence = require('../realtime/presence');
const bus = require('../realtime/bus');
const config = require('../config');

const searchSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

function createUsersRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/me', (req, res) => {
    res.json({ user: serializeUser(req.user, { self: true, settings: req.settings }) });
  });

  router.patch('/me', validate(updateProfileSchema), (req, res) => {
    if (req.body.username !== undefined && req.body.username !== req.user.username) {
      if (reservedUsernames.has(req.body.username)) {
        throw errors.badRequest('Esse nome de usuário é reservado', 'USERNAME_RESERVED');
      }
      const taken = db
        .prepare('SELECT 1 AS ok FROM users WHERE username = ? COLLATE NOCASE AND id <> ?')
        .get(req.body.username, req.user.id);
      if (taken) throw errors.conflict('Esse nome de usuário já está em uso', 'USERNAME_TAKEN');
    }
    const fields = [];
    const values = [];
    const mapping = {
      displayName: 'display_name',
      username: 'username',
      bio: 'bio',
      customStatus: 'custom_status',
      avatarUrl: 'avatar_url',
      bannerUrl: 'banner_url',
    };
    for (const [key, column] of Object.entries(mapping)) {
      const value = req.body[key];
      if (value !== undefined) {
        fields.push(`${column} = ?`);
        values.push(value === '' && (key === 'avatarUrl' || key === 'bannerUrl') ? null : value);
      }
    }
    if (fields.length) {
      fields.push('updated_at = ?');
      values.push(now(), req.user.id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const settings = getSettingsRow(db, req.user.id);
    const serialized = serializeUser(user, { self: true, settings });
    const recipients = db
      .prepare(
        `SELECT user_id FROM conversation_members
         WHERE conversation_id IN (
           SELECT conversation_id FROM conversation_members WHERE user_id = ?
         )
         UNION SELECT friend_id AS user_id FROM friendships WHERE user_id = ?
         UNION SELECT user_id FROM friendships WHERE friend_id = ?
         UNION SELECT user_id FROM space_members
         WHERE space_id IN (SELECT space_id FROM space_members WHERE user_id = ?)`,
      )
      .all(req.user.id, req.user.id, req.user.id, req.user.id)
      .map((row) => row.user_id);
    // Profile pushes go to broad audiences, so never include lastSeen here.
    // That field is private and must be filtered per viewer by the API instead.
    const publicUser = serializeUser(user);
    delete publicUser.lastSeen;
    bus.emitToUsers([...recipients, req.user.id], 'user:updated', {
      user: publicUser,
    });
    res.json({ user: serialized });
  });

  router.put('/me/settings', validate(updateSettingsSchema), (req, res) => {
    const mapping = {
      theme: 'theme',
      accent: 'accent',
      compactMode: 'compact_mode',
      reduceMotion: 'reduce_motion',
      desktopNotifications: 'desktop_notifications',
      notificationSounds: 'notification_sounds',
      messagePreviews: 'message_previews',
      privacyLastSeen: 'privacy_last_seen',
      privacyReadReceipts: 'privacy_read_receipts',
      privacyTyping: 'privacy_typing',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(mapping)) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }
    if (fields.length) {
      fields.push('updated_at = ?');
      values.push(now(), req.user.id);
      db.prepare(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    }
    res.json({ settings: serializeSettings(getSettingsRow(db, req.user.id)) });
  });

  router.post('/me/presence', validate(updatePresenceSchema), (req, res) => {
    const result = presence.setPresence(db, req.user.id, req.body.presence);
    res.json(result);
  });

  router.delete('/me', validate(deleteAccountSchema), async (req, res) => {
    const valid = await authService.verifyPassword(req.body.password, req.user.password_hash);
    if (!valid) throw errors.badRequest('Senha incorreta', 'INVALID_PASSWORD');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    authService.clearRefreshCookie(res, config);
    bus.disconnectUser(req.user.id);
    res.json({ ok: true });
  });

  router.get('/search', searchLimiter, validate(searchSchema, 'query'), (req, res) => {
    const { q, limit } = req.validated.query;
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
                u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
                COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
         FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
         WHERE u.id <> ?
           AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
             (b.user_id = ? AND b.blocked_id = u.id) OR (b.user_id = u.id AND b.blocked_id = ?))
         ORDER BY u.username COLLATE NOCASE
         LIMIT ?`,
      )
      .all(req.user.id, `%${q}%`, `%${q}%`, req.user.id, req.user.id, limit);
    res.json({
      users: rows.map((row) => serializeUser(row, { friend: isFriend(db, req.user.id, row.id) })),
    });
  });

  router.get('/:userId', (req, res) => {
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
                u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
                COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
         FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
         WHERE u.id = ?`,
      )
      .get(req.params.userId);
    if (!row) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
    const friend = isFriend(db, req.user.id, row.id);
    const blockedByMe = Boolean(
      db
        .prepare('SELECT 1 AS ok FROM blocks WHERE user_id = ? AND blocked_id = ?')
        .get(req.user.id, row.id),
    );
    const blockedMe = Boolean(
      db
        .prepare('SELECT 1 AS ok FROM blocks WHERE user_id = ? AND blocked_id = ?')
        .get(row.id, req.user.id),
    );
    const pending = db
      .prepare("SELECT * FROM friend_requests WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))")
      .get(req.user.id, row.id, row.id, req.user.id);
    res.json({
      user: serializeUser(row, { friend }),
      relationship: {
        friend,
        blockedByMe,
        canMessage: !blockedByMe && !blockedMe && row.id !== req.user.id,
        pendingRequest: pending
          ? { id: pending.id, direction: pending.from_user_id === req.user.id ? 'outgoing' : 'incoming' }
          : null,
      },
    });
  });

  return router;
}

module.exports = { createUsersRouter };
