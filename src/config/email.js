const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify transporter on startup (non-blocking)
transporter.verify((error) => {
  if (error) {
    console.warn('Email transporter verification failed:', error.message);
  } else {
    console.log('Email transporter ready');
  }
});

module.exports = transporter;
