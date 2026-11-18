'use strict';

const { id, now, dmKey, transaction, iso } = require('../utils/helpers');
const { errors } = require('../utils/errors');
const { areBlockedEitherWay, serializeUser } = require('./users');
const { emitToUsers } = require('../realtime/bus');

function getConversation(db, conversationId) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
}

function getMembership(db, conversationId, userId) {
  return db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

function assertAccess(db, conversationId, userId) {
  const conversation = getConversation(db, conversationId);
  if (!conversation) throw errors.notFound('Conversa não encontrada', 'CONVERSATION_NOT_FOUND');
  const membership = getMembership(db, conversationId, userId);
  if (!membership) throw errors.forbidden('Você não faz parte desta conversa', 'NOT_A_MEMBER');
  if (conversation.type === 'channel') {
    const inSpace = db
      .prepare('SELECT 1 AS ok FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(conversation.space_id, userId);
    if (!inSpace) throw errors.forbidden('Você não é membro deste espaço', 'NOT_A_MEMBER');
  }
  return { conversation, membership };
}

function listMembers(db, conversationId) {
  return db
    .prepare(
      `SELECT cm.role AS member_role, cm.joined_at AS member_joined_at, cm.last_read_at,
              cm.muted AS member_muted,
              u.*, u.id AS user_id, COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE cm.conversation_id = ?
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name COLLATE NOCASE`,
    )
    .all(conversationId);
}

function friendIdSet(db, userId) {
  return new Set(
    db
      .prepare('SELECT friend_id FROM friendships WHERE user_id = ?')
      .all(userId)
      .map((row) => row.friend_id),
  );
}

function unreadCount(db, conversationId, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL
         AND m.sender_id <> ? AND m.created_at > COALESCE(cm.last_read_at, 0)`,
    )
    .get(userId, conversationId, userId);
  return row ? row.count : 0;
}

function unreadMap(db, userId) {
  const rows = db
    .prepare(
      `SELECT m.conversation_id, COUNT(*) AS count FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       WHERE m.deleted_at IS NULL AND m.sender_id <> ?
         AND m.created_at > COALESCE(cm.last_read_at, 0)
       GROUP BY m.conversation_id`,
    )
    .all(userId, userId);
  return new Map(rows.map((row) => [row.conversation_id, row.count]));
}

function serializeConversation(db, row, viewerId, options = {}) {
  const members = options.members || listMembers(db, row.id);
  const friendIds = options.friendIds || friendIdSet(db, viewerId);
  const viewerMembership = members.find((member) => member.user_id === viewerId);
  const mappedMembers = members.map((member) => ({
    ...serializeUser(member, { friend: friendIds.has(member.user_id) }),
    role: member.member_role,
    joinedAt: iso(member.member_joined_at),
    lastReadAt: iso(member.last_read_at),
    muted: Boolean(member.member_muted),
  }));
  const otherUser =
    row.type === 'dm' ? mappedMembers.find((member) => member.id !== viewerId) || null : null;
  return {
    id: row.id,
    type: row.type,
    title: row.type === 'dm' ? otherUser?.displayName || 'Conversa' : row.title,
    avatarUrl: row.type === 'dm' ? otherUser?.avatarUrl || null : row.avatar_url,
    spaceId: row.space_id,
    channelId: row.channel_id,
    ownerId: row.owner_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastMessageAt: iso(row.last_message_at),
    lastMessagePreview: row.last_message_preview || '',
    unreadCount:
      options.unread !== undefined ? options.unread : unreadCount(db, row.id, viewerId),
    muted: Boolean(viewerMembership?.muted),
    myRole: viewerMembership?.role || 'member',
    memberCount: mappedMembers.length,
    members: mappedMembers,
    otherUser,
  };
}

function listConversations(db, userId) {
  const rows = db
    .prepare(
      `SELECT c.* FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
       WHERE c.type IN ('dm', 'group') AND cm.hidden = 0
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    )
    .all(userId);
  if (rows.length === 0) return [];
  const friendIds = friendIdSet(db, userId);
  const unread = unreadMap(db, userId);
  const memberRows = db
    .prepare(
      `SELECT cm.conversation_id, cm.role AS member_role, cm.joined_at AS member_joined_at,
              cm.muted AS member_muted,
              u.*, u.id AS user_id, COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE cm.conversation_id IN (${rows.map(() => '?').join(',')})`,
    )
    .all(...rows.map((row) => row.id));
  const membersByConversation = new Map();
  for (const member of memberRows) {
    if (!membersByConversation.has(member.conversation_id)) {
      membersByConversation.set(member.conversation_id, []);
    }
    membersByConversation.get(member.conversation_id).push(member);
  }
  return rows.map((row) =>
    serializeConversation(db, row, userId, {
      members: membersByConversation.get(row.id) || [],
      unread: unread.get(row.id) || 0,
      friendIds,
    }),
  );
}

function resolveBlocked(db, userA, userB) {
  return areBlockedEitherWay(db, userA, userB);
}

function createDm(db, userId, otherUserId) {
  if (userId === otherUserId) throw errors.badRequest('Você não pode iniciar uma conversa consigo mesmo');
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId);
  if (!other) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
  if (resolveBlocked(db, userId, otherUserId)) {
    throw errors.forbidden('Você não pode iniciar uma conversa com este usuário', 'BLOCKED');
  }
  const key = dmKey(userId, otherUserId);
  const existing = db.prepare('SELECT * FROM conversations WHERE dm_key = ?').get(key);
  if (existing) {
    const { conversation } = assertAccess(db, existing.id, userId);
    return { conversation: serializeConversation(db, conversation, userId), created: false };
  }
  const conversation = transaction(db, () => {
    const conversationId = id();
    const timestamp = now();
    db.prepare(
      `INSERT INTO conversations (id, type, title, owner_id, dm_key, created_at, updated_at)
       VALUES (?, 'dm', NULL, NULL, ?, ?, ?)`,
    ).run(conversationId, key, timestamp, timestamp);
    const insert = db.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
       VALUES (?, ?, 'member', ?, ?)`,
    );
    insert.run(conversationId, userId, timestamp, timestamp);
    insert.run(conversationId, otherUserId, timestamp, timestamp);
    return getConversation(db, conversationId);
  });
  const payload = serializeConversation(db, conversation, userId);
  for (const memberId of [userId, otherUserId]) {
    emitToUsers([memberId], 'conversation:new', {
      conversation: memberId === userId ? payload : serializeConversation(db, conversation, memberId),
    });
  }
  return { conversation: payload, created: true };
}

function createGroup(db, ownerId, input) {
  const memberIds = [...new Set([ownerId, ...input.memberIds])];
  const placeholders = memberIds.map(() => '?').join(',');
  const users = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...memberIds);
  if (users.length !== memberIds.length) {
    throw errors.badRequest('Um ou mais membros não existem', 'INVALID_MEMBERS');
  }
  const conversation = transaction(db, () => {
    const conversationId = id();
    const timestamp = now();
    db.prepare(
      `INSERT INTO conversations (id, type, title, owner_id, created_at, updated_at)
       VALUES (?, 'group', ?, ?, ?, ?)`,
    ).run(conversationId, input.title, ownerId, timestamp, timestamp);
    const insert = db.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const memberId of memberIds) {
      insert.run(
        conversationId,
        memberId,
        memberId === ownerId ? 'owner' : 'member',
        timestamp,
        timestamp,
      );
    }
    return getConversation(db, conversationId);
  });
  const payload = serializeConversation(db, conversation, ownerId);
  for (const memberId of memberIds) {
    emitToUsers([memberId], 'conversation:new', {
      conversation: serializeConversation(db, conversation, memberId),
    });
  }
  return { conversation: payload };
}

function addMember(db, conversationId, actorId, targetId) {
  const { conversation, membership } = assertAccess(db, conversationId, actorId);
  if (conversation.type !== 'group') {
    throw errors.badRequest('Apenas grupos suportam adicionar membros');
  }
  if (!['owner', 'admin'].includes(membership.role)) {
    throw errors.forbidden('Apenas administradores do grupo podem adicionar membros');
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
  const exists = getMembership(db, conversationId, targetId);
  if (exists) throw errors.conflict('O usuário já é membro', 'ALREADY_MEMBER');
  const timestamp = now();
  db.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
     VALUES (?, ?, 'member', ?, ?)`,
  ).run(conversationId, targetId, timestamp, timestamp);
  emitToUsers(
    [targetId, ...listMembers(db, conversationId).map((member) => member.user_id)],
    'conversation:member-added',
    { conversationId, userId: targetId },
  );
  return serializeConversation(db, getConversation(db, conversationId), actorId);
}

function removeMember(db, conversationId, actorId, targetId) {
  const { conversation, membership } = assertAccess(db, conversationId, actorId);
  if (conversation.type !== 'group') {
    throw errors.badRequest('Apenas grupos suportam remover membros');
  }
  if (actorId !== targetId && !['owner', 'admin'].includes(membership.role)) {
    throw errors.forbidden('Apenas administradores do grupo podem remover membros');
  }
  if (targetId === conversation.owner_id) {
    throw errors.forbidden('O proprietário do grupo não pode ser removido', 'OWNER_IMMUTABLE');
  }
  const target = getMembership(db, conversationId, targetId);
  if (!target) throw errors.notFound('Membro não encontrado', 'MEMBER_NOT_FOUND');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
    conversationId,
    targetId,
  );
  const memberIds = listMembers(db, conversationId).map((member) => member.user_id);
  emitToUsers([...memberIds, targetId], 'conversation:member-removed', {
    conversationId,
    userId: targetId,
  });
}

