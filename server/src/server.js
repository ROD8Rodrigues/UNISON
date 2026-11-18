'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { attachRealtime } = require('./realtime');

function cleanupOrphanUploads(db) {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = db
      .prepare('SELECT * FROM attachments WHERE message_id IS NULL AND created_at < ?')
      .all(cutoff);
    for (const row of rows) {
      const filePath = path.join(config.uploadDir, row.filename);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // File may already be gone; database cleanup still applies.
      }
      db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
    }
    if (rows.length) logger.info('Cleaned orphan uploads', { count: rows.length });
  } catch (error) {
    logger.warn('Orphan upload cleanup failed', { message: error.message });
  }
}

function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = openDatabase(config.databasePath);
  const app = createApp({ db });
  const server = http.createServer(app);
  const io = attachRealtime(server, db);

  cleanupOrphanUploads(db);
  const cleanupTimer = setInterval(() => cleanupOrphanUploads(db), 6 * 60 * 60 * 1000);
  cleanupTimer.unref?.();

  server.listen(config.port, config.host, () => {
    logger.info('UNISON server started', {
      port: config.port,
      host: config.host,
      env: config.env,
      database: config.databasePath,
      appUrl: config.appUrl,
    });
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info('Shutting down', { signal });
    clearInterval(cleanupTimer);
    io.close();
    server.close(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  if (process.send) {
    process.on('message', (message) => {
      if (message && message.type === 'shutdown') shutdown('desktop');
    });
  }
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('uncaughtException');
  });
}

if (require.main === module) {
  main();
}

module.exports = { main, cleanupOrphanUploads };
