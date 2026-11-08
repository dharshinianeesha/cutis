const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;

function getTransporter() {
  if (transporter) return transporter;
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    configured = false;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 465,
    secure: EMAIL_SECURE !== 'false',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
  configured = true;
  return transporter;
}

async function sendOtpEmail(toAddress, code) {
  const t = getTransporter();
  if (!t) {
    // No email credentials set — this is the honest failure mode, not a silent fake success.
    const err = new Error('Email sending is not configured. Set EMAIL_HOST/EMAIL_USER/EMAIL_PASS in .env.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  await t.sendMail({
    from,
    to: toAddress,
    subject: 'Your Cutis verification code',
    text: `Your Cutis verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;">
      <p>Your Cutis verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p style="color:#666;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>`
  });
}

function isEmailConfigured() {
  getTransporter();
  return configured;
}

module.exports = { sendOtpEmail, isEmailConfigured };
