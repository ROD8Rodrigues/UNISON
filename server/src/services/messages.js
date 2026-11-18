'use strict';

const { id, now, transaction, escapeLike, iso } = require('../utils/helpers');
const { errors } = require('../utils/errors');
const { assertAccess, listMembers } = require('./conversations');
const { getSpaceContext, requirePermission } = require('./spaces');
const { createNotification } = require('./users');
const { emitToUsers } = require('../realtime/bus');

const PREVIEW_LENGTH = 120;

function previewOf(content, attachments) {
  const clean = String(content || '').replace(/\s+/g, ' ').trim();
  if (clean) return clean.slice(0, PREVIEW_LENGTH);
  if (attachments && attachments.length) return '📎 Anexo';
  return '';
}

function latestMessage(db, conversationId) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(conversationId);
}

function refreshConversationPreview(db, conversationId) {
  const latest = latestMessage(db, conversationId);
  if (latest) {
    const attachments = db
      .prepare('SELECT original_name FROM attachments WHERE message_id = ? LIMIT 1')
      .all(latest.id);
    db.prepare(
      'UPDATE conversations SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE id = ?',
    ).run(latest.created_at, previewOf(latest.content, attachments), now(), conversationId);
  } else {
    db.prepare(
      'UPDATE conversations SET last_message_at = NULL, last_message_preview = NULL, updated_at = ? WHERE id = ?',
    ).run(now(), conversationId);
  }
}

function canModerate(db, conversation, membership, senderId, viewerId) {
  if (senderId === viewerId) return true;
  if (conversation.type === 'dm') return false;
  if (conversation.type === 'group') return ['owner', 'admin'].includes(membership.role);
  if (conversation.type === 'channel') {
    try {
      const context = getSpaceContext(db, conversation.space_id, viewerId);
      return context.permissions.has('manage_messages');
    } catch {
      return false;
    }
  }
  return false;
}

function assertCanSend(db, conversation, membership, userId) {
  if (conversation.type === 'channel') {
    const context = getSpaceContext(db, conversation.space_id, userId);
    requirePermission(context, 'send_messages');
  } else if (conversation.type === 'dm') {
    const other = db
      .prepare(
        `SELECT u.id FROM conversation_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.conversation_id = ? AND cm.user_id <> ?`,
      )
      .get(conversation.id, userId);
    if (other) {
      const blocked = db
        .prepare(
          'SELECT 1 AS ok FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
        )
        .get(userId, other.id, other.id, userId);
      if (blocked) throw errors.forbidden('Esta conversa está bloqueada', 'BLOCKED');
    }
  }
  return membership;
}

