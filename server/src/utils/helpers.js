'use strict';

const crypto = require('crypto');

const now = () => Date.now();
const id = () => crypto.randomUUID();
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'space';
}

function dmKey(a, b) {
  return [a, b].sort().join(':');
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function uniqueUsernameCandidate(base) {
  const clean = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 20) || 'user';
  return `${clean}${Math.floor(Math.random() * 9000 + 1000)}`;
}

function iso(value) {
  return value ? new Date(Number(value)).toISOString() : null;
}

const PERMISSIONS = [
  'manage_space',
  'manage_channels',
  'manage_roles',
  'manage_members',
  'kick_members',
  'ban_members',
  'manage_messages',
  'send_messages',
  'create_invites',
  'view_audit',
];

const DEFAULT_ROLE_PERMISSIONS = {
  Owner: [...PERMISSIONS],
  Admin: [
    'manage_channels',
    'manage_members',
    'kick_members',
    'ban_members',
    'manage_messages',
    'send_messages',
    'create_invites',
    'view_audit',
  ],
  Member: ['send_messages'],
};

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'unison',
  'system',
  'support',
  'everyone',
  'here',
  'moderator',
]);

module.exports = {
  reservedUsernames: RESERVED_USERNAMES,
  now,
  id,
  randomToken,
  sha256,
  slugify,
  dmKey,
  safeJson,
  escapeLike,
  parsePositiveInt,
  transaction,
  uniqueUsernameCandidate,
  iso,
  PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
};
