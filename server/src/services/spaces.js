'use strict';

const crypto = require('crypto');
const { now, id, transaction, slugify, safeJson, iso, DEFAULT_ROLE_PERMISSIONS } = require('../utils/helpers');
const { errors } = require('../utils/errors');

const ALL_PERMISSIONS = Object.keys(DEFAULT_ROLE_PERMISSIONS).flatMap(
  (name) => DEFAULT_ROLE_PERMISSIONS[name],
);
const UNIQUE_PERMISSIONS = [...new Set(ALL_PERMISSIONS)];

function getSpace(db, spaceId) {
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
}

function getMembership(db, spaceId, userId) {
  return db
    .prepare('SELECT * FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId);
}

function getMemberRoles(db, spaceId, userId) {
  return db
    .prepare(
      `SELECT r.* FROM space_roles r
       JOIN space_member_roles mr ON mr.role_id = r.id AND mr.space_id = r.space_id
       WHERE r.space_id = ? AND mr.user_id = ?
       ORDER BY r.position DESC, r.name ASC`,
    )
    .all(spaceId, userId);
}

function serializeRole(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    permissions: safeJson(row.permissions, []),
    position: row.position,
    isDefault: Boolean(row.is_default),
    createdAt: iso(row.created_at),
  };
}

function permissionsForMember(db, spaceId, userId) {
  const space = getSpace(db, spaceId);
  if (!space) return new Set();
  if (space.owner_id === userId) return new Set(UNIQUE_PERMISSIONS);
  const membership = getMembership(db, spaceId, userId);
  if (!membership) return new Set();
  const roles = getMemberRoles(db, spaceId, userId);
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of safeJson(role.permissions, [])) permissions.add(permission);
  }
  return permissions;
}

function highestRank(db, spaceId, userId) {
  const space = getSpace(db, spaceId);
  if (!space) return -1;
  if (space.owner_id === userId) return Number.MAX_SAFE_INTEGER;
  const row = db
    .prepare(
      `SELECT MAX(r.position) AS rank FROM space_roles r
       JOIN space_member_roles mr ON mr.role_id = r.id AND mr.space_id = r.space_id
       WHERE r.space_id = ? AND mr.user_id = ?`,
    )
    .get(spaceId, userId);
  return row && row.rank !== null ? row.rank : 0;
}

function getSpaceContext(db, spaceId, userId) {
  const space = getSpace(db, spaceId);
  if (!space) throw errors.notFound('Espaço não encontrado', 'SPACE_NOT_FOUND');
  const membership = getMembership(db, spaceId, userId);
  if (!membership) throw errors.forbidden('Você não é membro deste espaço', 'NOT_A_MEMBER');
  const roles = getMemberRoles(db, spaceId, userId);
  const permissions = permissionsForMember(db, spaceId, userId);
  return {
    space,
    membership,
    roles,
    permissions,
    rank: highestRank(db, spaceId, userId),
    isOwner: space.owner_id === userId,
  };
}

function requirePermission(context, permission) {
  if (!context.permissions.has(permission)) {
    throw errors.forbidden(`Permissão ausente: ${permission}`, 'MISSING_PERMISSION');
  }
}

function serializeSpace(row, context, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    iconUrl: row.icon_url,
    bannerUrl: row.banner_url,
    ownerId: row.owner_id,
    visibility: row.visibility,
    createdAt: iso(row.created_at),
    ...(context
      ? {
          myPermissions: [...context.permissions],
          isOwner: context.isOwner,
          myRoles: context.roles.map(serializeRole),
        }
      : {}),
    ...extra,
  };
}

