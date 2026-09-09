const nodemailer = require('nodemailer');
require('dotenv').config();

const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const isGmail = smtpHost === 'smtp.gmail.com' || process.env.SMTP_SERVICE === 'gmail';

const transporter = nodemailer.createTransport({
  ...(isGmail
    ? {
        service: 'gmail',
        port: 465,
        secure: true,
      }
    : {
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: process.env.SMTP_SECURE !== 'false',
      }),
  auth: {
    user: process.env.SMTP_USER,
    pass: (process.env.SMTP_PASS || '').replace(/\s/g, ''),
  },
  tls: {
    minVersion: 'TLSv1.2',
    servername: smtpHost,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

console.log(`Email transporter configured: ${isGmail ? 'Gmail implicit TLS (465)' : `${smtpHost}:${process.env.SMTP_PORT || 465}`}`);

// Verify transporter on startup (non-blocking)
transporter.verify((error) => {
  if (error) {
    console.warn('Email transporter verification failed:', {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      message: error.message,
    });
  } else {
    console.log('Email transporter ready: SMTP connection and authentication accepted');
  }
});

module.exports = transporter;
