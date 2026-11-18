'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../logger');

let transporter = null;

function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendMail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    if (config.isProduction) {
      logger.warn('Email not sent (SMTP not configured)', { to, subject });
    } else {
      logger.info('Email not sent (SMTP not configured)', { to, subject, text });
    }
    return { delivered: false };
  }
  try {
    await mailer.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { delivered: true };
  } catch (error) {
    logger.error('Email delivery failed', error, { to, subject });
    return { delivered: false };
  }
}

function layout(title, body, ctaLabel, ctaUrl) {
  return `<!doctype html>
<html><body style="margin:0;background:#0a080d;color:#f3eef7;font-family:Segoe UI,Arial,sans-serif;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#141017;border:1px solid #2b2332;border-radius:18px;padding:32px">
    <div style="font-size:20px;font-weight:800;letter-spacing:2px;color:#C9A0DC;margin-bottom:24px">UNISON</div>
    <h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="color:#b3a6bc;line-height:1.6;font-size:15px">${body}</p>
    ${
      ctaUrl
        ? `<p style="margin:28px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#C9A0DC;color:#0a080d;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapeHtml(ctaLabel)}</a></p>
    <p style="color:#8a7d93;font-size:12px;word-break:break-all">${escapeHtml(ctaUrl)}</p>`
        : ''
    }
    <p style="color:#8a7d93;font-size:12px;margin-top:24px">Se você não solicitou esta ação, ignore este e-mail.</p>
  </div>
</body></html>`;
}

async function sendPasswordReset(to, username, token) {
  const url = `${config.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const result = await sendMail({
    to,
    subject: 'Redefinição de senha · UNISON',
    text: `Olá ${username}, redefina sua senha em: ${url} (válido por 30 minutos).`,
    html: layout(
      'Redefinir sua senha',
      `Olá <strong>${escapeHtml(username)}</strong>, recebemos uma solicitação para redefinir sua senha. O link expira em 30 minutos.`,
      'Redefinir senha',
      url,
    ),
  });
  return { ...result, url };
}

async function sendEmailVerification(to, username, token) {
  const url = `${config.appUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  const result = await sendMail({
    to,
    subject: 'Confirme seu e-mail · UNISON',
    text: `Olá ${username}, confirme seu e-mail em: ${url} (válido por 24 horas).`,
    html: layout(
      'Confirme seu e-mail',
      `Olá <strong>${escapeHtml(username)}</strong>, confirme seu endereço de e-mail para proteger sua conta. O link expira em 24 horas.`,
      'Confirmar e-mail',
      url,
    ),
  });
  return { ...result, url };
}

module.exports = { sendMail, sendPasswordReset, sendEmailVerification, layout };