function updateConversation(db, conversationId, userId, patch) {
  const { conversation, membership } = assertAccess(db, conversationId, userId);
  if (conversation.type === 'dm') throw errors.badRequest('Conversas diretas não podem ser editadas');
  if (conversation.type === 'group' && !['owner', 'admin'].includes(membership.role)) {
    throw errors.forbidden('Apenas administradores do grupo podem editar esta conversa');
  }
  const fields = [];
  const values = [];
  if (patch.title !== undefined && conversation.type === 'group') {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.avatarUrl !== undefined) {
    fields.push('avatar_url = ?');
    values.push(patch.avatarUrl);
  }
  if (fields.length === 0) return serializeConversation(db, conversation, userId);
  fields.push('updated_at = ?');
  values.push(now(), conversationId);
  db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = getConversation(db, conversationId);
  const payload = serializeConversation(db, updated, userId);
  emitToUsers(
    listMembers(db, conversationId).map((member) => member.user_id),
    'conversation:updated',
    { conversation: payload },
  );
  return payload;
}

function markRead(db, conversationId, userId, messageId) {
  const { conversation } = assertAccess(db, conversationId, userId);
  let readAt = now();
  if (messageId) {
    const message = db
      .prepare('SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, conversationId);
    if (message) readAt = Math.max(readAt, message.created_at);
  }
  db.prepare(
    'UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
  ).run(readAt, conversationId, userId);
  const settings = db.prepare('SELECT privacy_read_receipts FROM user_settings WHERE user_id = ?').get(userId);
  if (settings && settings.privacy_read_receipts) {
    emitToUsers(
      listMembers(db, conversationId)
        .map((member) => member.user_id)
        .filter((idValue) => idValue !== userId),
      'conversation:read',
      { conversationId, userId, lastReadAt: new Date(readAt).toISOString() },
    );
  }
  return { conversation, lastReadAt: new Date(readAt).toISOString() };
}

module.exports = {
  getConversation,
  getMembership,
  assertAccess,
  listMembers,
  serializeConversation,
  listConversations,
  unreadCount,
  createDm,
  createGroup,
  addMember,
  removeMember,
  updateConversation,
  markRead,
  friendIdSet,
};