function serializeMessageRows(db, rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const senderIds = [...new Set(rows.map((row) => row.sender_id).filter(Boolean))];
  const senders = new Map();
  if (senderIds.length) {
    const senderRows = db
      .prepare(
        `SELECT id, username, display_name, avatar_url, presence FROM users
         WHERE id IN (${senderIds.map(() => '?').join(',')})`,
      )
      .all(...senderIds);
    for (const sender of senderRows) senders.set(sender.id, sender);
  }

  const replyIds = [...new Set(rows.map((row) => row.reply_to_id).filter(Boolean))];
  const replies = new Map();
  if (replyIds.length) {
    const replyRows = db
      .prepare(
        `SELECT m.id, m.content, m.deleted_at, u.username, u.display_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.id IN (${replyIds.map(() => '?').join(',')})`,
      )
      .all(...replyIds);
    for (const reply of replyRows) replies.set(reply.id, reply);
  }

  const attachmentRows = db
    .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...ids);
  const attachmentsByMessage = new Map();
  for (const attachment of attachmentRows) {
    if (!attachmentsByMessage.has(attachment.message_id)) {
      attachmentsByMessage.set(attachment.message_id, []);
    }
    attachmentsByMessage.get(attachment.message_id).push({
      id: attachment.id,
      name: attachment.original_name,
      mimeType: attachment.mime_type,
      size: attachment.size,
      url: `/uploads/${attachment.filename}`,
    });
  }

  const reactionRows = db
    .prepare(
      `SELECT r.message_id, r.emoji, r.user_id, r.created_at, u.username, u.display_name
       FROM reactions r JOIN users u ON u.id = r.user_id
       WHERE r.message_id IN (${placeholders})
       ORDER BY r.created_at ASC`,
    )
    .all(...ids);
  const reactionsByMessage = new Map();
  for (const reaction of reactionRows) {
    if (!reactionsByMessage.has(reaction.message_id)) {
      reactionsByMessage.set(reaction.message_id, new Map());
    }
    const emojiMap = reactionsByMessage.get(reaction.message_id);
    if (!emojiMap.has(reaction.emoji)) {
      emojiMap.set(reaction.emoji, { emoji: reaction.emoji, users: [] });
    }
    emojiMap.get(reaction.emoji).users.push({
      id: reaction.user_id,
      username: reaction.username,
      displayName: reaction.display_name,
    });
  }

  const readRows = db
    .prepare(
      `SELECT m.id AS message_id,
        (SELECT COUNT(*) FROM conversation_members cm
          JOIN user_settings us ON us.user_id = cm.user_id
          WHERE cm.conversation_id = m.conversation_id AND cm.user_id <> m.sender_id
            AND cm.last_read_at IS NOT NULL AND cm.last_read_at >= m.created_at
            AND us.privacy_read_receipts = 1) AS read_count,
        (SELECT COUNT(*) FROM conversation_members cm
          WHERE cm.conversation_id = m.conversation_id AND cm.user_id <> m.sender_id) AS recipient_count
       FROM messages m WHERE m.id IN (${placeholders})`,
    )
    .all(...ids);
  const readMap = new Map(readRows.map((row) => [row.message_id, row]));

  const pinRows = db
    .prepare(`SELECT message_id FROM pins WHERE message_id IN (${placeholders})`)
    .all(...ids);
  const pinned = new Set(pinRows.map((row) => row.message_id));

  return rows.map((row) => {
    const sender = row.sender_id ? senders.get(row.sender_id) : null;
    const reply = row.reply_to_id ? replies.get(row.reply_to_id) : null;
    const deleted = Boolean(row.deleted_at);
    const read = readMap.get(row.id) || { read_count: 0, recipient_count: 0 };
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      sender: sender
        ? {
            id: sender.id,
            username: sender.username,
            displayName: sender.display_name,
            avatarUrl: sender.avatar_url,
            presence: sender.presence,
          }
        : null,
      content: deleted ? '' : row.content,
      kind: row.kind,
      deleted,
      edited: Boolean(row.edited_at),
      replyTo: reply
        ? {
            id: reply.id,
            content: reply.deleted_at ? '' : reply.content,
            deleted: Boolean(reply.deleted_at),
            username: reply.username,
            displayName: reply.display_name,
          }
        : null,
      attachments: deleted ? [] : attachmentsByMessage.get(row.id) || [],
      reactions: deleted
        ? []
        : [...(reactionsByMessage.get(row.id)?.values() || [])].map((reaction) => ({
            emoji: reaction.emoji,
            count: reaction.users.length,
            users: reaction.users,
          })),
      pinned: pinned.has(row.id),
      readByCount: deleted ? 0 : read.read_count,
      recipientCount: read.recipient_count,
      createdAt: iso(row.created_at),
      editedAt: iso(row.edited_at),
      deletedAt: iso(row.deleted_at),
    };
  });
}

function listMessages(db, conversationId, userId, { before, limit = 50, query } = {}) {
  assertAccess(db, conversationId, userId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  if (query) {
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
         AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      )
      .all(conversationId, `%${escapeLike(query)}%`, safeLimit);
    return {
      messages: serializeMessageRows(db, rows.slice().reverse()),
      hasMore: false,
      nextCursor: null,
      search: true,
    };
  }
  const params = [conversationId];
  let where = 'm.conversation_id = ?';
  if (before) {
    where += ' AND m.created_at < ?';
    params.push(Number(before));
  }
  params.push(safeLimit + 1);
  const rows = db
    .prepare(`SELECT * FROM messages m WHERE ${where} ORDER BY m.created_at DESC LIMIT ?`)
    .all(...params);
  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;
  page.reverse();
  return {
    messages: serializeMessageRows(db, page),
    hasMore,
    nextCursor: hasMore && page.length ? page[0].created_at : null,
    search: false,
  };
}

function getMessage(db, messageId, conversationId) {
  return db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId);
}

function verifyAttachments(db, attachmentIds, uploaderId) {
  if (!attachmentIds || attachmentIds.length === 0) return [];
  const unique = [...new Set(attachmentIds)];
  const rows = db
    .prepare(
      `SELECT * FROM attachments WHERE id IN (${unique.map(() => '?').join(',')})
       AND uploader_id = ? AND message_id IS NULL`,
    )
    .all(...unique, uploaderId);
  if (rows.length !== unique.length) {
    throw errors.badRequest('Um ou mais anexos são inválidos ou já foram usados', 'INVALID_ATTACHMENTS');
  }
  return rows;
}

