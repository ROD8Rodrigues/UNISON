'use strict';

let io = null;

function setIo(instance) {
  io = instance;
}

function userRoom(userId) {
  return `user:${userId}`;
}

function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}

function getIo() {
  return io;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
}

function emitToUsers(userIds, event, payload, exceptUserId) {
  if (!io) return;
  for (const userId of new Set(userIds)) {
    if (exceptUserId && userId === exceptUserId) continue;
    io.to(userRoom(userId)).emit(event, payload);
  }
}

function emitToConversation(db, conversationId, event, payload, exceptUserId) {
  if (!io) return;
  const ids = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId)
    .map((row) => row.user_id);
  emitToUsers(ids, event, payload, exceptUserId);
}

function emitToSpace(db, spaceId, event, payload, exceptUserId) {
  if (!io) return;
  const ids = db
    .prepare('SELECT user_id FROM space_members WHERE space_id = ?')
    .all(spaceId)
    .map((row) => row.user_id);
  emitToUsers(ids, event, payload, exceptUserId);
}

function emitToCallRoom(callId, event, payload, exceptSocketId) {
  if (!io) return;
  const room = io.to(`call:${callId}`);
  if (exceptSocketId) room.except(exceptSocketId).emit(event, payload);
  else room.emit(event, payload);
}

function disconnectSession(sessionId) {
  if (!io || !sessionId) return;
  const room = io.in(sessionRoom(sessionId));
  room.emit('session:revoked');
  room.disconnectSockets(true);
}

function disconnectSessions(sessionIds) {
  for (const sessionId of new Set(sessionIds || [])) disconnectSession(sessionId);
}

function disconnectUser(userId) {
  if (!io || !userId) return;
  const room = io.in(userRoom(userId));
  room.emit('session:revoked');
  room.disconnectSockets(true);
}

module.exports = {
  setIo,
  getIo,
  userRoom,
  sessionRoom,
  emitToUser,
  emitToUsers,
  emitToConversation,
  emitToSpace,
  emitToCallRoom,
  disconnectSession,
  disconnectSessions,
  disconnectUser,
};
