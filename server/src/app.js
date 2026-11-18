'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { errors, errorHandler, notFoundHandler } = require('./utils/errors');
const { requestContext, securityHeaders } = require('./middleware/http');
const { generalLimiter } = require('./middleware/rateLimit');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createFriendsRouter } = require('./routes/friends');
const { createConversationsRouter } = require('./routes/conversations');
const { createMessagesRouter } = require('./routes/messages');
const {
  createSpacesRouter,
  createChannelsRouter,
  createInvitesRouter,
} = require('./routes/spaces');
const { createNotificationsRouter } = require('./routes/notifications');
const { createUploadsRouter } = require('./routes/uploads');
const { createCallsRouter } = require('./routes/calls');

function corsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  };
}

function createApp({ db }) {
  if (!db) throw new Error('createApp requires a database instance');
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", ...config.corsOrigins, 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(securityHeaders);
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  fs.mkdirSync(config.uploadDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '7d',
      immutable: true,
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      },
    }),
  );

  app.get('/health', (req, res) => {
    let database = 'ok';
    try {
      db.prepare('SELECT 1 AS ok').get();
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'unison-server',
      version: config.version,
      database,
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/api/health', (req, res) => res.redirect(307, '/health'));

  app.use('/api', generalLimiter);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/users', createUsersRouter(db));
  app.use('/api/friends', createFriendsRouter(db));
  app.use('/api/conversations', createConversationsRouter(db));
  app.use('/api', createMessagesRouter(db));
  app.use('/api/spaces', createSpacesRouter(db));
  app.use('/api/channels', createChannelsRouter(db));
  app.use('/api/invites', createInvitesRouter(db));
  app.use('/api/notifications', createNotificationsRouter(db));
  app.use('/api/uploads', createUploadsRouter(db));
  app.use('/api/calls', createCallsRouter(db));

  app.use('/api', (req, res, next) => next(errors.notFound('Endpoint da API não encontrado')));

  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  const clientIndex = path.join(clientDist, 'index.html');
  if (fs.existsSync(clientIndex)) {
    app.use(
      express.static(clientDist, {
        index: false,
        dotfiles: 'deny',
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
          if (filePath.endsWith(`${path.sep}sw.js`)) {
            res.setHeader('Service-Worker-Allowed', '/');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/uploads') || req.path.startsWith('/api')) {
        return next();
      }
      return res.sendFile(clientIndex);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, corsOptions };