function uniqueSlug(db, name) {
  const base = slugify(name);
  let candidate = base;
  let counter = 1;
  while (db.prepare('SELECT 1 AS ok FROM spaces WHERE slug = ?').get(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}

function createSpaceRoles(db, spaceId) {
  const created = {};
  const roles = [
    ['Owner', '#C9A0DC', DEFAULT_ROLE_PERMISSIONS.Owner, 100, 0],
    ['Admin', '#7DD3FC', DEFAULT_ROLE_PERMISSIONS.Admin, 50, 0],
    ['Member', '#9AA89F', DEFAULT_ROLE_PERMISSIONS.Member, 10, 1],
  ];
  for (const [name, color, permissions, position, isDefault] of roles) {
    const roleId = id();
    db.prepare(
      `INSERT INTO space_roles (id, space_id, name, color, permissions, position, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(roleId, spaceId, name, color, JSON.stringify(permissions), position, isDefault, now());
    created[name] = roleId;
  }
  return created;
}

function createChannelConversation(db, channel, memberIds) {
  const conversationId = id();
  const timestamp = now();
  db.prepare(
    `INSERT INTO conversations (id, type, title, owner_id, space_id, channel_id, created_at, updated_at)
     VALUES (?, 'channel', ?, NULL, ?, ?, ?, ?)`,
  ).run(conversationId, `#${channel.name}`, channel.space_id, channel.id, timestamp, timestamp);
  const insertMember = db.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
     VALUES (?, ?, 'member', ?, ?)`,
  );
  for (const userId of new Set(memberIds)) {
    insertMember.run(conversationId, userId, timestamp, timestamp);
  }
  return conversationId;
}

function createSpace(db, ownerId, input) {
  return transaction(db, () => {
    const createdAt = now();
    const spaceId = id();
    db.prepare(
      `INSERT INTO spaces (id, name, slug, description, icon_url, owner_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      spaceId,
      input.name,
      uniqueSlug(db, input.name),
      input.description || '',
      input.iconUrl || null,
      ownerId,
      input.visibility || 'private',
      createdAt,
      createdAt,
    );
    db.prepare(
      'INSERT INTO space_members (space_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)',
    ).run(spaceId, ownerId, createdAt);
    const roles = createSpaceRoles(db, spaceId);
    db.prepare(
      'INSERT INTO space_member_roles (space_id, user_id, role_id) VALUES (?, ?, ?)',
    ).run(spaceId, ownerId, roles.Owner);

    const channelId = id();
    const channel = {
      id: channelId,
      space_id: spaceId,
      name: 'general',
      topic: 'Conversas gerais do espaço',
      category: 'Geral',
      position: 0,
      is_private: 0,
    };
    db.prepare(
      `INSERT INTO channels (id, space_id, name, topic, category, type, position, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?, ?)`,
    ).run(
      channelId,
      spaceId,
      channel.name,
      channel.topic,
      channel.category,
      channel.position,
      channel.is_private,
      createdAt,
      createdAt,
    );
    createChannelConversation(db, channel, [ownerId]);
    return { spaceId, defaultChannelId: channelId };
  });
}

function addMemberToPublicChannels(db, spaceId, userId) {
  const channels = db
    .prepare(
      `SELECT c.*, cv.id AS conversation_id FROM channels c
       JOIN conversations cv ON cv.channel_id = c.id
       WHERE c.space_id = ? AND c.is_private = 0`,
    )
    .all(spaceId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
     VALUES (?, ?, 'member', ?, ?)`,
  );
  const timestamp = now();
  for (const channel of channels) {
    insert.run(channel.conversation_id, userId, timestamp, timestamp);
  }
}

function addSpaceMember(db, spaceId, userId, options = {}) {
  const timestamp = now();
  db.prepare(
    'INSERT OR IGNORE INTO space_members (space_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?)',
  ).run(spaceId, userId, options.nickname || null, timestamp);
  const defaultRole = db
    .prepare('SELECT * FROM space_roles WHERE space_id = ? AND is_default = 1 LIMIT 1')
    .get(spaceId);
  if (defaultRole) {
    db.prepare(
      'INSERT OR IGNORE INTO space_member_roles (space_id, user_id, role_id) VALUES (?, ?, ?)',
    ).run(spaceId, userId, defaultRole.id);
  }
  if (!options.skipChannels) addMemberToPublicChannels(db, spaceId, userId);
}

function removeSpaceMember(db, spaceId, userId) {
  db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
  const conversations = db
    .prepare('SELECT id FROM conversations WHERE space_id = ?')
    .all(spaceId);
  for (const conversation of conversations) {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
      conversation.id,
      userId,
    );
  }
}

function canActOnMember(db, context, targetUserId) {
  if (targetUserId === context.space.owner_id) return false;
  if (context.isOwner) return true;
  return context.rank > highestRank(db, context.space.id, targetUserId);
}

function logAudit(db, spaceId, actorId, action, targetId, details = {}) {
  db.prepare(
    `INSERT INTO space_audit (id, space_id, actor_id, action, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id(), spaceId, actorId, action, targetId || null, JSON.stringify(details), now());
}

function serializeChannel(row, conversationId, unreadCount = 0) {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    topic: row.topic,
    category: row.category,
    position: row.position,
    isPrivate: Boolean(row.is_private),
    conversationId: conversationId || row.conversation_id || null,
    unreadCount,
    createdAt: iso(row.created_at),
  };
}

function createChannel(db, context, input) {
  return transaction(db, () => {
    const channelId = id();
    const timestamp = now();
    const maxPosition = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM channels WHERE space_id = ?')
      .get(context.space.id).max;
    db.prepare(
      `INSERT INTO channels (id, space_id, name, topic, category, type, position, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?, ?)`,
    ).run(
      channelId,
      context.space.id,
      input.name,
      input.topic || '',
      input.category || 'General',
      maxPosition + 1,
      input.isPrivate ? 1 : 0,
      timestamp,
      timestamp,
    );
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    const memberIds = input.isPrivate
      ? [context.membership.user_id]
      : db
          .prepare('SELECT user_id FROM space_members WHERE space_id = ?')
          .all(context.space.id)
          .map((row) => row.user_id);
    const conversationId = createChannelConversation(db, channel, memberIds);
    logAudit(db, context.space.id, context.membership.user_id, 'channel.created', channelId, {
      name: channel.name,
    });
    return { channel, conversationId };
  });
}

function generateInviteCode() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = {
  UNIQUE_PERMISSIONS,
  getSpace,
  getMembership,
  getMemberRoles,
  getSpaceContext,
  permissionsForMember,
  requirePermission,
  serializeSpace,
  serializeRole,
  serializeChannel,
  createSpace,
  addSpaceMember,
  removeSpaceMember,
  createChannel,
  canActOnMember,
  highestRank,
  logAudit,
  generateInviteCode,
  createChannelConversation,
  addMemberToPublicChannels,
};
