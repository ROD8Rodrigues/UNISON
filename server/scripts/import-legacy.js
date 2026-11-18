'use strict';

/**
 * One-time importer for the legacy NeDB user database.
 *
 * The prototype stored users as newline-delimited JSON in server/data/users.db.
 * Passwords are already bcrypt hashes, so they continue to work. Friends,
 * conversations and messages from the old prototype are not imported because
 * they reference NeDB-only identifiers and test-only data.
 *
 * Run from server/: npm run import:legacy
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { id, now } = require('../src/utils/helpers');

const legacyPath = path.join(__dirname, '..', 'data', 'users.db');

function parseDate(value) {
  if (!value) return now();
  if (value.$$date) return Number(value.$$date);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : now();
}

function main() {
  if (!fs.existsSync(legacyPath)) {
    console.log(`No legacy users database found at ${legacyPath}`);
    return;
  }
  const raw = fs.readFileSync(legacyPath, 'utf8').trim();
  if (!raw) {
    console.log('Legacy users database is empty');
    return;
  }
  const db = openDatabase(config.databasePath);
  let imported = 0;
  let skipped = 0;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let legacy;
    try {
      legacy = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!legacy.username || !legacy.email || !legacy.password) {
      skipped += 1;
      continue;
    }
    const exists = db
      .prepare('SELECT 1 AS ok FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(legacy.username, legacy.email);
    if (exists) {
      skipped += 1;
      continue;
    }
    const userId = id();
    const createdAt = parseDate(legacy.createdAt);
    const displayName = (legacy.profile && legacy.profile.displayName) || legacy.username;
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, display_name, bio, avatar_url,
        presence, last_seen, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, 0, ?, ?)`,
    ).run(
      userId,
      String(legacy.username).toLowerCase(),
      String(legacy.email).toLowerCase(),
      legacy.password,
      displayName,
      (legacy.profile && legacy.profile.bio) || '',
      (legacy.profile && legacy.profile.avatar) || null,
      createdAt,
      createdAt,
      createdAt,
    );
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, accent, updated_at)
       VALUES (?, 'dark', '#C9A0DC', ?)`,
    ).run(userId, now());
    imported += 1;
    console.log(`Imported @${legacy.username} (${legacy.email})`);
  }
  db.close();
  console.log(`\nDone. Imported: ${imported}. Skipped: ${skipped}.`);
  console.log('Legacy passwords were kept intact; users can sign in with their existing credentials.');
}

main();
