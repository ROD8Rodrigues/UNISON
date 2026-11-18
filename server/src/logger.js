'use strict';

const config = require('./config');

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: config.isProduction ? undefined : error.stack,
  };
}

function write(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta || {}),
  };
  if (config.isTest && level !== 'error') return;
  const line = config.isProduction ? JSON.stringify(entry) : `[${entry.time}] ${level.toUpperCase()} ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, error, meta) => write('error', message, { ...meta, error: serializeError(error) }),
  debug: (message, meta) => {
    if (config.env !== 'production') write('debug', message, meta);
  },
};
