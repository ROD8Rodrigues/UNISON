'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { id, now, randomToken, sha256 } = require('../utils/helpers');
const { errors } = require('../utils/errors');

const ACCESS_TYPE = 'access';

function signAccessToken(config, userId, sessionId) {
  return jwt.sign({ sub: userId, sid: sessionId, typ: ACCESS_TYPE }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtl,
    issuer: 'unison',
    audience: 'unison-client',
  });
}

function verifyAccessToken(config, token) {
  const payload = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: 'unison',
    audience: 'unison-client',
  });
  if (payload.typ !== ACCESS_TYPE || !payload.sub || !payload.sid) {
    throw new Error('Tipo de token inválido');
  }
  return payload;
}

function parseUserAgent(userAgent = '') {
  const agent = String(userAgent);
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : 'Browser';
  const platform = /Windows/.test(agent)
    ? 'Windows'
    : /Macintosh|Mac OS/.test(agent)
      ? 'macOS'
      : /Android/.test(agent)
        ? 'Android'
        : /iPhone|iPad/.test(agent)
          ? 'iOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Unknown';
  return `${browser} · ${platform}`;
}

function createSession(db, config, userId, req) {
  const sessionId = id();
  const refreshToken = randomToken(48);
  const createdAt = now();
  const expiresAt = createdAt + config.refreshTokenDays * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO sessions
      (id, user_id, refresh_hash, user_agent, ip, device_label, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    userId,
    sha256(refreshToken),
    req.get('user-agent') || '',
    req.ip || '',
    parseUserAgent(req.get('user-agent')),
    createdAt,
    createdAt,
    expiresAt,
  );
  return {
    sessionId,
    refreshToken,
    accessToken: signAccessToken(config, userId, sessionId),
    expiresAt,
  };
}

function rotateSession(db, config, refreshToken, req) {
  if (!refreshToken) throw errors.unauthorized('Token de atualização ausente', 'NO_REFRESH_TOKEN');
  const row = db
    .prepare('SELECT * FROM sessions WHERE refresh_hash = ?')
    .get(sha256(refreshToken));
  if (!row || row.revoked_at || row.expires_at <= now()) {
    throw errors.unauthorized('Sessão expirada. Entre novamente.', 'SESSION_EXPIRED');
  }
  const newToken = randomToken(48);
  db.prepare('UPDATE sessions SET refresh_hash = ?, last_used_at = ?, user_agent = ?, ip = ? WHERE id = ?').run(
    sha256(newToken),
    now(),
    req.get('user-agent') || row.user_agent,
    req.ip || row.ip,
    row.id,
  );
  return {
    sessionId: row.id,
    userId: row.user_id,
    refreshToken: newToken,
    accessToken: signAccessToken(config, row.user_id, row.id),
  };
}

function revokeSession(db, sessionId, userId) {
  const result = db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(now(), sessionId, userId);
  return result.changes > 0;
}

function revokeAllSessions(db, userId, exceptSessionId) {
  if (exceptSessionId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').run(
      now(),
      userId,
      exceptSessionId,
    );
  } else {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      now(),
      userId,
    );
  }
}

function resolveSessionUser(db, config, accessToken) {
  let payload;
  try {
    payload = verifyAccessToken(config, accessToken);
  } catch {
    throw errors.unauthorized('Token de acesso inválido ou expirado', 'INVALID_TOKEN');
  }
  const session = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
    .get(payload.sid, payload.sub);
  if (!session || session.revoked_at || session.expires_at <= now()) {
    throw errors.unauthorized('A sessão não está mais ativa', 'SESSION_REVOKED');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) throw errors.unauthorized('A conta não existe mais', 'ACCOUNT_GONE');
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(user.id);
  return { user, settings, session, sessionId: session.id };
}

function setRefreshCookie(res, config, token, expiresAt) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(res, config) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Comparing against a real hash for unknown accounts keeps login timing similar.
const DUMMY_PASSWORD_HASH = '$2b$12$jtd7fqKuweJc/DhpW4aa7eqmrtCrcSI5GA0XPuc/MlhaaGI9bpEIm';

function serializeSession(row, currentSessionId) {
  return {
    id: row.id,
    device: row.device_label || 'Unknown device',
    userAgent: row.user_agent || '',
    ip: row.ip || '',
    current: row.id === currentSessionId,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: new Date(row.last_used_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  createSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  resolveSessionUser,
  setRefreshCookie,
  clearRefreshCookie,
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  serializeSession,
  parseUserAgent,
};
