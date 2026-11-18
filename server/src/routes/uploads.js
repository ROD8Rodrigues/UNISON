'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { errors } = require('../utils/errors');
const { now } = require('../utils/helpers');
const config = require('../config');

const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['audio/mpeg', '.mp3'],
  ['audio/wav', '.wav'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.webm'],
  ['audio/mp4', '.m4a'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/zip', '.zip'],
  ['application/x-zip-compressed', '.zip'],
  ['application/msword', '.doc'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptx',
  ],
]);

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, config.uploadDir),
  filename: (req, file, callback) => {
    const extension = ALLOWED.get(file.mimetype) || '.bin';
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 5,
    fieldSize: 1024,
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED.has(file.mimetype)) {
      return callback(
        errors.badRequest(
          'Tipo de arquivo não suportado. Permitidos: imagens, áudio, vídeo, PDF, texto, zip e documentos do Office.',
          'UNSUPPORTED_FILE',
        ),
      );
    }
    callback(null, true);
  },
});

function createUploadsRouter(db) {
  const router = express.Router();
  router.use(authenticate(db, config));

  router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
    if (!req.file) throw errors.badRequest('Nenhum arquivo foi enviado', 'NO_FILE');
    const attachmentId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO attachments (id, message_id, uploader_id, filename, original_name, mime_type, size, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attachmentId,
      req.user.id,
      req.file.filename,
      path.basename(req.file.originalname).slice(0, 200),
      req.file.mimetype,
      req.file.size,
      now(),
    );
    res.status(201).json({
      attachment: {
        id: attachmentId,
        name: path.basename(req.file.originalname).slice(0, 200),
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
      },
    });
  });

  return router;
}

module.exports = { createUploadsRouter, ALLOWED_UPLOAD_TYPES: [...ALLOWED.keys()] };
