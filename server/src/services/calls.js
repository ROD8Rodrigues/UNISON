'use strict';

const { id, now, transaction, iso } = require('../utils/helpers');
const { errors } = require('../utils/errors');
const { assertAccess, listMembers } = require('./conversations');
const { createSystemMessage } = require('./messages');
const { emitToUsers } = require('../realtime/bus');

function getCall(db, callId) {
  return db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
}

function getParticipants(db, callId) {
  return db
    .prepare(
      `SELECT cp.*, u.username, u.display_name, u.avatar_url, u.presence
       FROM call_participants cp JOIN users u ON u.id = cp.user_id
       WHERE cp.call_id = ? ORDER BY cp.joined_at ASC`,
    )
    .all(callId);
}

function serializeCall(db, row) {
  if (!row) return null;
  const participants = getParticipants(db, row.id).map((participant) => ({
    userId: participant.user_id,
    username: participant.username,
    displayName: participant.display_name,
    avatarUrl: participant.avatar_url,
    presence: participant.presence,
    status: participant.status,
    joinedAt: iso(participant.joined_at),
    leftAt: iso(participant.left_at),
  }));
  return {
    id: row.id,
    conversationId: row.conversation_id,
    initiatorId: row.initiator_id,
    kind: row.kind,
    status: row.status,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    participants,
  };
}

function activeCallForConversation(db, conversationId) {
  return db
    .prepare(
      "SELECT * FROM calls WHERE conversation_id = ? AND status IN ('ringing', 'active') ORDER BY created_at DESC LIMIT 1",
    )
    .get(conversationId);
}

