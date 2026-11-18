'use strict';

const logger = require('../logger');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  badRequest: (message = 'Invalid request', code = 'BAD_REQUEST', details) =>
    new AppError(400, code, message, details),
  unauthorized: (message = 'Autenticação necessária', code = 'UNAUTHORIZED') =>
    new AppError(401, code, message),
  forbidden: (message = 'You do not have permission to do that', code = 'FORBIDDEN') =>
    new AppError(403, code, message),
  notFound: (message = 'Not found', code = 'NOT_FOUND') => new AppError(404, code, message),
  conflict: (message = 'Already exists', code = 'CONFLICT') => new AppError(409, code, message),
  tooMany: (message = 'Too many requests', code = 'RATE_LIMITED') => new AppError(429, code, message),
  internal: (message = 'Erro interno do servidor') => new AppError(500, 'INTERNAL', message),
};

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado' } });
}

const ENGLISH_ZOD_MESSAGES =
  /^(Invalid input|Invalid option|Too small|Too big|Invalid string|Invalid email|Invalid UUID|Invalid URL|Unrecognized key|Invalid enum value|Invalid date|Invalid type|Expected )/i;

function validationMessage(issue) {
  if (issue.message && !ENGLISH_ZOD_MESSAGES.test(issue.message)) return issue.message;
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? 'Campo obrigatório' : 'Tipo inválido';
    case 'too_small':
      if (issue.origin === 'string') return `Mínimo de ${issue.minimum} caracteres`;
      if (issue.origin === 'array') return `Selecione pelo menos ${issue.minimum} item(ns)`;
      return `Valor mínimo: ${issue.minimum}`;
    case 'too_big':
      if (issue.origin === 'string') return `Máximo de ${issue.maximum} caracteres`;
      if (issue.origin === 'array') return `Selecione no máximo ${issue.maximum} item(ns)`;
      return `Valor máximo: ${issue.maximum}`;
    case 'invalid_format':
      return 'Formato inválido';
    case 'unrecognized_keys':
      return 'Campo não reconhecido';
    default:
      return 'Valor inválido';
  }
}

function errorHandler(error, req, res, next) {
  let status = error.status || 500;
  let code = error.code || 'INTERNAL';
  let message = error.message;
  let details = error.details;

  if (error.name === 'ZodError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Alguns campos são inválidos';
    details = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: validationMessage(issue),
    }));
  }

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'O corpo da requisição não é um JSON válido';
  }

  if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'O corpo da requisição é muito grande';
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    code = 'FILE_TOO_LARGE';
    message = 'O arquivo excede o tamanho máximo permitido';
  }

  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    status = 409;
    code = 'CONFLICT';
    message = 'Esse valor já está em uso';
  }

  if (status >= 500) {
    logger.error('Unhandled request error', error, { path: req.path, method: req.method });
    message = 'Erro interno do servidor';
  }

  if (res.headersSent) return next(error);
  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(req.id ? { requestId: req.id } : {}),
    },
  });
}

module.exports = { AppError, errors, errorHandler, notFoundHandler };