function findMentionedMembers(db, conversationId, content, senderId) {
  const matches = new Set(
    [...String(content).matchAll(/@([a-z0-9_.]{3,24})/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  if (matches.size === 0) return [];
  const members = listMembers(db, conversationId);
  return members.filter(
    (member) => member.user_id !== senderId && matches.has(String(member.username).toLowerCase()),
  );
}

function notifyMessage(db, conversation, senderId, message, sender, mentioned) {
  const senderName = sender.display_name || sender.username;
  const members = listMembers(db, conversation.id).filter((member) => member.user_id !== senderId);
  const mentionedIds = new Set(mentioned.map((member) => member.user_id));
  const recipients = [];
  for (const member of members) {
    if (member.member_muted) continue;
    if (conversation.type === 'dm') recipients.push({ member, mention: false });
    else if (mentionedIds.has(member.user_id)) recipients.push({ member, mention: true });
    else if (conversation.type === 'group') recipients.push({ member, mention: false });
  }
  if (recipients.length === 0) return;
  const channel = conversation.channel_id
    ? db.prepare('SELECT name FROM channels WHERE id = ?').get(conversation.channel_id)
    : null;
  for (const { member, mention } of recipients) {
    const settings = db
      .prepare('SELECT message_previews FROM user_settings WHERE user_id = ?')
      .get(member.user_id);
    const preview = settings && settings.message_previews
      ? previewOf(message.content, message.attachments)
      : 'Você recebeu uma nova mensagem';
    const title = mention
      ? `${senderName} mencionou você${channel ? ` em #${channel.name}` : ''}`
      : channel
        ? `${senderName} em #${channel.name}`
        : senderName;
    const notification = createNotification(db, {
      userId: member.user_id,
      type: mention ? 'mention' : 'message',
      title,
      body: preview,
      data: {
        conversationId: conversation.id,
        messageId: message.id,
        spaceId: conversation.space_id || null,
        channelId: conversation.channel_id || null,
      },
    });
    emitToUsers([member.user_id], 'notification:new', { notification });
  }
}

function createMessage(db, conversationId, senderId, input) {
  const { conversation, membership } = assertAccess(db, conversationId, senderId);
  assertCanSend(db, conversation, membership, senderId);

  const content = String(input.content || '').trim();
  const attachmentIds = input.attachmentIds || [];
  if (!content && attachmentIds.length === 0) {
    throw errors.badRequest('A mensagem precisa ter conteúdo ou um anexo', 'EMPTY_MESSAGE');
  }
  if (content.length > 4000) throw errors.badRequest('A mensagem é muito longa', 'MESSAGE_TOO_LONG');

  if (input.replyToId) {
    const reply = getMessage(db, input.replyToId, conversationId);
    if (!reply || reply.deleted_at) {
      throw errors.badRequest('A mensagem respondida não está disponível', 'INVALID_REPLY');
    }
  }

  const attachments = verifyAttachments(db, attachmentIds, senderId);
  const sender = db.prepare('SELECT * FROM users WHERE id = ?').get(senderId);
  const messageId = id();
  const createdAt = now();

  transaction(db, () => {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, content, kind, reply_to_id, created_at)
       VALUES (?, ?, ?, ?, 'text', ?, ?)`,
    ).run(messageId, conversationId, senderId, content, input.replyToId || null, createdAt);
    const attach = db.prepare('UPDATE attachments SET message_id = ? WHERE id = ?');
    for (const attachment of attachments) attach.run(messageId, attachment.id);
    db.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ?').run(
      conversationId,
    );
    db.prepare(
      'UPDATE conversations SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE id = ?',
    ).run(createdAt, previewOf(content, attachments), createdAt, conversationId);
  });

  const row = getMessage(db, messageId, conversationId);
  const [message] = serializeMessageRows(db, [row]);
  const mentioned = findMentionedMembers(db, conversationId, content, senderId);

  emitToUsers(
    listMembers(db, conversationId).map((member) => member.user_id),
    'message:new',
    { message },
  );
  notifyMessage(db, conversation, senderId, message, sender, mentioned);
  return message;
}

function createSystemMessage(db, conversationId, content) {
  const messageId = id();
  const createdAt = now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, content, kind, created_at)
     VALUES (?, ?, NULL, ?, 'system', ?)`,
  ).run(messageId, conversationId, content, createdAt);
  db.prepare(
    'UPDATE conversations SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE id = ?',
  ).run(createdAt, previewOf(content), createdAt, conversationId);
  const row = getMessage(db, messageId, conversationId);
  const [message] = serializeMessageRows(db, [row]);
  const members = listMembers(db, conversationId).map((member) => member.user_id);
  emitToUsers(members, 'message:new', { message });
  return message;
}

function editMessage(db, messageId, userId, content) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw errors.notFound('Mensagem não encontrada', 'MESSAGE_NOT_FOUND');
  const { conversation } = assertAccess(db, message.conversation_id, userId);
  if (message.sender_id !== userId) {
    throw errors.forbidden('Você só pode editar suas próprias mensagens', 'NOT_SENDER');
  }
  if (message.deleted_at) throw errors.badRequest('Mensagens apagadas não podem ser editadas', 'MESSAGE_DELETED');
  const trimmed = String(content).trim();
  if (!trimmed) throw errors.badRequest('A mensagem não pode ficar vazia', 'EMPTY_MESSAGE');
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(trimmed, now(), messageId);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  const [serialized] = serializeMessageRows(db, [row]);
  const members = listMembers(db, conversation.id).map((member) => member.user_id);
  emitToUsers(members, 'message:updated', { message: serialized });
  return serialized;
}

function deleteMessage(db, messageId, userId) {
  const message = db
    .prepare(
      `SELECT m.*, c.type AS conversation_type FROM messages m
       JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?`,
    )
    .get(messageId);
  if (!message) throw errors.notFound('Mensagem não encontrada', 'MESSAGE_NOT_FOUND');
  const { conversation, membership } = assertAccess(db, message.conversation_id, userId);
  if (message.sender_id !== userId && !canModerate(db, conversation, membership, message.sender_id, userId)) {
    throw errors.forbidden('Você não pode apagar esta mensagem', 'FORBIDDEN');
  }
  if (!message.deleted_at) {
    db.prepare('UPDATE messages SET deleted_at = ?, content = ? WHERE id = ?').run(now(), '', messageId);
    refreshConversationPreview(db, message.conversation_id);
  }
  const members = listMembers(db, conversation.id).map((member) => member.user_id);
  emitToUsers(members, 'message:deleted', {
    conversationId: message.conversation_id,
    messageId,
  });
  return { id: messageId, deleted: true };
}

function toggleReaction(db, messageId, userId, emoji) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw errors.notFound('Mensagem não encontrada', 'MESSAGE_NOT_FOUND');
  const { conversation } = assertAccess(db, message.conversation_id, userId);
  if (message.deleted_at) throw errors.badRequest('Mensagens apagadas não podem receber reações');
  const existing = db
    .prepare('SELECT 1 AS ok FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .get(messageId, userId, emoji);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(
      messageId,
      userId,
      emoji,
    );
  } else {
    db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(
      messageId,
      userId,
      emoji,
      now(),
    );
  }
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  const [serialized] = serializeMessageRows(db, [row]);
  const members = listMembers(db, conversation.id).map((member) => member.user_id);
  emitToUsers(members, 'message:updated', { message: serialized });
  return serialized;
}