function startCall(db, conversationId, initiatorId, kind) {
  const { conversation } = assertAccess(db, conversationId, initiatorId);
  if (!['dm', 'group'].includes(conversation.type)) {
    throw errors.badRequest('Chamadas estão disponíveis em conversas diretas e grupos', 'CALL_NOT_ALLOWED');
  }
  if (activeCallForConversation(db, conversationId)) {
    throw errors.conflict('Já existe uma chamada ativa nesta conversa', 'CALL_ACTIVE');
  }
  const members = listMembers(db, conversationId);
  if (members.length > 9) {
    throw errors.badRequest('Chamadas em grupo suportam até 9 participantes', 'CALL_TOO_LARGE');
  }
  const callId = id();
  const createdAt = now();
  transaction(db, () => {
    db.prepare(
      `INSERT INTO calls (id, conversation_id, initiator_id, kind, status, created_at)
       VALUES (?, ?, ?, ?, 'ringing', ?)`,
    ).run(callId, conversationId, initiatorId, kind, createdAt);
    const insert = db.prepare(
      `INSERT INTO call_participants (call_id, user_id, status, joined_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const member of members) {
      if (member.user_id === initiatorId) insert.run(callId, initiatorId, 'joined', createdAt);
      else insert.run(callId, member.user_id, 'invited', null);
    }
  });
  return serializeCall(db, getCall(db, callId));
}

function acceptCall(db, callId, userId) {
  const call = getCall(db, callId);
  if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
  if (call.status === 'ended' || call.status === 'declined') {
    throw errors.badRequest('Esta chamada terminou', 'CALL_ENDED');
  }
  const participant = db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
    .get(callId, userId);
  if (!participant) throw errors.forbidden('Você não foi convidado para esta chamada', 'NOT_INVITED');
  if (participant.status === 'joined') return serializeCall(db, call);
  const timestamp = now();
  db.prepare(
    "UPDATE call_participants SET status = 'joined', joined_at = ? WHERE call_id = ? AND user_id = ?",
  ).run(timestamp, callId, userId);
  db.prepare("UPDATE calls SET status = 'active', started_at = COALESCE(started_at, ?) WHERE id = ?").run(
    timestamp,
    callId,
  );
  return serializeCall(db, getCall(db, callId));
}

function rejectCall(db, callId, userId) {
  const call = getCall(db, callId);
  if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
  db.prepare(
    "UPDATE call_participants SET status = 'declined' WHERE call_id = ? AND user_id = ? AND status = 'invited'",
  ).run(callId, userId);
  const remaining = db
    .prepare(
      "SELECT COUNT(*) AS count FROM call_participants WHERE call_id = ? AND status IN ('invited', 'joined')",
    )
    .get(callId).count;
  if (remaining === 0) {
    db.prepare("UPDATE calls SET status = 'declined', ended_at = ? WHERE id = ?").run(now(), callId);
    const finished = getCall(db, callId);
    try {
      createSystemMessage(db, call.conversation_id, callSummary(serializeCall(db, finished)));
    } catch {
      // best-effort
    }
  }
  return serializeCall(db, getCall(db, callId));
}

function missedCall(db, callId, userId) {
  db.prepare(
    "UPDATE call_participants SET status = 'missed' WHERE call_id = ? AND user_id = ? AND status = 'invited'",
  ).run(callId, userId);
  return serializeCall(db, getCall(db, callId));
}

function callSummary(call) {
  const label = call.kind === 'video' ? 'chamada de vídeo' : 'chamada de áudio';
  if (call.status === 'declined') return `${label} recusada`;
  if (!call.started_at) return `${label} não atendida`;
  const seconds = Math.max(1, Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000));
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60}s` : `${seconds}s`;
  return `${label} · ${duration}`;
}

function endCall(db, callId, userId, reason = 'left') {
  const call = getCall(db, callId);
  if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
  const participant = db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
    .get(callId, userId);
  if (!participant) throw errors.forbidden('Você não faz parte desta chamada', 'NOT_IN_CALL');
  const timestamp = now();
  db.prepare(
    "UPDATE call_participants SET status = 'left', left_at = ? WHERE call_id = ? AND user_id = ? AND status = 'joined'",
  ).run(timestamp, callId, userId);
  db.prepare(
    "UPDATE call_participants SET status = 'missed' WHERE call_id = ? AND status = 'invited'",
  ).run(callId);
  const joined = db
    .prepare("SELECT COUNT(*) AS count FROM call_participants WHERE call_id = ? AND status = 'joined'")
    .get(callId).count;
  if (joined === 0) {
    const status = call.started_at ? 'ended' : 'declined';
    db.prepare("UPDATE calls SET status = ?, ended_at = ? WHERE id = ?").run(status, timestamp, callId);
    const finished = getCall(db, callId);
    const summary = callSummary(serializeCall(db, finished));
    try {
      createSystemMessage(db, call.conversation_id, summary);
    } catch {
      // System call message is best-effort.
    }
    emitToUsers(
      listMembers(db, call.conversation_id).map((member) => member.user_id),
      'call:ended',
      { callId, reason: status === 'declined' ? 'missed' : reason },
    );
  }
  return serializeCall(db, getCall(db, callId));
}

function endCallForAll(db, callId, reason = 'ended') {
  const call = getCall(db, callId);
  if (!call || call.status === 'ended' || call.status === 'declined') return null;
  const timestamp = now();
  db.prepare(
    "UPDATE call_participants SET status = 'left', left_at = ? WHERE call_id = ? AND status = 'joined'",
  ).run(timestamp, callId);
  db.prepare(
    "UPDATE call_participants SET status = 'missed' WHERE call_id = ? AND status = 'invited'",
  ).run(callId);
  db.prepare("UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ?").run(timestamp, callId);
  const finished = getCall(db, callId);
  const summary = callSummary(serializeCall(db, finished));
  try {
    createSystemMessage(db, call.conversation_id, summary);
  } catch {
    // best-effort
  }
  emitToUsers(
    listMembers(db, call.conversation_id).map((member) => member.user_id),
    'call:ended',
    { callId, reason },
  );
  return serializeCall(db, finished);
}

function historyForUser(db, userId, limit = 30) {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.* FROM calls c
       JOIN call_participants cp ON cp.call_id = c.id
       WHERE cp.user_id = ? ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(userId, limit);
  return rows.map((row) => serializeCall(db, row));
}

module.exports = {
  getCall,
  getParticipants,
  serializeCall,
  activeCallForConversation,
  startCall,
  acceptCall,
  rejectCall,
  missedCall,
  endCall,
  endCallForAll,
  historyForUser,
  callSummary,
};
