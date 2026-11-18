'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimit');
const {
  createSpaceSchema,
  updateSpaceSchema,
  createChannelSchema,
  updateChannelSchema,
  createRoleSchema,
  updateRoleSchema,
  createInviteSchema,
  updateMemberSchema,
  banMemberSchema,
} = require('../utils/schemas');
const { errors } = require('../utils/errors');
const { now, id, safeJson, iso, transaction } = require('../utils/helpers');
const spacesService = require('../services/spaces');
const conversations = require('../services/conversations');
const { createSystemMessage } = require('../services/messages');
const { serializeUser, getPublicUser, createNotification } = require('../services/users');
const { emitToUsers, emitToSpace } = require('../realtime/bus');
const config = require('../config');

const memberQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});
const addChannelMemberSchema = z.object({ userId: z.string().uuid() });

function memberIds(db, spaceId) {
  return db
    .prepare('SELECT user_id FROM space_members WHERE space_id = ?')
    .all(spaceId)
    .map((row) => row.user_id);
}

function generalConversationId(db, spaceId) {
  const row = db
    .prepare(
      `SELECT cv.id FROM channels c JOIN conversations cv ON cv.channel_id = c.id
       WHERE c.space_id = ? AND c.is_private = 0 ORDER BY c.position ASC LIMIT 1`,
    )
    .get(spaceId);
  return row ? row.id : null;
}

function announce(db, spaceId, content) {
  const conversationId = generalConversationId(db, spaceId);
  if (conversationId) {
    try {
      createSystemMessage(db, conversationId, content);
    } catch {
      // A missing announcement channel must not block the main action.
    }
  }
}

function spaceSummary(db, row, userId) {
  const members = db
    .prepare('SELECT COUNT(*) AS count FROM space_members WHERE space_id = ?')
    .get(row.id).count;
  const channels = db
    .prepare('SELECT COUNT(*) AS count FROM channels WHERE space_id = ?')
    .get(row.id).count;
  const joined = Boolean(
    db.prepare('SELECT 1 AS ok FROM space_members WHERE space_id = ? AND user_id = ?').get(row.id, userId),
  );
  return {
    ...spacesService.serializeSpace(row),
    memberCount: members,
    channelCount: channels,
    joined,
  };
}

function channelRowsForUser(db, spaceId, userId, canManage) {
  const rows = db
    .prepare(
      `SELECT c.*, cv.id AS conversation_id, cm.user_id AS joined_user
       FROM channels c
       JOIN conversations cv ON cv.channel_id = c.id
       LEFT JOIN conversation_members cm ON cm.conversation_id = cv.id AND cm.user_id = ?
       WHERE c.space_id = ? AND (c.is_private = 0 OR cm.user_id IS NOT NULL OR ? = 1)
       ORDER BY c.position ASC, c.name COLLATE NOCASE ASC`,
    )
    .all(userId, spaceId, canManage ? 1 : 0);
  return rows.map((row) =>
    spacesService.serializeChannel(
      row,
      row.conversation_id,
      row.joined_user ? conversations.unreadCount(db, row.conversation_id, userId) : 0,
    ),
  );
}

function voiceStatesForSpace(db, spaceId) {
  const rows = db
    .prepare(
      `SELECT c.id AS call_id, c.channel_id, cp.user_id, u.username, u.display_name, u.avatar_url, u.presence
       FROM calls c
       JOIN channels ch ON ch.id = c.channel_id
       JOIN call_participants cp ON cp.call_id = c.id
       JOIN users u ON u.id = cp.user_id
       WHERE ch.space_id = ? AND c.status = 'active' AND cp.status = 'joined'
       ORDER BY cp.joined_at ASC`,
    )
    .all(spaceId);
  const states = new Map();
  for (const row of rows) {
    let state = states.get(row.channel_id);
    if (!state) {
      state = { channelId: row.channel_id, callId: row.call_id, participants: [] };
      states.set(row.channel_id, state);
    }
    state.participants.push({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      presence: row.presence,
    });
  }
  return [...states.values()];
}

function memberRoleMap(db, spaceId) {
  const rows = db
    .prepare(
      `SELECT mr.user_id, r.* FROM space_member_roles mr
       JOIN space_roles r ON r.id = mr.role_id WHERE mr.space_id = ?
       ORDER BY r.position DESC`,
    )
    .all(spaceId);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(spacesService.serializeRole(row));
  }
  return map;
}