function togglePin(db, messageId, userId, pinned) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw errors.notFound('Mensagem não encontrada', 'MESSAGE_NOT_FOUND');
  const { conversation, membership } = assertAccess(db, message.conversation_id, userId);
  if (conversation.type === 'channel') {
    const context = getSpaceContext(db, conversation.space_id, userId);
    requirePermission(context, 'manage_messages');
  } else if (conversation.type === 'group' && !['owner', 'admin'].includes(membership.role)) {
    throw errors.forbidden('Apenas administradores do grupo podem fixar mensagens');
  }
  if (pinned) {
    db.prepare('INSERT OR IGNORE INTO pins (conversation_id, message_id, pinned_by, created_at) VALUES (?, ?, ?, ?)').run(
      message.conversation_id,
      messageId,
      userId,
      now(),
    );
  } else {
    db.prepare('DELETE FROM pins WHERE conversation_id = ? AND message_id = ?').run(
      message.conversation_id,
      messageId,
    );
  }
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  const [serialized] = serializeMessageRows(db, [row]);
  const members = listMembers(db, conversation.id).map((member) => member.user_id);
  emitToUsers(members, 'message:updated', { message: serialized });
  return serialized;
}

function listPinned(db, conversationId, userId) {
  assertAccess(db, conversationId, userId);
  const rows = db
    .prepare(
      `SELECT m.* FROM pins p JOIN messages m ON m.id = p.message_id
       WHERE p.conversation_id = ? AND m.deleted_at IS NULL ORDER BY p.created_at DESC`,
    )
    .all(conversationId);
  return serializeMessageRows(db, rows.reverse());
}

module.exports = {
  assertCanSend,
  serializeMessageRows,
  listMessages,
  createMessage,
  createSystemMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  togglePin,
  listPinned,
  refreshConversationPreview,
  previewOf,
};
