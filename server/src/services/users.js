'use strict';

const { now, iso, safeJson } = require('../utils/helpers');

function getUserRow(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getSettingsRow(db, userId) {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
}

function serializeSettings(row) {
  if (!row) return null;
  return {
    theme: row.theme,
    accent: row.accent,
    compactMode: Boolean(row.compact_mode),
    reduceMotion: Boolean(row.reduce_motion),
    desktopNotifications: Boolean(row.desktop_notifications),
    notificationSounds: Boolean(row.notification_sounds),
    messagePreviews: Boolean(row.message_previews),
    privacyLastSeen: row.privacy_last_seen,
    privacyReadReceipts: Boolean(row.privacy_read_receipts),
    privacyTyping: Boolean(row.privacy_typing),
  };
}

/**
 * Public representation of a user. Never includes password hashes or refresh
 * material. Email is only included for the authenticated user.
 */
function serializeUser(row, options = {}) {
  if (!row) return null;
  const { self = false, friend = false, includeEmail = false, settings = null } = options;
  let lastSeen = iso(row.last_seen);
  if (!self && lastSeen && row.privacy_last_seen) {
    const visibility = row.privacy_last_seen;
    if (visibility === 'nobody' || (visibility === 'friends' && !friend)) lastSeen = null;
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || '',
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    customStatus: row.custom_status || '',
    presence: row.presence || 'offline',
    lastSeen,
    emailVerified: Boolean(row.email_verified),
    createdAt: iso(row.created_at),
    ...(self || includeEmail ? { email: row.email } : {}),
    ...(self && settings ? { settings: serializeSettings(settings) } : {}),
  };
}

const PUBLIC_USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
         u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
         COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
  FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
`;

function getPublicUser(db, userId) {
  return db.prepare(`${PUBLIC_USER_SELECT} WHERE u.id = ?`).get(userId);
}

function getPublicUserByUsername(db, username) {
  return db.prepare(`${PUBLIC_USER_SELECT} WHERE u.username = ? COLLATE NOCASE`).get(username);
}

function isFriend(db, userId, otherId) {
  return Boolean(
    db
      .prepare('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?')
      .get(userId, otherId),
  );
}

function areBlockedEitherWay(db, a, b) {
  return Boolean(
    db
      .prepare(
        'SELECT 1 AS ok FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      )
      .get(a, b, b, a),
  );
}

function getNotificationRow(db, notificationId, userId) {
  return db
    .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
    .get(notificationId, userId);
}

function serializeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: safeJson(row.data, {}),
    readAt: iso(row.read_at),
    createdAt: iso(row.created_at),
  };
}

function createNotification(db, { userId, type, title, body = '', data = {} }) {
  const id = require('crypto').randomUUID();
  const createdAt = now();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, type, title, body, JSON.stringify(data), createdAt);
  return serializeNotification(getNotificationRow(db, id, userId));
}

module.exports = {
  getUserRow,
  getSettingsRow,
  serializeUser,
  serializeSettings,
  getPublicUser,
  getPublicUserByUsername,
  isFriend,
  areBlockedEitherWay,
  getNotificationRow,
  serializeNotification,
  createNotification,
  PUBLIC_USER_SELECT,
};
