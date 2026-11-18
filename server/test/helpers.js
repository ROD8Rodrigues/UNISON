'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { attachRealtime } = require('../src/realtime');

async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ db });
  const server = http.createServer(app);
  const io = attachRealtime(server, db);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    let body;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (options.token) headers.authorization = `Bearer ${options.token}`;

    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body,
    });
    const text = await response.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Keep plain text responses as text.
    }
    return {
      status: response.status,
      body: parsed,
      headers: response.headers,
      setCookies: response.headers.getSetCookie(),
    };
  }

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    try {
      db.close();
    } catch {
      // Already closed by an io shutdown path.
    }
    if (fs.existsSync(process.env.UPLOAD_DIR)) {
      fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    }
  }

  return { db, app, server, io, baseUrl, request, close };
}

function refreshCookie(response) {
  const header = response.setCookies.find((value) => value.startsWith('unison_refresh='));
  if (!header) throw new Error('Refresh cookie was not set');
  return header.split(';')[0];
}

async function register(request, username, overrides = {}) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      email: `${username}@example.com`,
      password: 'Password123',
      displayName: overrides.displayName || username,
      ...overrides,
    },
  });
  return {
    response,
    token: response.body?.accessToken,
    user: response.body?.user,
    cookie: response.setCookies.length ? refreshCookie(response) : null,
  };
}

function testUploadDir() {
  return path.join(os.tmpdir(), `unison-test-${process.pid}-${Date.now()}`);
}

module.exports = { startServer, register, refreshCookie, testUploadDir };
