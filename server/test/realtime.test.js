'use strict';

const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { io: createClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unison-test-secret-with-more-than-32-characters';
process.env.EXPOSE_DEV_TOKENS = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `unison-realtime-test-${process.pid}`);

const { startServer, register } = require('./helpers');

let ctx;
let alex;
let blair;
let cody;
const sockets = [];

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForEvent(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event ${event}`));
    }, timeout);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

function collectEvents(socket, event) {
  const events = [];
  const handler = (payload) => events.push(payload);
  socket.on(event, handler);
  return {
    events,
    stop: () => socket.off(event, handler),
  };
}

async function connect(token) {
  const socket = createClient(ctx.baseUrl, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    auth: { token },
  });
  sockets.push(socket);
  const ready = waitForEvent(socket, 'socket:ready');
  socket.connect();
  const payload = await ready;
  assert.equal(typeof payload.userId, 'string');
  return socket;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(4000).emit(event, payload, (error, response) => {
      if (error) return reject(new Error(`${event} timed out`));
      if (response?.error) return reject(new Error(response.error.message));
      resolve(response);
    });
  });
}

before(async () => {
  ctx = await startServer();
  alex = await register(ctx.request, 'alex', { displayName: 'Alex' });
  blair = await register(ctx.request, 'blair', { displayName: 'Blair' });
  cody = await register(ctx.request, 'cody', { displayName: 'Cody' });
  assert.equal(alex.response.status, 201);
  assert.equal(blair.response.status, 201);
  assert.equal(cody.response.status, 201);
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await ctx.close();
});

test('realtime message, typing and room isolation', async () => {
  const dm = await ctx.request('/api/conversations/dm', {
    method: 'POST',
    token: alex.token,
    body: { userId: blair.user.id },
  });
  assert.equal(dm.status, 200);
  const conversationId = dm.body.conversation.id;

  const alexSocket = await connect(alex.token);
  const blairSocket = await connect(blair.token);
  const codySocket = await connect(cody.token);

  const typingPromise = waitForEvent(blairSocket, 'typing:update');
  const typingAck = await emitAck(alexSocket, 'typing:start', { conversationId });
  assert.equal(typingAck.ok, true);
  const typing = await typingPromise;
  assert.equal(typing.conversationId, conversationId);
  assert.equal(typing.userId, alex.user.id);
  assert.equal(typing.username, 'alex');
  assert.equal(typing.isTyping, true);

  const alexInbox = collectEvents(alexSocket, 'message:new');
  const blairInbox = collectEvents(blairSocket, 'message:new');
  const codyInbox = collectEvents(codySocket, 'message:new');
  const deliveredPromise = waitForEvent(blairSocket, 'message:new');

  const sent = await ctx.request(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: alex.token,
    body: { content: 'Entrega em tempo real' },
  });
  assert.equal(sent.status, 201);

  const delivered = await deliveredPromise;
  assert.equal(delivered.message.id, sent.body.message.id);
  assert.equal(delivered.message.content, 'Entrega em tempo real');
  assert.equal(delivered.message.sender.id, alex.user.id);

  await delay(250);
  assert.ok(alexInbox.events.some((event) => event.message.id === sent.body.message.id));
  assert.equal(codyInbox.events.length, 0);
  assert.equal(blairInbox.events.length, 1);

  const forbiddenTyping = await emitAck(alexSocket, 'typing:start', {
    conversationId: '00000000-0000-4000-8000-000000000000',
  }).catch((error) => error);
  assert.ok(forbiddenTyping instanceof Error);
  assert.match(forbiddenTyping.message, /não faz parte|não encontr|Conversa/i);
});

test('call signaling reaches participants and ends in order', async () => {
  const dm = await ctx.request('/api/conversations/dm', {
    method: 'POST',
    token: alex.token,
    body: { userId: blair.user.id },
  });
  assert.equal(dm.status, 200);
  const conversationId = dm.body.conversation.id;

  const alexSocket = await connect(alex.token);
  const blairSocket = await connect(blair.token);

  const incomingPromise = waitForEvent(blairSocket, 'call:incoming');
  const started = await emitAck(alexSocket, 'call:start', { conversationId, kind: 'video' });
  const incoming = await incomingPromise;
  assert.equal(incoming.call.id, started.call.id);
  assert.equal(incoming.conversationType, 'dm');
  assert.equal(incoming.caller.id, alex.user.id);

  const joinedPromise = waitForEvent(alexSocket, 'call:participant-joined');
  const accepted = await emitAck(blairSocket, 'call:accept', { callId: started.call.id });
  assert.equal(accepted.call.status, 'active');
  const joined = await joinedPromise;
  assert.equal(joined.callId, started.call.id);
  assert.ok(joined.participants.some((participant) => participant.userId === blair.user.id));

  const offerPromise = waitForEvent(blairSocket, 'webrtc:signal');
  const offerAck = await emitAck(alexSocket, 'webrtc:signal', {
    callId: started.call.id,
    targetUserId: blair.user.id,
    signal: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
  });
  assert.equal(offerAck.ok, true);
  const offer = await offerPromise;
  assert.equal(offer.fromUserId, alex.user.id);
  assert.equal(offer.signal.type, 'offer');

  const answerPromise = waitForEvent(alexSocket, 'webrtc:signal');
  await emitAck(blairSocket, 'webrtc:signal', {
    callId: started.call.id,
    targetUserId: alex.user.id,
    signal: { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' },
  });
  const answer = await answerPromise;
  assert.equal(answer.fromUserId, blair.user.id);
  assert.equal(answer.signal.type, 'answer');

  const endedPromise = waitForEvent(blairSocket, 'call:ended');
  await emitAck(alexSocket, 'call:end', { callId: started.call.id });
  const ended = await endedPromise;
  assert.equal(ended.callId, started.call.id);
});

test('logout revokes the active socket and blocks token reuse', async () => {
  const socket = await connect(cody.token);
  const revokedPromise = waitForEvent(socket, 'session:revoked');
  const disconnectPromise = waitForEvent(socket, 'disconnect');

  const logout = await ctx.request('/api/auth/logout', { method: 'POST', token: cody.token });
  assert.equal(logout.status, 200);
  await revokedPromise;
  await disconnectPromise;

  const rejected = createClient(ctx.baseUrl, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    auth: { token: cody.token },
  });
  sockets.push(rejected);
  const errorPromise = waitForEvent(rejected, 'connect_error');
  rejected.connect();
  const error = await errorPromise;
  assert.match(error.message, /Falha na autenticação|Autenticação necessária/i);
  rejected.disconnect();
});
