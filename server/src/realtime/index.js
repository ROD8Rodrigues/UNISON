'use strict';

const { Server } = require('socket.io');
const config = require('../config');
const logger = require('../logger');
const { resolveSessionUser } = require('../services/auth');
const { assertAccess, listMembers, getConversation } = require('../services/conversations');
const { getSpaceContext } = require('../services/spaces');
const { serializeUser } = require('../services/users');
const calls = require('../services/calls');
const presence = require('../realtime/presence');
const bus = require('../realtime/bus');
const { errors } = require('../utils/errors');

const TYPING_TIMEOUT_MS = 6000;
const CALL_RING_TIMEOUT_MS = 45000;

function socketCors() {
  return {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  };
}

function voiceSpaceId(db, call) {
  const channelId = call?.channelId || call?.channel_id;
  if (!channelId) return null;
  const row = db.prepare('SELECT space_id FROM channels WHERE id = ?').get(channelId);
  return row ? row.space_id : null;
}

function ackError(ack, error) {
  if (typeof ack !== 'function') return;
  const status = error.status || 500;
  ack({
    error: {
      code: error.code || 'INTERNAL',
      message: status >= 500 ? 'Erro interno do servidor' : error.message,
    },
  });
}

function allow(socket, bucket, limit, windowMs = 60000) {
  socket.data.buckets = socket.data.buckets || {};
  const timestamp = Date.now();
  let state = socket.data.buckets[bucket];
  if (!state || timestamp - state.startedAt > windowMs) {
    state = { startedAt: timestamp, count: 0 };
    socket.data.buckets[bucket] = state;
  }
  state.count += 1;
  return state.count <= limit;
}