function listSpaceMembers(db, spaceId, options = {}) {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url,
              u.custom_status, u.presence, u.last_seen, u.email_verified, u.created_at,
              COALESCE(us.privacy_last_seen, 'everyone') AS privacy_last_seen,
              sm.nickname, sm.joined_at
       FROM space_members sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE sm.space_id = ?
         ${options.search ? "AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')" : ''}
       ORDER BY u.display_name COLLATE NOCASE
       LIMIT ?`,
    )
    .all(
      ...(options.search
        ? [spaceId, `%${options.search}%`, `%${options.search}%`, options.limit || 200]
        : [spaceId, options.limit || 200]),
    );
  const roleMap = memberRoleMap(db, spaceId);
  const space = spacesService.getSpace(db, spaceId);
  return rows
    .map((row) => {
      const roles = roleMap.get(row.id) || [];
      return {
        ...serializeUser(row),
        nickname: row.nickname,
        joinedAt: iso(row.joined_at),
        roles,
        isOwner: space.owner_id === row.id,
        rank: space.owner_id === row.id ? 1000 : Math.max(0, ...roles.map((role) => role.position)),
      };
    })
    .sort((a, b) => b.rank - a.rank || a.displayName.localeCompare(b.displayName));
}

function channelContext(db, channelId, userId) {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) throw errors.notFound('Canal não encontrado', 'CHANNEL_NOT_FOUND');
  const context = spacesService.getSpaceContext(db, channel.space_id, userId);
  const conversation = db.prepare('SELECT * FROM conversations WHERE channel_id = ?').get(channel.id);
  const membership = conversation
    ? conversations.getMembership(db, conversation.id, userId)
    : null;
  return { channel, context, conversation, membership };
}

function createSpacesRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.* FROM spaces s JOIN space_members sm ON sm.space_id = s.id
         WHERE sm.user_id = ? ORDER BY s.name COLLATE NOCASE`,
      )
      .all(req.user.id);
    res.json({ spaces: rows.map((row) => spaceSummary(db, row, req.user.id)) });
  });

  router.get('/discover', searchLimiter, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = db
      .prepare(
        `SELECT s.* FROM spaces s
         WHERE s.visibility = 'public'
           AND NOT EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = s.id AND sm.user_id = ?)
           ${q ? "AND (s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')" : ''}
         ORDER BY (SELECT COUNT(*) FROM space_members sm2 WHERE sm2.space_id = s.id) DESC, s.created_at DESC
         LIMIT 40`,
      )
      .all(...(q ? [req.user.id, `%${q}%`, `%${q}%`] : [req.user.id]));
    res.json({ spaces: rows.map((row) => spaceSummary(db, row, req.user.id)) });
  });

  router.post('/', validate(createSpaceSchema), (req, res) => {
    const result = spacesService.createSpace(db, req.user.id, req.body);
    const space = spacesService.getSpace(db, result.spaceId);
    const context = spacesService.getSpaceContext(db, result.spaceId, req.user.id);
    res.status(201).json({
      space: spacesService.serializeSpace(space, context, {
        memberCount: 1,
        channelCount: 1,
        joined: true,
      }),
      defaultChannelId: result.defaultChannelId,
    });
  });

  router.get('/:spaceId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    const canManageChannels = context.permissions.has('manage_channels');
    const channels = channelRowsForUser(db, req.params.spaceId, req.user.id, canManageChannels).map(
      (channel) => {
        const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id);
        const membership = channel.conversationId
          ? conversations.getMembership(db, channel.conversationId, req.user.id)
          : null;
        return { ...channel, joined: Boolean(membership) || !row.is_private };
      },
    );
    const memberCount = db
      .prepare('SELECT COUNT(*) AS count FROM space_members WHERE space_id = ?')
      .get(req.params.spaceId).count;
    const roles = db
      .prepare('SELECT * FROM space_roles WHERE space_id = ? ORDER BY position DESC, name ASC')
      .all(req.params.spaceId)
      .map(spacesService.serializeRole);
    const channelCount = db
      .prepare('SELECT COUNT(*) AS count FROM channels WHERE space_id = ?')
      .get(req.params.spaceId).count;
    res.json({
      space: spacesService.serializeSpace(context.space, context, {
        memberCount,
        channelCount,
        joined: true,
      }),
      channels,
      roles,
      voiceStates: voiceStatesForSpace(db, req.params.spaceId),
      myMember: {
        nickname: context.membership.nickname,
        joinedAt: iso(context.membership.joined_at),
        permissions: [...context.permissions],
      },
    });
  });

  router.patch('/:spaceId', validate(updateSpaceSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'manage_space');
    const mapping = {
      name: 'name',
      description: 'description',
      visibility: 'visibility',
      iconUrl: 'icon_url',
      bannerUrl: 'banner_url',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(mapping)) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(req.body[key]);
      }
    }
    if (fields.length) {
      fields.push('updated_at = ?');
      values.push(now(), req.params.spaceId);
      db.prepare(`UPDATE spaces SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      spacesService.logAudit(db, req.params.spaceId, req.user.id, 'space.updated', null, {
        fields: Object.keys(req.body),
      });
    }
    const space = spacesService.getSpace(db, req.params.spaceId);
    const updatedContext = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    emitToSpace(db, req.params.spaceId, 'space:updated', {
      spaceId: req.params.spaceId,
      space: spacesService.serializeSpace(space, updatedContext),
    });
    res.json({ space: spacesService.serializeSpace(space, updatedContext) });
  });

  router.delete('/:spaceId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    if (!context.isOwner) throw errors.forbidden('Apenas o proprietário pode excluir um espaço', 'OWNER_ONLY');
    const audience = memberIds(db, req.params.spaceId);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(req.params.spaceId);
    emitToUsers(audience, 'space:deleted', { spaceId: req.params.spaceId });
    res.json({ ok: true });
  });

  router.post('/:spaceId/join', (req, res) => {
    const space = spacesService.getSpace(db, req.params.spaceId);
    if (!space) throw errors.notFound('Espaço não encontrado', 'SPACE_NOT_FOUND');
    if (space.visibility !== 'public') {
      throw errors.forbidden('Este espaço exige um convite', 'INVITE_REQUIRED');
    }
    const banned = db
      .prepare('SELECT 1 AS ok FROM space_bans WHERE space_id = ? AND user_id = ?')
      .get(space.id, req.user.id);
    if (banned) throw errors.forbidden('Você está banido deste espaço', 'BANNED');
    const existing = spacesService.getMembership(db, space.id, req.user.id);
    if (!existing) {
      spacesService.addSpaceMember(db, space.id, req.user.id);
      announce(db, space.id, `${req.user.display_name} entrou no espaço`);
      emitToSpace(db, space.id, 'space:member-joined', {
        spaceId: space.id,
        userId: req.user.id,
      });
    }
    const context = spacesService.getSpaceContext(db, space.id, req.user.id);
    res.json({ space: spacesService.serializeSpace(space, context, { joined: true }) });
  });

  router.post('/:spaceId/leave', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    if (context.isOwner) {
      throw errors.badRequest('O proprietário precisa transferir ou excluir o espaço antes de sair', 'OWNER_CANNOT_LEAVE');
    }
    spacesService.removeSpaceMember(db, req.params.spaceId, req.user.id);
    announce(db, req.params.spaceId, `${req.user.display_name} saiu do espaço`);
    emitToUsers([req.user.id], 'space:removed', { spaceId: req.params.spaceId });
    emitToSpace(db, req.params.spaceId, 'space:member-left', {
      spaceId: req.params.spaceId,
      userId: req.user.id,
    });
    res.json({ ok: true });
  });

  router.get(
    '/:spaceId/members',
    validate(memberQuerySchema, 'query'),
    (req, res) => {
      spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
      res.json({
        members: listSpaceMembers(db, req.params.spaceId, {
          search: req.validated.query.q,
          limit: req.validated.query.limit,
        }),
      });
    },
  );

  router.patch('/:spaceId/members/:userId', validate(updateMemberSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    if (req.user.id !== req.params.userId && !context.permissions.has('manage_members')) {
      throw errors.forbidden('Permissão ausente: manage_members', 'MISSING_PERMISSION');
    }
    if (!spacesService.getMembership(db, req.params.spaceId, req.params.userId)) {
      throw errors.notFound('Membro não encontrado', 'MEMBER_NOT_FOUND');
    }
    if (req.body.nickname !== undefined) {
      db.prepare('UPDATE space_members SET nickname = ? WHERE space_id = ? AND user_id = ?').run(
        req.body.nickname || null,
        req.params.spaceId,
        req.params.userId,
      );
    }
    if (req.body.roleIds !== undefined) {
      spacesService.requirePermission(context, 'manage_roles');
      const target = db
        .prepare('SELECT u.display_name FROM users u WHERE u.id = ?')
        .get(req.params.userId);
      if (spacesService.getSpace(db, req.params.spaceId).owner_id === req.params.userId) {
        throw errors.forbidden('A função de proprietário não pode ser alterada', 'OWNER_IMMUTABLE');
      }
      if (!spacesService.canActOnMember(db, context, req.params.userId) && !context.isOwner) {
        throw errors.forbidden('Você não pode gerenciar esse membro', 'ROLE_HIERARCHY');
      }
      const uniqueRoleIds = [...new Set(req.body.roleIds)];
      const roles = uniqueRoleIds.length
        ? db
            .prepare(
              `SELECT * FROM space_roles WHERE space_id = ? AND id IN (${uniqueRoleIds.map(() => '?').join(',')})`,
            )
            .all(req.params.spaceId, ...uniqueRoleIds)
        : [];
      if (roles.length !== uniqueRoleIds.length) {
        throw errors.badRequest('Uma ou mais funções são inválidas', 'INVALID_ROLES');
      }
      for (const role of roles) {
        if (role.is_default) continue;
        if (role.position >= 100) throw errors.forbidden('A função de proprietário não pode ser atribuída', 'OWNER_ROLE');
        if (!context.isOwner && role.position >= context.rank) {
          throw errors.forbidden('Você não pode atribuir uma função igual ou superior à sua', 'ROLE_HIERARCHY');
        }
        const rolePermissions = safeJson(role.permissions, []);
        if (!context.isOwner && rolePermissions.some((permission) => !context.permissions.has(permission))) {
          throw errors.forbidden('Você não pode conceder permissões que não possui', 'PERMISSION_ESCALATION');
        }
      }
      transaction(db, () => {
        db.prepare('DELETE FROM space_member_roles WHERE space_id = ? AND user_id = ?').run(
          req.params.spaceId,
          req.params.userId,
        );
        const defaultRole = db
          .prepare('SELECT * FROM space_roles WHERE space_id = ? AND is_default = 1 LIMIT 1')
          .get(req.params.spaceId);
        const toAssign = new Set(roles.map((role) => role.id));
        if (defaultRole) toAssign.add(defaultRole.id);
        for (const roleId of toAssign) {
          db.prepare(
            'INSERT OR IGNORE INTO space_member_roles (space_id, user_id, role_id) VALUES (?, ?, ?)',
          ).run(req.params.spaceId, req.params.userId, roleId);
        }
      });
      spacesService.logAudit(db, req.params.spaceId, req.user.id, 'member.roles', req.params.userId, {
        roles: uniqueRoleIds,
      });
      emitToSpace(db, req.params.spaceId, 'space:updated', { spaceId: req.params.spaceId });
      createNotification(db, {
        userId: req.params.userId,
        type: 'roles_updated',
        title: `Seus cargos em ${context.space.name} foram atualizados`,
        body: target ? 'As suas permissões mudaram.' : '',
        data: { spaceId: req.params.spaceId },
      });
    }
    res.json({
      member: listSpaceMembers(db, req.params.spaceId, { limit: 500 }).find(
        (member) => member.id === req.params.userId,
      ),
    });
  });

  router.delete('/:spaceId/members/:userId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'kick_members');
    const targetId = req.params.userId;
    if (targetId === req.user.id) throw errors.badRequest('Use o endpoint de saída', 'SELF_KICK');
    if (!spacesService.getMembership(db, req.params.spaceId, targetId)) {
      throw errors.notFound('Membro não encontrado', 'MEMBER_NOT_FOUND');
    }
    if (!spacesService.canActOnMember(db, context, targetId)) {
      throw errors.forbidden('Você não pode remover esse membro', 'ROLE_HIERARCHY');
    }
    const target = getPublicUser(db, targetId);
    spacesService.removeSpaceMember(db, req.params.spaceId, targetId);
    announce(db, req.params.spaceId, `${req.user.display_name} removeu ${target?.displayName || 'um membro'}`);
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'member.kicked', targetId);
    emitToSpace(db, req.params.spaceId, 'space:member-left', {
      spaceId: req.params.spaceId,
      userId: targetId,
    });
    emitToUsers([targetId], 'space:removed', { spaceId: req.params.spaceId });
    createNotification(db, {
      userId: targetId,
      type: 'space_kicked',
      title: `Você foi removido de ${context.space.name}`,
      body: 'Um administrador removeu você deste espaço.',
      data: { spaceId: req.params.spaceId },
    });
    res.json({ ok: true });
  });

  router.post('/:spaceId/bans/:userId', validate(banMemberSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'ban_members');
    const targetId = req.params.userId;
    if (targetId === req.user.id) throw errors.badRequest('Você não pode banir a si mesmo');
    if (!spacesService.canActOnMember(db, context, targetId)) {
      throw errors.forbidden('Você não pode banir esse membro', 'ROLE_HIERARCHY');
    }
    const target = getPublicUser(db, targetId);
    if (!target) throw errors.notFound('Usuário não encontrado', 'USER_NOT_FOUND');
    transaction(db, () => {
      db.prepare(
        `INSERT INTO space_bans (space_id, user_id, banned_by, reason, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(space_id, user_id) DO UPDATE SET banned_by = excluded.banned_by,
           reason = excluded.reason, created_at = excluded.created_at`,
      ).run(req.params.spaceId, targetId, req.user.id, req.body.reason || '', now());
      spacesService.removeSpaceMember(db, req.params.spaceId, targetId);
    });
    announce(db, req.params.spaceId, `${req.user.display_name} baniu ${target.display_name}`);
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'member.banned', targetId, {
      reason: req.body.reason,
    });
    emitToSpace(db, req.params.spaceId, 'space:member-left', {
      spaceId: req.params.spaceId,
      userId: targetId,
    });
    emitToUsers([targetId], 'space:banned', { spaceId: req.params.spaceId });
    createNotification(db, {
      userId: targetId,
      type: 'space_banned',
      title: `Você foi banido de ${context.space.name}`,
      body: req.body.reason || 'Você não pode mais entrar neste espaço.',
      data: { spaceId: req.params.spaceId },
    });
    res.json({ ok: true });
  });

  router.delete('/:spaceId/bans/:userId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'ban_members');
    db.prepare('DELETE FROM space_bans WHERE space_id = ? AND user_id = ?').run(
      req.params.spaceId,
      req.params.userId,
    );
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'member.unbanned', req.params.userId);
    res.json({ ok: true });
  });

  router.get('/:spaceId/bans', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'ban_members');
    const rows = db
      .prepare(
        `SELECT b.*, u.username, u.display_name, u.avatar_url, u.presence FROM space_bans b
         JOIN users u ON u.id = b.user_id WHERE b.space_id = ? ORDER BY b.created_at DESC`,
      )
      .all(req.params.spaceId);
    res.json({
      bans: rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        presence: row.presence,
        reason: row.reason,
        createdAt: iso(row.created_at),
      })),
    });
  });

  router.get('/:spaceId/roles', (req, res) => {
    spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    const rows = db
      .prepare('SELECT * FROM space_roles WHERE space_id = ? ORDER BY position DESC, name ASC')
      .all(req.params.spaceId);
    res.json({ roles: rows.map(spacesService.serializeRole) });
  });

  router.post('/:spaceId/roles', validate(createRoleSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'manage_roles');
    if (!context.isOwner && (req.body.permissions || []).some((p) => !context.permissions.has(p))) {
      throw errors.forbidden('Você não pode conceder permissões que não possui', 'PERMISSION_ESCALATION');
    }
    const roleId = id();
    db.prepare(
      `INSERT INTO space_roles (id, space_id, name, color, permissions, position, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, 25, 0, ?)`,
    ).run(
      roleId,
      req.params.spaceId,
      req.body.name,
      req.body.color,
      JSON.stringify(req.body.permissions || ['send_messages']),
      now(),
    );
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'role.created', roleId, {
      name: req.body.name,
    });
    emitToSpace(db, req.params.spaceId, 'space:updated', { spaceId: req.params.spaceId });
    const row = db.prepare('SELECT * FROM space_roles WHERE id = ?').get(roleId);
    res.status(201).json({ role: spacesService.serializeRole(row) });
  });

  router.patch('/:spaceId/roles/:roleId', validate(updateRoleSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'manage_roles');
    const role = db
      .prepare('SELECT * FROM space_roles WHERE id = ? AND space_id = ?')
      .get(req.params.roleId, req.params.spaceId);
    if (!role) throw errors.notFound('Função não encontrada', 'ROLE_NOT_FOUND');
    if (role.position >= 100) throw errors.forbidden('A função de proprietário não pode ser modificada', 'OWNER_ROLE');
    if (!context.isOwner && role.position >= context.rank) {
      throw errors.forbidden('Você não pode modificar uma função igual ou superior à sua', 'ROLE_HIERARCHY');
    }
    if (
      !context.isOwner &&
      (req.body.permissions || []).some((permission) => !context.permissions.has(permission))
    ) {
      throw errors.forbidden('Você não pode conceder permissões que não possui', 'PERMISSION_ESCALATION');
    }
    const fields = [];
    const values = [];
    if (req.body.name !== undefined) {
      fields.push('name = ?');
      values.push(req.body.name);
    }
    if (req.body.color !== undefined) {
      fields.push('color = ?');
      values.push(req.body.color);
    }
    if (req.body.permissions !== undefined) {
      fields.push('permissions = ?');
      values.push(JSON.stringify(req.body.permissions));
    }
    if (fields.length) {
      values.push(role.id);
      db.prepare(`UPDATE space_roles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      spacesService.logAudit(db, req.params.spaceId, req.user.id, 'role.updated', role.id);
      emitToSpace(db, req.params.spaceId, 'space:updated', { spaceId: req.params.spaceId });
    }
    const updated = db.prepare('SELECT * FROM space_roles WHERE id = ?').get(role.id);
    res.json({ role: spacesService.serializeRole(updated) });
  });

  router.delete('/:spaceId/roles/:roleId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'manage_roles');
    const role = db
      .prepare('SELECT * FROM space_roles WHERE id = ? AND space_id = ?')
      .get(req.params.roleId, req.params.spaceId);
    if (!role) throw errors.notFound('Função não encontrada', 'ROLE_NOT_FOUND');
    if (role.position >= 100) throw errors.forbidden('A função de proprietário não pode ser excluída', 'OWNER_ROLE');
    if (role.is_default) throw errors.forbidden('A função padrão não pode ser excluída', 'DEFAULT_ROLE');
    if (!context.isOwner && role.position >= context.rank) {
      throw errors.forbidden('Você não pode excluir uma função igual ou superior à sua', 'ROLE_HIERARCHY');
    }
    db.prepare('DELETE FROM space_roles WHERE id = ?').run(role.id);
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'role.deleted', role.id);
    emitToSpace(db, req.params.spaceId, 'space:updated', { spaceId: req.params.spaceId });
    res.json({ ok: true });
  });

  router.post('/:spaceId/channels', validate(createChannelSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    const exists = db
      .prepare('SELECT 1 AS ok FROM channels WHERE space_id = ? AND name = ? COLLATE NOCASE')
      .get(req.params.spaceId, req.body.name);
    if (exists) throw errors.conflict('Já existe um canal com esse nome', 'CHANNEL_EXISTS');
    const result = spacesService.createChannel(db, context, req.body);
    emitToSpace(db, req.params.spaceId, 'space:updated', { spaceId: req.params.spaceId });
    res.status(201).json({
      channel: spacesService.serializeChannel(result.channel, result.conversationId),
    });
  });

  router.post('/:spaceId/invites', validate(createInviteSchema), (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'create_invites');
    const inviteId = id();
    const requestedCode =
      typeof req.body.code === 'string' ? req.body.code.trim().toLowerCase() : '';
    let code = requestedCode;
    if (code) {
      const taken = db.prepare('SELECT 1 AS ok FROM space_invites WHERE code = ?').get(code);
      if (taken) {
        throw errors.conflict('Este link personalizado já está em uso', 'INVITE_CODE_TAKEN');
      }
    } else {
      do {
        code = spacesService.generateInviteCode();
      } while (db.prepare('SELECT 1 AS ok FROM space_invites WHERE code = ?').get(code));
    }
    const createdAt = now();
    const expiresAt = req.body.expiresInHours
      ? createdAt + req.body.expiresInHours * 60 * 60 * 1000
      : null;
    db.prepare(
      `INSERT INTO space_invites (id, space_id, code, created_by, expires_at, max_uses, uses, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      inviteId,
      req.params.spaceId,
      code,
      req.user.id,
      expiresAt,
      req.body.maxUses || null,
      createdAt,
    );
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'invite.created', inviteId);
    res.status(201).json({
      invite: {
        id: inviteId,
        code,
        url: `${config.appUrl.replace(/\/$/, '')}/invite/${code}`,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        maxUses: req.body.maxUses || null,
        uses: 0,
        createdAt: new Date(createdAt).toISOString(),
      },
    });
  });

  router.get('/:spaceId/invites', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'create_invites');
    const rows = db
      .prepare(
        `SELECT i.*, u.display_name AS creator_name FROM space_invites i
         JOIN users u ON u.id = i.created_by WHERE i.space_id = ? ORDER BY i.created_at DESC`,
      )
      .all(req.params.spaceId);
    res.json({
      invites: rows
        .filter((row) => !row.expires_at || row.expires_at > now())
        .map((row) => ({
          id: row.id,
          code: row.code,
          url: `${config.appUrl.replace(/\/$/, '')}/invite/${row.code}`,
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          maxUses: row.max_uses,
          uses: row.uses,
          creatorName: row.creator_name,
          createdAt: new Date(row.created_at).toISOString(),
        })),
    });
  });

  router.delete('/:spaceId/invites/:inviteId', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    const invite = db
      .prepare('SELECT * FROM space_invites WHERE id = ? AND space_id = ?')
      .get(req.params.inviteId, req.params.spaceId);
    if (!invite) throw errors.notFound('Convite não encontrado', 'INVITE_NOT_FOUND');
    if (invite.created_by !== req.user.id && !context.permissions.has('manage_space')) {
      throw errors.forbidden('Você não pode revogar este convite', 'FORBIDDEN');
    }
    db.prepare('DELETE FROM space_invites WHERE id = ?').run(invite.id);
    spacesService.logAudit(db, req.params.spaceId, req.user.id, 'invite.revoked', invite.id);
    res.json({ ok: true });
  });

  router.get('/:spaceId/audit', (req, res) => {
    const context = spacesService.getSpaceContext(db, req.params.spaceId, req.user.id);
    spacesService.requirePermission(context, 'view_audit');
    const rows = db
      .prepare(
        `SELECT a.*, u.username, u.display_name FROM space_audit a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.space_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all(req.params.spaceId);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetId: row.target_id,
        details: safeJson(row.details, {}),
        actor: row.actor_id
          ? { id: row.actor_id, username: row.username, displayName: row.display_name }
          : null,
        createdAt: iso(row.created_at),
      })),
    });
  });

  return router;
}

function createChannelsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/:channelId', (req, res) => {
    const { channel, context, membership } = channelContext(db, req.params.channelId, req.user.id);
    if (!membership && !context.permissions.has('manage_channels')) {
      throw errors.forbidden('Você não tem acesso a este canal', 'PRIVATE_CHANNEL');
    }
    const conversation = db.prepare('SELECT * FROM conversations WHERE channel_id = ?').get(channel.id);
    res.json({
      channel: {
        ...spacesService.serializeChannel(channel, conversation?.id || null),
        joined: Boolean(membership),
      },
    });
  });

  router.patch('/:channelId', validate(updateChannelSchema), (req, res) => {
    const { channel, context } = channelContext(db, req.params.channelId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    const fields = [];
    const values = [];
    if (req.body.name !== undefined && req.body.name !== channel.name) {
      const exists = db
        .prepare('SELECT 1 AS ok FROM channels WHERE space_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
        .get(channel.space_id, req.body.name, channel.id);
      if (exists) throw errors.conflict('Já existe um canal com esse nome', 'CHANNEL_EXISTS');
      fields.push('name = ?');
      values.push(req.body.name);
      db.prepare('UPDATE conversations SET title = ? WHERE channel_id = ?').run(
        `#${req.body.name}`,
        channel.id,
      );
    }
    if (req.body.topic !== undefined) {
      fields.push('topic = ?');
      values.push(req.body.topic);
    }
    if (req.body.category !== undefined) {
      fields.push('category = ?');
      values.push(req.body.category);
    }
    if (req.body.position !== undefined) {
      fields.push('position = ?');
      values.push(req.body.position);
    }
    if (fields.length) {
      fields.push('updated_at = ?');
      values.push(now(), channel.id);
      db.prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      spacesService.logAudit(db, channel.space_id, req.user.id, 'channel.updated', channel.id);
      emitToSpace(db, channel.space_id, 'space:updated', { spaceId: channel.space_id });
    }
    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id);
    const conversation = db.prepare('SELECT * FROM conversations WHERE channel_id = ?').get(channel.id);
    res.json({ channel: spacesService.serializeChannel(updated, conversation?.id || null) });
  });

  router.delete('/:channelId', (req, res) => {
    const { channel, context } = channelContext(db, req.params.channelId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    const count = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE space_id = ?').get(channel.space_id).c;
    if (count <= 1) throw errors.badRequest('Um espaço precisa ter pelo menos um canal', 'LAST_CHANNEL');
    const conversation = db.prepare('SELECT id FROM conversations WHERE channel_id = ?').get(channel.id);
    const audience = conversation
      ? db
          .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
          .all(conversation.id)
          .map((row) => row.user_id)
      : [];
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    spacesService.logAudit(db, channel.space_id, req.user.id, 'channel.deleted', channel.id, {
      name: channel.name,
    });
    emitToSpace(db, channel.space_id, 'space:updated', { spaceId: channel.space_id });
    emitToUsers(audience, 'conversation:removed', { conversationId: conversation?.id });
    res.json({ ok: true });
  });

  router.get('/:channelId/members', (req, res) => {
    const { channel, context, conversation, membership } = channelContext(
      db,
      req.params.channelId,
      req.user.id,
    );
    if (!membership && !context.permissions.has('manage_channels')) {
      throw errors.forbidden('Você não tem acesso a este canal', 'PRIVATE_CHANNEL');
    }
    const members = conversation
      ? db
          .prepare(
            `SELECT u.id, u.username, u.display_name, u.avatar_url, u.presence, cm.joined_at
             FROM conversation_members cm JOIN users u ON u.id = cm.user_id
             WHERE cm.conversation_id = ? ORDER BY u.display_name COLLATE NOCASE`,
          )
          .all(conversation.id)
          .map((row) => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            presence: row.presence,
            joinedAt: iso(row.joined_at),
          }))
      : [];
    res.json({ members, channel: spacesService.serializeChannel(channel, conversation?.id || null) });
  });

  router.post('/:channelId/members', validate(addChannelMemberSchema), (req, res) => {
    const { channel, context, conversation } = channelContext(db, req.params.channelId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    if (!spacesService.getMembership(db, channel.space_id, req.body.userId)) {
      throw errors.badRequest('O usuário precisa entrar no espaço primeiro', 'NOT_SPACE_MEMBER');
    }
    if (!conversation) throw errors.notFound('Conversa do canal não encontrada', 'CONVERSATION_NOT_FOUND');
    const existing = conversations.getMembership(db, conversation.id, req.body.userId);
    if (existing) throw errors.conflict('O usuário já está neste canal', 'ALREADY_MEMBER');
    db.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
       VALUES (?, ?, 'member', ?, ?)`,
    ).run(conversation.id, req.body.userId, now(), now());
    emitToSpace(db, channel.space_id, 'space:updated', { spaceId: channel.space_id });
    emitToUsers([req.body.userId], 'channel:added', {
      spaceId: channel.space_id,
      channelId: channel.id,
      conversationId: conversation.id,
    });
    createNotification(db, {
      userId: req.body.userId,
      type: 'channel_added',
      title: `Você foi adicionado a #${channel.name}`,
      body: `No espaço ${context.space.name}`,
      data: { spaceId: channel.space_id, channelId: channel.id },
    });
    res.json({ ok: true });
  });

  router.delete('/:channelId/members/:userId', (req, res) => {
    const { channel, context, conversation } = channelContext(db, req.params.channelId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    if (!conversation) throw errors.notFound('Conversa do canal não encontrada', 'CONVERSATION_NOT_FOUND');
    if (req.params.userId === req.user.id) {
      throw errors.badRequest('Você não pode se remover de um canal que gerencia', 'SELF_REMOVE');
    }
    if (channel.is_private === 0) {
      throw errors.badRequest('Todos os membros do espaço podem acessar canais públicos', 'PUBLIC_CHANNEL');
    }
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
      conversation.id,
      req.params.userId,
    );
    emitToSpace(db, channel.space_id, 'space:updated', { spaceId: channel.space_id });
    emitToUsers([req.params.userId], 'conversation:removed', { conversationId: conversation.id });
    res.json({ ok: true });
  });

  router.post('/:channelId/join', (req, res) => {
    const { channel, context, conversation } = channelContext(db, req.params.channelId, req.user.id);
    spacesService.requirePermission(context, 'manage_channels');
    if (!conversation) throw errors.notFound('Conversa do canal não encontrada', 'CONVERSATION_NOT_FOUND');
    db.prepare(
      `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
       VALUES (?, ?, 'member', ?, ?)`,
    ).run(conversation.id, req.user.id, now(), now());
    emitToSpace(db, channel.space_id, 'space:updated', { spaceId: channel.space_id });
    res.json({ ok: true, conversationId: conversation.id });
  });

  return router;
}

function createInvitesRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.get('/:code', (req, res) => {
    const invite = db
      .prepare(
        `SELECT i.*, s.name, s.description, s.icon_url, s.visibility,
                (SELECT COUNT(*) FROM space_members sm WHERE sm.space_id = s.id) AS member_count
         FROM space_invites i JOIN spaces s ON s.id = i.space_id
         WHERE i.code = ?`,
      )
      .get(req.params.code);
    if (!invite) throw errors.notFound('Convite não encontrado', 'INVITE_NOT_FOUND');
    const expired = invite.expires_at && invite.expires_at <= now();
    const exhausted = invite.max_uses && invite.uses >= invite.max_uses;
    res.json({
      invite: {
        code: invite.code,
        valid: !expired && !exhausted,
        expired,
        exhausted,
        space: {
          id: invite.space_id,
          name: invite.name,
          description: invite.description,
          iconUrl: invite.icon_url,
          visibility: invite.visibility,
          memberCount: invite.member_count,
        },
        expiresAt: invite.expires_at ? new Date(invite.expires_at).toISOString() : null,
      },
    });
  });

  router.post('/:code/join', (req, res) => {
    const invite = db
      .prepare(
        `SELECT i.*, s.name FROM space_invites i JOIN spaces s ON s.id = i.space_id WHERE i.code = ?`,
      )
      .get(req.params.code);
    if (!invite) throw errors.notFound('Convite não encontrado', 'INVITE_NOT_FOUND');
    if (invite.expires_at && invite.expires_at <= now()) {
      throw errors.badRequest('Este convite expirou', 'INVITE_EXPIRED');
    }
    if (invite.max_uses && invite.uses >= invite.max_uses) {
      throw errors.badRequest('Este convite atingiu o limite de uso', 'INVITE_EXHAUSTED');
    }
    const banned = db
      .prepare('SELECT 1 AS ok FROM space_bans WHERE space_id = ? AND user_id = ?')
      .get(invite.space_id, req.user.id);
    if (banned) throw errors.forbidden('Você está banido deste espaço', 'BANNED');
    const existing = spacesService.getMembership(db, invite.space_id, req.user.id);
    if (!existing) {
      transaction(db, () => {
        spacesService.addSpaceMember(db, invite.space_id, req.user.id);
        db.prepare('UPDATE space_invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
      });
      announce(db, invite.space_id, `${req.user.display_name} entrou no espaço`);
      emitToSpace(db, invite.space_id, 'space:member-joined', {
        spaceId: invite.space_id,
        userId: req.user.id,
      });
    }
    const space = spacesService.getSpace(db, invite.space_id);
    const context = spacesService.getSpaceContext(db, invite.space_id, req.user.id);
    res.json({ space: spacesService.serializeSpace(space, context, { joined: true }) });
  });

  return router;
}

module.exports = { createSpacesRouter, createChannelsRouter, createInvitesRouter };
