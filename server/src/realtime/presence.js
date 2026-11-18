'use strict';

const { now } = require('../utils/helpers');
const { emitToUsers } = require('./bus');

const connections = new Map(); // userId -> Set<socketId>
const manualPresence = new Map(); // userId -> 'online' | 'away' | 'dnd' | 'offline'

function audienceFor(db, userId) {
  const rows = db
    .prepare(
      `SELECT friend_id AS id FROM friendships WHERE user_id = ?
       UNION
       SELECT cm2.user_id AS id FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id <> ?
       UNION
       SELECT sm2.user_id AS id FROM space_members sm1
       JOIN space_members sm2 ON sm2.space_id = sm1.space_id
       WHERE sm1.user_id = ? AND sm2.user_id <> ?`,
    )
    .all(userId, userId, userId, userId, userId);
  return new Set([...rows.map((row) => row.id), userId]);
}

function broadcastPresence(db, userId, presence) {
  const audience = audienceFor(db, userId);
  const user = db.prepare('SELECT last_seen FROM users WHERE id = ?').get(userId);
  emitToUsers([...audience], 'presence:update', {
    userId,
    presence,
    lastSeen: user?.last_seen ? new Date(user.last_seen).toISOString() : null,
  });
}

function connectionOpened(db, userId, socketId) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  const wasOffline = connections.get(userId).size === 0;
  connections.get(userId).add(socketId);
  if (wasOffline) {
    const presence = manualPresence.get(userId) || 'online';
    db.prepare('UPDATE users SET presence = ?, last_seen = ?, updated_at = ? WHERE id = ?').run(
      presence,
      now(),
      now(),
      userId,
    );
    broadcastPresence(db, userId, presence);
  }
}

function connectionClosed(db, userId, socketId) {
  const set = connections.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    connections.delete(userId);
    const timestamp = now();
    db.prepare('UPDATE users SET presence = ?, last_seen = ?, updated_at = ? WHERE id = ?').run(
      'offline',
      timestamp,
      timestamp,
      userId,
    );
    broadcastPresence(db, userId, 'offline');
    return true;
  }
  return false;
}

function setPresence(db, userId, presence) {
  if (presence === 'offline') manualPresence.delete(userId);
  else manualPresence.set(userId, presence);
  const timestamp = now();
  db.prepare('UPDATE users SET presence = ?, last_seen = ?, updated_at = ? WHERE id = ?').run(
    presence,
    timestamp,
    timestamp,
    userId,
  );
  broadcastPresence(db, userId, presence);
  return { presence, lastSeen: new Date(timestamp).toISOString() };
}

function isOnline(userId) {
  return connections.has(userId) && connections.get(userId).size > 0;
}

function onlineUserIds() {
  return [...connections.keys()];
}

module.exports = {
  audienceFor,
  connectionOpened,
  connectionClosed,
  setPresence,
  isOnline,
  onlineUserIds,
};