function attachRealtime(server, db) {
  const io = new Server(server, {
    cors: socketCors(),
    maxHttpBufferSize: 1_000_000,
    pingTimeout: 25000,
    pingInterval: 20000,
  });
  bus.setIo(io);

  const callTimers = new Map();

  function clearCallTimer(callId) {
    const timer = callTimers.get(callId);
    if (timer) clearTimeout(timer);
    callTimers.delete(callId);
  }

  function scheduleCallTimeout(callId) {
    clearCallTimer(callId);
    const timer = setTimeout(() => {
      callTimers.delete(callId);
      try {
        const call = calls.getCall(db, callId);
        if (!call || call.status !== 'ringing') return;
        calls.endCallForAll(db, callId, 'no-answer');
      } catch (error) {
        logger.warn('Call timeout cleanup failed', { callId, message: error.message });
      }
    }, CALL_RING_TIMEOUT_MS);
    timer.unref?.();
    callTimers.set(callId, timer);
  }

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Autenticação necessária'));
      const auth = resolveSessionUser(db, config, token);
      socket.data.user = auth.user;
      socket.data.sessionId = auth.sessionId;
      next();
    } catch {
      next(new Error('Falha na autenticação'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(bus.userRoom(user.id));
    socket.join(bus.sessionRoom(socket.data.sessionId));
    socket.data.typingConversations = new Map();
    presence.connectionOpened(db, user.id, socket.id);
    socket.emit('socket:ready', {
      userId: user.id,
      serverTime: new Date().toISOString(),
    });

    socket.on('presence:set', async (payload, ack) => {
      try {
        if (!['online', 'away', 'dnd', 'offline'].includes(payload?.presence)) {
          throw errors.badRequest('Status de presença inválido');
        }
        const state = presence.setPresence(db, user.id, payload.presence);
        if (typeof ack === 'function') ack({ ok: true, ...state });
      } catch (error) {
        ackError(ack, error);
      }
    });

    function stopTyping(conversationId) {
      const timer = socket.data.typingConversations.get(conversationId);
      if (timer) clearTimeout(timer);
      socket.data.typingConversations.delete(conversationId);
      const conversation = getConversation(db, conversationId);
      if (!conversation) return;
      bus.emitToUsers(
        listMembers(db, conversationId)
          .map((member) => member.user_id)
          .filter((userId) => userId !== user.id),
        'typing:update',
        { conversationId, userId: user.id, username: user.username, isTyping: false },
      );
    }

    socket.on('typing:start', (payload, ack) => {
      try {
        if (!allow(socket, 'typing', 120)) throw errors.tooMany('Vá com calma');
        const conversationId = payload?.conversationId;
        if (!conversationId) throw errors.badRequest('conversationId é obrigatório');
        assertAccess(db, conversationId, user.id);
        const settings = db
          .prepare('SELECT privacy_typing FROM user_settings WHERE user_id = ?')
          .get(user.id);
        if (settings && !settings.privacy_typing) {
          if (typeof ack === 'function') ack({ ok: true });
          return;
        }
        const key = conversationId;
        const existing = socket.data.typingConversations.get(key);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          try {
            stopTyping(conversationId);
          } catch {
            // ignore
          }
        }, TYPING_TIMEOUT_MS);
        timer.unref?.();
        socket.data.typingConversations.set(key, timer);
        bus.emitToUsers(
          listMembers(db, conversationId)
            .map((member) => member.user_id)
            .filter((userId) => userId !== user.id),
          'typing:update',
          { conversationId, userId: user.id, username: user.username, isTyping: true },
        );
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('typing:stop', (payload, ack) => {
      try {
        if (payload?.conversationId) stopTyping(payload.conversationId);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('conversation:read', (payload, ack) => {
      try {
        if (!payload?.conversationId) throw errors.badRequest('conversationId é obrigatório');
        const { markRead } = require('../services/conversations');
        markRead(db, payload.conversationId, user.id, payload.messageId);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:start', (payload, ack) => {
      try {
        if (!allow(socket, 'calls', 12)) throw errors.tooMany('Muitas tentativas de chamada');
        const conversationId = payload?.conversationId;
        const kind = payload?.kind;
        if (!conversationId || !['audio', 'video'].includes(kind)) {
          throw errors.badRequest('conversationId e kind são obrigatórios');
        }
        const conversation = getConversation(db, conversationId);
        if (conversation?.type === 'dm') {
          const other = db
            .prepare(
              `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?`,
            )
            .get(conversationId, user.id);
          if (other) {
            const blocked = db
              .prepare(
                'SELECT 1 AS ok FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
              )
              .get(user.id, other.user_id, other.user_id, user.id);
            if (blocked) throw errors.forbidden('Esta conversa está bloqueada', 'BLOCKED');
          }
        }
        const call = calls.startCall(db, conversationId, user.id, kind);
        scheduleCallTimeout(call.id);
        const caller = serializeUser(user);
        const memberIds = listMembers(db, conversationId).map((member) => member.user_id);
        bus.emitToUsers(
          memberIds.filter((memberId) => memberId !== user.id),
          'call:incoming',
          {
            call,
            caller,
            conversationId,
            conversationType: conversation?.type || 'dm',
            conversationTitle: conversation?.title || null,
          },
        );
        if (typeof ack === 'function') ack({ call });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:join-voice', (payload, ack) => {
      try {
        if (!allow(socket, 'calls', 30)) throw errors.tooMany('Vá com calma');
        const channelId = payload?.channelId;
        if (!channelId) throw errors.badRequest('channelId é obrigatório');
        const { call, participants } = calls.joinVoiceCall(db, channelId, user.id);
        socket.join(`call:${call.id}`);
        bus.emitToUsers(
          participants.map((participant) => participant.userId),
          'call:participant-joined',
          {
            callId: call.id,
            participant: serializeUser(user),
            participants,
            call,
          },
          user.id,
        );
        const spaceId = voiceSpaceId(db, call);
        if (spaceId) bus.emitToSpace(db, spaceId, 'space:updated', { spaceId });
        if (typeof ack === 'function') ack({ call, participants });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:accept', (payload, ack) => {
      try {
        if (!allow(socket, 'calls', 30)) throw errors.tooMany('Vá com calma');
        const call = calls.getCall(db, payload?.callId);
        if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
        const updated = calls.acceptCall(db, call.id, user.id);
        clearCallTimer(call.id);
        socket.join(`call:${call.id}`);
        const participants = updated.participants.filter((participant) => participant.status === 'joined');
        bus.emitToUsers(
          participants.map((participant) => participant.userId),
          'call:participant-joined',
          {
            callId: call.id,
            participant: serializeUser(user),
            participants,
            call: updated,
          },
        );
        if (typeof ack === 'function') ack({ call: updated, participants });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:reject', (payload, ack) => {
      try {
        const call = calls.getCall(db, payload?.callId);
        if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
        const updated = calls.rejectCall(db, call.id, user.id);
        if (updated.status === 'declined') clearCallTimer(call.id);
        const joined = updated.participants.filter((participant) => participant.status === 'joined');
        bus.emitToUsers(
          [...joined.map((participant) => participant.userId), call.initiator_id],
          'call:participant-declined',
          { callId: call.id, participant: serializeUser(user), call: updated },
        );
        if (updated.status === 'declined') {
          bus.emitToUsers(
            listMembers(db, call.conversation_id).map((member) => member.user_id),
            'call:ended',
            { callId: call.id, reason: 'declined' },
          );
        }
        if (typeof ack === 'function') ack({ call: updated });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:leave', (payload, ack) => {
      try {
        const call = calls.getCall(db, payload?.callId);
        if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
        const updated = calls.endCall(db, call.id, user.id);
        socket.leave(`call:${call.id}`);
        if (updated.status === 'ended' || updated.status === 'declined') clearCallTimer(call.id);
        else {
          const joined = updated.participants.filter((participant) => participant.status === 'joined');
          bus.emitToUsers(
            joined.map((participant) => participant.userId),
            'call:participant-left',
            { callId: call.id, userId: user.id, call: updated },
          );
        }
        const spaceId = voiceSpaceId(db, call);
        if (spaceId) bus.emitToSpace(db, spaceId, 'space:updated', { spaceId });
        if (typeof ack === 'function') ack({ call: updated });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:end', (payload, ack) => {
      try {
        const call = calls.getCall(db, payload?.callId);
        if (!call) throw errors.notFound('Chamada não encontrada', 'CALL_NOT_FOUND');
        const isParticipant = db
          .prepare('SELECT 1 AS ok FROM call_participants WHERE call_id = ? AND user_id = ?')
          .get(call.id, user.id);
        if (!isParticipant) throw errors.forbidden('Você não está nesta chamada');
        const updated = calls.endCallForAll(db, call.id, 'ended');
        clearCallTimer(call.id);
        socket.leave(`call:${call.id}`);
        const spaceId = voiceSpaceId(db, call);
        if (spaceId) bus.emitToSpace(db, spaceId, 'space:updated', { spaceId });
        if (typeof ack === 'function') ack({ call: updated });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('webrtc:signal', (payload, ack) => {
      try {
        if (!allow(socket, 'signals', 600)) throw errors.tooMany('Muitas mensagens de sinalização');
        const { callId, targetUserId, signal } = payload || {};
        if (!callId || !targetUserId || !signal || typeof signal !== 'object') {
          throw errors.badRequest('callId, targetUserId e signal são obrigatórios');
        }
        const call = calls.getCall(db, callId);
        if (!call || !['ringing', 'active'].includes(call.status)) {
          throw errors.badRequest('A chamada não está ativa', 'CALL_INACTIVE');
        }
        const sender = db
          .prepare("SELECT 1 AS ok FROM call_participants WHERE call_id = ? AND user_id = ? AND status = 'joined'")
          .get(callId, user.id);
        const target = db
          .prepare("SELECT 1 AS ok FROM call_participants WHERE call_id = ? AND user_id = ? AND status = 'joined'")
          .get(callId, targetUserId);
        if (!sender || !target) throw errors.forbidden('Ambos os usuários precisam estar na chamada', 'NOT_IN_CALL');
        bus.emitToUsers([targetUserId], 'webrtc:signal', {
          callId,
          fromUserId: user.id,
          signal,
        });
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('call:media-state', (payload, ack) => {
      try {
        const { callId, audio, video, screen } = payload || {};
        const call = calls.getCall(db, callId);
        if (!call || !['ringing', 'active'].includes(call.status)) {
          throw errors.badRequest('A chamada não está ativa', 'CALL_INACTIVE');
        }
        const participant = db
          .prepare("SELECT 1 AS ok FROM call_participants WHERE call_id = ? AND user_id = ? AND status = 'joined'")
          .get(callId, user.id);
        if (!participant) throw errors.forbidden('Você não está nesta chamada', 'NOT_IN_CALL');
        const joined = calls
          .serializeCall(db, call)
          .participants.filter((p) => p.status === 'joined' && p.userId !== user.id);
        bus.emitToUsers(
          joined.map((p) => p.userId),
          'call:media-state',
          {
            callId,
            userId: user.id,
            audio: Boolean(audio),
            video: Boolean(video),
            screen: Boolean(screen),
          },
        );
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('space:sync', (payload, ack) => {
      try {
        const spaceId = payload?.spaceId;
        if (!spaceId) throw errors.badRequest('spaceId é obrigatório');
        getSpaceContext(db, spaceId, user.id);
        if (typeof ack === 'function') ack({ ok: true, spaceId });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('disconnect', () => {
      for (const timer of socket.data.typingConversations.values()) {
        clearTimeout(timer);
      }
      socket.data.typingConversations.clear();
      const wentOffline = presence.connectionClosed(db, user.id, socket.id);
      if (wentOffline) {
        const active = db
          .prepare(
            `SELECT cp.call_id FROM call_participants cp JOIN calls c ON c.id = cp.call_id
             WHERE cp.user_id = ? AND cp.status = 'joined' AND c.status IN ('ringing', 'active')`,
          )
          .all(user.id);
        for (const row of active) {
          try {
            const call = calls.getCall(db, row.call_id);
            const updated = calls.endCall(db, row.call_id, user.id);
            if (updated?.status === 'ended' || updated?.status === 'declined') {
              clearCallTimer(row.call_id);
            } else if (updated) {
              const joined = updated.participants.filter(
                (participant) => participant.status === 'joined',
              );
              bus.emitToUsers(
                joined.map((participant) => participant.userId),
                'call:participant-left',
                { callId: row.call_id, userId: user.id, call: updated },
              );
            }
            const spaceId = voiceSpaceId(db, call);
            if (spaceId) bus.emitToSpace(db, spaceId, 'space:updated', { spaceId });
          } catch {
            // Calls are best-effort on disconnect.
          }
        }
      }
    });
  });

  return io;
}

module.exports = { attachRealtime };
