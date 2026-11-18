'use strict';

const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unison-test-secret-with-more-than-32-characters';
process.env.EXPOSE_DEV_TOKENS = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `unison-api-test-${process.pid}`);

const { startServer, register, refreshCookie } = require('./helpers');

let ctx;
let alice;
let bob;
let carol;

function expectError(response, status, code) {
  assert.equal(
    response.status,
    status,
    `Expected ${status} but received ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assert.equal(response.body?.error?.code, code, JSON.stringify(response.body));
}

before(async () => {
  ctx = await startServer();
  alice = await register(ctx.request, 'alice', { displayName: 'Alice' });
  bob = await register(ctx.request, 'bob', { displayName: 'Bob' });
  carol = await register(ctx.request, 'carol', { displayName: 'Carol' });
  assert.equal(alice.response.status, 201, JSON.stringify(alice.response.body));
  assert.equal(bob.response.status, 201, JSON.stringify(bob.response.body));
  assert.equal(carol.response.status, 201, JSON.stringify(carol.response.body));
});

after(async () => {
  await ctx.close();
});

test('health check and security headers', async () => {
  const response = await ctx.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'ok');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(response.headers.get('permissions-policy') || '', /microphone=\(self\)/);

  const preflight = await ctx.request('/health', {
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('registration rejects weak passwords, duplicates and reserved names', async () => {
  const weak = await ctx.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'weakuser', email: 'weak@example.com', password: 'short' },
  });
  expectError(weak, 400, 'VALIDATION_ERROR');

  const duplicateName = await ctx.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'ALICE', email: 'another@example.com', password: 'Password123' },
  });
  expectError(duplicateName, 409, 'USERNAME_TAKEN');

  const duplicateEmail = await ctx.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'alice2', email: 'ALICE@example.com', password: 'Password123' },
  });
  expectError(duplicateEmail, 409, 'EMAIL_TAKEN');

  const reserved = await ctx.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'admin', email: 'admin@example.com', password: 'Password123' },
  });
  expectError(reserved, 400, 'USERNAME_RESERVED');

  const malformed = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.error.code, 'INVALID_JSON');
});

test('login resists injection and rejects invalid credentials', async () => {
  const injection = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: "' OR 1=1 --", password: 'anything' },
  });
  expectError(injection, 401, 'INVALID_CREDENTIALS');

  const wrong = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'alice', password: 'WrongPassword1' },
  });
  expectError(wrong, 401, 'INVALID_CREDENTIALS');

  const valid = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'ALICE@example.com', password: 'Password123' },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.user.username, 'alice');
  assert.equal(typeof valid.body.accessToken, 'string');
});

test('protected endpoints require a live session', async () => {
  expectError(await ctx.request('/api/conversations'), 401, 'UNAUTHORIZED');
  expectError(
    await ctx.request('/api/conversations', { token: 'not-a-token' }),
    401,
    'INVALID_TOKEN',
  );
});

test('email verification consumes a single-use token', async () => {
  const dave = await register(ctx.request, 'dave');
  assert.equal(dave.response.status, 201);
  assert.equal(dave.response.body.emailVerification.delivered, false);
  assert.equal(typeof dave.response.body.emailVerification.token, 'string');

  const beforeVerify = await ctx.request('/api/auth/me', { token: dave.token });
  assert.equal(beforeVerify.body.user.emailVerified, false);

  const verify = await ctx.request('/api/auth/verify-email', {
    method: 'POST',
    body: { token: dave.response.body.emailVerification.token },
  });
  assert.equal(verify.status, 200);

  const afterVerify = await ctx.request('/api/auth/me', { token: dave.token });
  assert.equal(afterVerify.body.user.emailVerified, true);

  const replay = await ctx.request('/api/auth/verify-email', {
    method: 'POST',
    body: { token: dave.response.body.emailVerification.token },
  });
  expectError(replay, 400, 'INVALID_TOKEN');
});

test('refresh rotates the opaque session cookie and enforces origin', async () => {
  const user = await register(ctx.request, 'rotator');
  const oldCookie = user.cookie;
  assert.ok(oldCookie);

  const refreshed = await ctx.request('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: oldCookie },
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.equal(typeof refreshed.body.accessToken, 'string');
  const newCookie = refreshCookie(refreshed);
  assert.notEqual(newCookie, oldCookie);

  const csrf = await ctx.request('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: newCookie, origin: 'https://evil.example' },
  });
  expectError(csrf, 403, 'BAD_ORIGIN');

  const replay = await ctx.request('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: oldCookie },
  });
  expectError(replay, 401, 'SESSION_EXPIRED');

  const rotatedAgain = await ctx.request('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: newCookie },
  });
  assert.equal(rotatedAgain.status, 200);

  const me = await ctx.request('/api/auth/me', { token: rotatedAgain.body.accessToken });
  assert.equal(me.status, 200);
});

test('logout revokes the current access token immediately', async () => {
  const user = await register(ctx.request, 'leaver');
  const me = await ctx.request('/api/auth/me', { token: user.token });
  assert.equal(me.status, 200);

  const logout = await ctx.request('/api/auth/logout', { method: 'POST', token: user.token });
  assert.equal(logout.status, 200);

  expectError(await ctx.request('/api/auth/me', { token: user.token }), 401, 'SESSION_REVOKED');
});

test('changing a password revokes other sessions and rotates credentials', async () => {
  const first = await register(ctx.request, 'passworduser');
  const second = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'passworduser', password: 'Password123' },
  });
  assert.equal(second.status, 200);

  const sessions = await ctx.request('/api/auth/sessions', { token: first.token });
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.sessions.length, 2);
  assert.equal(sessions.body.sessions.filter((session) => session.current).length, 1);

  const change = await ctx.request('/api/auth/change-password', {
    method: 'POST',
    token: first.token,
    body: { currentPassword: 'Password123', newPassword: 'NewPassword456' },
  });
  assert.equal(change.status, 200, JSON.stringify(change.body));

  expectError(
    await ctx.request('/api/auth/me', { token: second.body.accessToken }),
    401,
    'SESSION_REVOKED',
  );
  const current = await ctx.request('/api/auth/me', { token: first.token });
  assert.equal(current.status, 200);

  expectError(
    await ctx.request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'passworduser', password: 'Password123' },
    }),
    401,
    'INVALID_CREDENTIALS',
  );
  const login = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'passworduser', password: 'NewPassword456' },
  });
  assert.equal(login.status, 200);
});

test('password reset uses a single-use token and revokes sessions', async () => {
  const user = await register(ctx.request, 'resetuser');
  const forgot = await ctx.request('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'resetuser@example.com' },
  });
  assert.equal(forgot.status, 200);
  assert.equal(typeof forgot.body.devToken, 'string');

  const reset = await ctx.request('/api/auth/reset-password', {
    method: 'POST',
    body: { token: forgot.body.devToken, password: 'ResetPassword789' },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));

  expectError(await ctx.request('/api/auth/me', { token: user.token }), 401, 'SESSION_REVOKED');
  const replay = await ctx.request('/api/auth/reset-password', {
    method: 'POST',
    body: { token: forgot.body.devToken, password: 'AnotherPassword789' },
  });
  expectError(replay, 400, 'INVALID_RESET_TOKEN');

  const login = await ctx.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'resetuser', password: 'ResetPassword789' },
  });
  assert.equal(login.status, 200);
});

test('friend requests can be accepted and produce notifications', async () => {
  const sent = await ctx.request('/api/friends/requests', {
    method: 'POST',
    token: alice.token,
    body: { username: 'bob' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const pending = await ctx.request('/api/friends/requests', { token: bob.token });
  assert.equal(pending.status, 200);
  const request = pending.body.incoming.find((item) => item.id === sent.body.request.id);
  assert.ok(request);

  const notifications = await ctx.request('/api/notifications', { token: bob.token });
  assert.ok(
    notifications.body.notifications.some(
      (item) => item.type === 'friend_request' && item.data.requestId === sent.body.request.id,
    ),
  );

  const accepted = await ctx.request(
    `/api/friends/requests/${sent.body.request.id}/accept`,
    { method: 'POST', token: bob.token },
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.friend.id, alice.user.id);

  const friends = await ctx.request('/api/friends', { token: alice.token });
  assert.ok(friends.body.friends.some((friend) => friend.id === bob.user.id));

  const duplicate = await ctx.request('/api/friends/requests', {
    method: 'POST',
    token: alice.token,
    body: { username: 'bob' },
  });
  expectError(duplicate, 409, 'ALREADY_FRIENDS');
});

test('direct messages support edit, reactions, pin, search and read receipts', async () => {
  const dm = await ctx.request('/api/conversations/dm', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.user.id },
  });
  assert.equal(dm.status, 200, JSON.stringify(dm.body));
  const conversationId = dm.body.conversation.id;
  assert.equal(dm.body.conversation.type, 'dm');

  const sent = await ctx.request(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: alice.token,
    body: { content: 'Olá, Bob!' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const messageId = sent.body.message.id;
  assert.equal(sent.body.message.sender.id, alice.user.id);

  const list = await ctx.request(`/api/conversations/${conversationId}/messages`, {
    token: bob.token,
  });
  assert.equal(list.status, 200);
  assert.ok(list.body.messages.some((message) => message.id === messageId));

  const unread = await ctx.request(`/api/conversations/${conversationId}`, { token: bob.token });
  assert.equal(unread.body.conversation.unreadCount, 1);

  const forbiddenEdit = await ctx.request(`/api/messages/${messageId}`, {
    method: 'PATCH',
    token: bob.token,
    body: { content: 'Sequestrada' },
  });
  expectError(forbiddenEdit, 403, 'NOT_SENDER');

  const edited = await ctx.request(`/api/messages/${messageId}`, {
    method: 'PATCH',
    token: alice.token,
    body: { content: 'Olá, Bob! editado' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.message.content, 'Olá, Bob! editado');
  assert.equal(edited.body.message.edited, true);

  const reaction = await ctx.request(`/api/messages/${messageId}/reactions`, {
    method: 'POST',
    token: bob.token,
    body: { emoji: '🔥' },
  });
  assert.equal(reaction.status, 200);
  const fire = reaction.body.message.reactions.find((item) => item.emoji === '🔥');
  assert.equal(fire.count, 1);
  assert.equal(fire.users[0].id, bob.user.id);

  const pinned = await ctx.request(`/api/messages/${messageId}/pin`, {
    method: 'POST',
    token: alice.token,
    body: { pinned: true },
  });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.message.pinned, true);

  const pins = await ctx.request(`/api/conversations/${conversationId}/pins`, {
    token: bob.token,
  });
  assert.ok(pins.body.messages.some((message) => message.id === messageId));

  const search = await ctx.request(
    `/api/conversations/${conversationId}/search?q=${encodeURIComponent('editado')}`,
    { token: bob.token },
  );
  assert.equal(search.status, 200);
  assert.ok(search.body.messages.some((message) => message.id === messageId));

  const read = await ctx.request(`/api/conversations/${conversationId}/read`, {
    method: 'POST',
    token: bob.token,
    body: { messageId },
  });
  assert.equal(read.status, 200);
  const afterRead = await ctx.request(`/api/conversations/${conversationId}`, {
    token: bob.token,
  });
  assert.equal(afterRead.body.conversation.unreadCount, 0);

  expectError(
    await ctx.request(`/api/conversations/${conversationId}/messages`, { token: carol.token }),
    403,
    'NOT_A_MEMBER',
  );
  expectError(
    await ctx.request(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      token: carol.token,
      body: { content: 'Intrusa' },
    }),
    403,
    'NOT_A_MEMBER',
  );

  expectError(
    await ctx.request(`/api/messages/${messageId}`, { method: 'DELETE', token: bob.token }),
    403,
    'FORBIDDEN',
  );
  const deleted = await ctx.request(`/api/messages/${messageId}`, {
    method: 'DELETE',
    token: alice.token,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.id, messageId);
});

test('spaces enforce roles, private channels, invites and bans', async () => {
  const created = await ctx.request('/api/spaces', {
    method: 'POST',
    token: alice.token,
    body: { name: 'Projeto Teste', description: 'Espaço de validação', visibility: 'public' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const spaceId = created.body.space.id;
  assert.ok(created.body.defaultChannelId);

  expectError(
    await ctx.request(`/api/spaces/${spaceId}`, { token: carol.token }),
    403,
    'NOT_A_MEMBER',
  );

  const joined = await ctx.request(`/api/spaces/${spaceId}/join`, {
    method: 'POST',
    token: bob.token,
  });
  assert.equal(joined.status, 200);

  const details = await ctx.request(`/api/spaces/${spaceId}`, { token: bob.token });
  assert.equal(details.status, 200);
  assert.equal(details.body.space.channelCount, 1);
  assert.equal(details.body.channels.length, 1);
  assert.ok(details.body.myMember.permissions.includes('send_messages'));
  const generalConversation = details.body.channels[0].conversationId;

  const channelMessage = await ctx.request(
    `/api/conversations/${generalConversation}/messages`,
    { method: 'POST', token: bob.token, body: { content: 'Mensagem no canal geral' } },
  );
  assert.equal(channelMessage.status, 201);

  expectError(
    await ctx.request(`/api/spaces/${spaceId}`, {
      method: 'PATCH',
      token: bob.token,
      body: { name: 'Invadido' },
    }),
    403,
    'MISSING_PERMISSION',
  );
  expectError(
    await ctx.request(`/api/spaces/${spaceId}/channels`, {
      method: 'POST',
      token: bob.token,
      body: { name: 'invasao' },
    }),
    403,
    'MISSING_PERMISSION',
  );
  expectError(
    await ctx.request(`/api/spaces/${spaceId}/audit`, { token: bob.token }),
    403,
    'MISSING_PERMISSION',
  );

  const privateChannel = await ctx.request(`/api/spaces/${spaceId}/channels`, {
    method: 'POST',
    token: alice.token,
    body: { name: 'privado', topic: 'Restrito', isPrivate: true },
  });
  assert.equal(privateChannel.status, 201, JSON.stringify(privateChannel.body));
  const privateId = privateChannel.body.channel.id;

  expectError(
    await ctx.request(`/api/channels/${privateId}`, { token: bob.token }),
    403,
    'PRIVATE_CHANNEL',
  );
  expectError(
    await ctx.request(`/api/conversations/${privateChannel.body.channel.conversationId}/messages`, {
      method: 'POST',
      token: bob.token,
      body: { content: 'Sem acesso' },
    }),
    403,
    'NOT_A_MEMBER',
  );
  expectError(
    await ctx.request(`/api/channels/${privateId}/join`, { method: 'POST', token: bob.token }),
    403,
    'MISSING_PERMISSION',
  );

  const added = await ctx.request(`/api/channels/${privateId}/members`, {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.user.id },
  });
  assert.equal(added.status, 200);
  const privateMessage = await ctx.request(
    `/api/conversations/${privateChannel.body.channel.conversationId}/messages`,
    { method: 'POST', token: bob.token, body: { content: 'Agora tenho acesso' } },
  );
  assert.equal(privateMessage.status, 201);

  const role = await ctx.request(`/api/spaces/${spaceId}/roles`, {
    method: 'POST',
    token: alice.token,
    body: { name: 'Editor', color: '#C9A0DC', permissions: ['manage_channels', 'send_messages'] },
  });
  assert.equal(role.status, 201, JSON.stringify(role.body));
  const assigned = await ctx.request(`/api/spaces/${spaceId}/members/${bob.user.id}`, {
    method: 'PATCH',
    token: alice.token,
    body: { roleIds: [role.body.role.id] },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

  const bobDetails = await ctx.request(`/api/spaces/${spaceId}`, { token: bob.token });
  assert.ok(bobDetails.body.myMember.permissions.includes('manage_channels'));
  const bobChannel = await ctx.request(`/api/spaces/${spaceId}/channels`, {
    method: 'POST',
    token: bob.token,
    body: { name: 'criado-pelo-editor' },
  });
  assert.equal(bobChannel.status, 201, JSON.stringify(bobChannel.body));

  const invite = await ctx.request(`/api/spaces/${spaceId}/invites`, {
    method: 'POST',
    token: alice.token,
    body: { maxUses: 1, expiresInHours: 24 },
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const inviteInfo = await ctx.request(`/api/invites/${invite.body.invite.code}`, {
    token: carol.token,
  });
  assert.equal(inviteInfo.status, 200);
  assert.equal(inviteInfo.body.invite.valid, true);
  const inviteJoin = await ctx.request(`/api/invites/${invite.body.invite.code}/join`, {
    method: 'POST',
    token: carol.token,
  });
  assert.equal(inviteJoin.status, 200, JSON.stringify(inviteJoin.body));

  const banned = await ctx.request(`/api/spaces/${spaceId}/bans/${carol.user.id}`, {
    method: 'POST',
    token: alice.token,
    body: { reason: 'Teste de moderação' },
  });
  assert.equal(banned.status, 200);
  expectError(
    await ctx.request(`/api/spaces/${spaceId}/join`, { method: 'POST', token: carol.token }),
    403,
    'BANNED',
  );
  expectError(
    await ctx.request(`/api/spaces/${spaceId}`, { token: carol.token }),
    403,
    'NOT_A_MEMBER',
  );

  const bans = await ctx.request(`/api/spaces/${spaceId}/bans`, { token: alice.token });
  assert.ok(bans.body.bans.some((ban) => ban.userId === carol.user.id));
  const unban = await ctx.request(`/api/spaces/${spaceId}/bans/${carol.user.id}`, {
    method: 'DELETE',
    token: alice.token,
  });
  assert.equal(unban.status, 200);
  const rejoined = await ctx.request(`/api/spaces/${spaceId}/join`, {
    method: 'POST',
    token: carol.token,
  });
  assert.equal(rejoined.status, 200);

  const privateSpace = await ctx.request('/api/spaces', {
    method: 'POST',
    token: alice.token,
    body: { name: 'Espaço Fechado', visibility: 'private' },
  });
  assert.equal(privateSpace.status, 201);
  expectError(
    await ctx.request(`/api/spaces/${privateSpace.body.space.id}/join`, {
      method: 'POST',
      token: carol.token,
    }),
    403,
    'INVITE_REQUIRED',
  );
});

test('uploads reject dangerous types and neutralize traversal filenames', async () => {
  const unsafe = new FormData();
  unsafe.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
  const rejected = await ctx.request('/api/uploads', {
    method: 'POST',
    token: alice.token,
    body: unsafe,
  });
  expectError(rejected, 400, 'UNSUPPORTED_FILE');

  const empty = new FormData();
  expectError(
    await ctx.request('/api/uploads', { method: 'POST', token: alice.token, body: empty }),
    400,
    'NO_FILE',
  );

  const traversal = new FormData();
  traversal.append('file', new Blob(['conteúdo seguro'], { type: 'text/plain' }), '../../nota.txt');
  const uploaded = await ctx.request('/api/uploads', {
    method: 'POST',
    token: alice.token,
    body: traversal,
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.attachment.name, 'nota.txt');
  assert.match(uploaded.body.attachment.url, /^\/uploads\/[0-9a-f-]+\.txt$/);

  expectError(
    await ctx.request('/api/uploads', { method: 'POST', body: new FormData() }),
    401,
    'UNAUTHORIZED',
  );
});
