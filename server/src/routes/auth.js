'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authLimiter, verificationResendLimiter } = require('../middleware/rateLimit');
const { sameOrigin } = require('../middleware/http');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
} = require('../utils/schemas');
const { errors } = require('../utils/errors');
const { id, now, randomToken, sha256, transaction, reservedUsernames } = require('../utils/helpers');
const authService = require('../services/auth');
const mailer = require('../services/mailer');
const { serializeUser, getSettingsRow } = require('../services/users');
const bus = require('../realtime/bus');
const config = require('../config');

const RESERVED_USERNAMES = reservedUsernames;

function issueVerification(db, userId) {
  const token = randomToken(32);
  const verificationId = id();
  db.prepare(
    `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(verificationId, userId, sha256(token), now() + 24 * 60 * 60 * 1000, now());
  return { id: verificationId, token };
}

function issuePasswordReset(db, userId) {
  const token = randomToken(32);
  db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
    now(),
    userId,
  );
  db.prepare(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id(), userId, sha256(token), now() + 30 * 60 * 1000, now());
  return token;
}

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
    const { username, email, password, displayName } = req.body;
    if (RESERVED_USERNAMES.has(username)) {
      throw errors.badRequest('Esse nome de usuário é reservado', 'USERNAME_RESERVED');
    }
    const existing = db
      .prepare('SELECT username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(username, email);
    if (existing) {
      if (String(existing.username).toLowerCase() === username) {
        throw errors.conflict('Esse nome de usuário já está em uso', 'USERNAME_TAKEN');
      }
      throw errors.conflict('Já existe uma conta com esse email', 'EMAIL_TAKEN');
    }
    const passwordHash = await authService.hashPassword(password);
    const userId = id();
    const timestamp = now();
    const verificationToken = randomToken(32);
    transaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, display_name, presence, last_seen, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?)`,
      ).run(
        userId,
        username,
        email,
        passwordHash,
        (displayName || username).slice(0, 40),
        timestamp,
        timestamp,
        timestamp,
      );
      db.prepare(
        `INSERT INTO user_settings (user_id, theme, accent, updated_at)
         VALUES (?, 'dark', '#C9A0DC', ?)`,
      ).run(userId, timestamp);
      db.prepare(
        `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id(), userId, sha256(verificationToken), timestamp + 24 * 60 * 60 * 1000, timestamp);
    });

    const session = authService.createSession(db, config, userId, req);
    authService.setRefreshCookie(res, config, session.refreshToken, session.expiresAt);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const settings = getSettingsRow(db, userId);
    const mail = await mailer.sendEmailVerification(email, user.display_name, verificationToken);
    res.status(201).json({
      user: serializeUser(user, { self: true, settings }),
      accessToken: session.accessToken,
      emailVerification: {
        delivered: mail.delivered,
        ...(config.exposeDevTokens ? { token: verificationToken } : {}),
      },
    });
  });

  router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
    const { identifier, password } = req.body;
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(identifier, identifier);
    const valid = await authService.verifyPassword(
      password,
      user ? user.password_hash : authService.DUMMY_PASSWORD_HASH,
    );
    if (!user || !valid) {
      throw errors.unauthorized('Usuário ou senha inválidos', 'INVALID_CREDENTIALS');
    }
    db.prepare('UPDATE users SET presence = ?, last_seen = ?, updated_at = ? WHERE id = ?').run(
      'online',
      now(),
      now(),
      user.id,
    );
    const session = authService.createSession(db, config, user.id, req);
    authService.setRefreshCookie(res, config, session.refreshToken, session.expiresAt);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const settings = getSettingsRow(db, user.id);
    res.json({
      user: serializeUser(fresh, { self: true, settings }),
      accessToken: session.accessToken,
    });
  });

  router.post('/refresh', sameOrigin, (req, res) => {
    try {
      const refreshed = authService.rotateSession(db, config, req.cookies[config.cookieName], req);
      authService.setRefreshCookie(res, config, refreshed.refreshToken, now() + config.refreshTokenDays * 86400000);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(refreshed.userId);
      if (!user) throw errors.unauthorized('A conta não existe mais');
      const settings = getSettingsRow(db, user.id);
      res.json({
        user: serializeUser(user, { self: true, settings }),
        accessToken: refreshed.accessToken,
      });
    } catch (error) {
      authService.clearRefreshCookie(res, config);
      throw error;
    }
  });

  router.post('/logout', authenticate(db, config), (req, res) => {
    authService.revokeSession(db, req.sessionId, req.user.id);
    db.prepare('UPDATE users SET presence = ?, last_seen = ? WHERE id = ?').run(
      'offline',
      now(),
      req.user.id,
    );
    authService.clearRefreshCookie(res, config);
    bus.disconnectSession(req.sessionId);
    res.json({ ok: true });
  });

  router.get('/me', authenticate(db, config), (req, res) => {
    res.json({ user: serializeUser(req.user, { self: true, settings: req.settings }) });
  });

  router.get('/sessions', authenticate(db, config), (req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, last_used_at DESC`,
      )
      .all(req.user.id, now(), req.sessionId);
    res.json({ sessions: rows.map((row) => authService.serializeSession(row, req.sessionId)) });
  });

  router.delete('/sessions/:sessionId', authenticate(db, config), (req, res) => {
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(req.params.sessionId, req.user.id);
    if (!session) throw errors.notFound('Sessão não encontrada', 'SESSION_NOT_FOUND');
    authService.revokeSession(db, session.id, req.user.id);
    if (session.id === req.sessionId) authService.clearRefreshCookie(res, config);
    bus.disconnectSession(session.id);
    res.json({ ok: true, current: session.id === req.sessionId });
  });

  router.post('/sessions/revoke-others', authenticate(db, config), (req, res) => {
    const others = db
      .prepare(
        'SELECT id FROM sessions WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      )
      .all(req.user.id, req.sessionId)
      .map((row) => row.id);
    authService.revokeAllSessions(db, req.user.id, req.sessionId);
    bus.disconnectSessions(others);
    res.json({ ok: true });
  });

  router.post(
    '/change-password',
    authLimiter,
    authenticate(db, config),
    validate(changePasswordSchema),
    async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      const valid = await authService.verifyPassword(currentPassword, req.user.password_hash);
      if (!valid) throw errors.badRequest('A senha atual está incorreta', 'INVALID_PASSWORD');
      if (currentPassword === newPassword) {
        throw errors.badRequest('A nova senha precisa ser diferente', 'SAME_PASSWORD');
      }
      const hash = await authService.hashPassword(newPassword);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hash,
        now(),
        req.user.id,
      );
      const others = db
        .prepare(
          'SELECT id FROM sessions WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
        )
        .all(req.user.id, req.sessionId)
        .map((row) => row.id);
      authService.revokeAllSessions(db, req.user.id, req.sessionId);
      bus.disconnectSessions(others);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
        now(),
        req.user.id,
      );
      res.json({ ok: true, message: 'Senha atualizada. As outras sessões foram encerradas.' });
    },
  );

  router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res) => {
    const user = db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .get(req.body.email);
    let devToken;
    if (user) {
      const token = issuePasswordReset(db, user.id);
      const mail = await mailer.sendPasswordReset(user.email, user.display_name, token);
      if (config.exposeDevTokens) devToken = token;
      void mail;
    }
    res.json({
      ok: true,
      message: 'Se existir uma conta com esse email, um link de redefinição foi enviado.',
      ...(devToken ? { devToken } : {}),
    });
  });

  router.post('/reset-password', authLimiter, validate(resetPasswordSchema), async (req, res) => {
    const { token, password } = req.body;
    const row = db
      .prepare(
        'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
      )
      .get(sha256(token), now());
    if (!row) throw errors.badRequest('Este link de redefinição é inválido ou expirou', 'INVALID_RESET_TOKEN');
    const hash = await authService.hashPassword(password);
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hash,
        now(),
        row.user_id,
      );
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now(), row.id);
      authService.revokeAllSessions(db, row.user_id);
    });
    bus.disconnectUser(row.user_id);
    res.json({ ok: true, message: 'Senha redefinida. Você já pode entrar.' });
  });

  router.post('/verify-email', authLimiter, validate(verifyEmailSchema), (req, res) => {
    const row = db
      .prepare(
        'SELECT * FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
      )
      .get(sha256(req.body.token), now());
    if (!row) throw errors.badRequest('Este link de verificação é inválido ou expirou', 'INVALID_TOKEN');
    db.prepare('UPDATE email_verifications SET used_at = ? WHERE id = ?').run(now(), row.id);
    db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(
      now(),
      row.user_id,
    );
    res.json({ ok: true, message: 'Email verificado' });
  });

  router.post(
    '/resend-verification',
    authenticate(db, config),
    verificationResendLimiter,
    async (req, res) => {
      if (req.user.email_verified) {
        throw errors.badRequest('Seu email já está verificado', 'ALREADY_VERIFIED');
      }
      const verification = issueVerification(db, req.user.id);
      const mail = await mailer.sendEmailVerification(
        req.user.email,
        req.user.display_name,
        verification.token,
      );
      const timestamp = now();
      if (mail.delivered || config.exposeDevTokens) {
        db.prepare(
          'UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND id <> ? AND used_at IS NULL',
        ).run(timestamp, req.user.id, verification.id);
      } else {
        db.prepare('UPDATE email_verifications SET used_at = ? WHERE id = ?').run(
          timestamp,
          verification.id,
        );
      }
      res.json({
        ok: true,
        delivered: mail.delivered,
        ...(config.exposeDevTokens ? { token: verification.token } : {}),
      });
    },
  );

  return router;
}

module.exports = { createAuthRouter };
