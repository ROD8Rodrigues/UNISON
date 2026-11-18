'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function requiredSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (isProduction && (secret.length < 32 || secret.includes('change-me'))) {
    throw new Error('JWT_SECRET must be a random string of at least 32 characters in production');
  }
  if (secret.length >= 32) return secret;
  // Development fallback is stable per installation so sessions survive restarts.
  return crypto
    .createHash('sha256')
    .update(`unison-dev-${process.cwd()}-${process.env.USERNAME || 'local'}`)
    .digest('hex');
}

const root = path.join(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  isTest,
  port: Number(process.env.PORT || 60000),
  // Some PaaS providers (including alwaysdata) expose the bind address as IP.
  // HOST wins when explicitly set; otherwise fall back to IP or all interfaces.
  host: process.env.HOST || process.env.IP || '0.0.0.0',
  jwtSecret: requiredSecret(),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/unison.db'),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'UNISON <no-reply@unison.local>',
  },
  exposeDevTokens:
    process.env.EXPOSE_DEV_TOKENS === 'true' || (!isProduction && process.env.EXPOSE_DEV_TOKENS !== 'false'),
  trustProxy: process.env.TRUST_PROXY === 'true',
  // The desktop build serves the app over loopback HTTP, where Secure cookies are
  // not sent by Chromium. Cookie protection still applies because the server only
  // listens on 127.0.0.1.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : isProduction,
  cookieName: 'unison_refresh',
  version: '1.0.0',
};

if (isProduction && config.corsOrigins.includes('*')) {
  throw new Error('CORS_ORIGINS cannot be "*" in production');
}

module.exports = config;
