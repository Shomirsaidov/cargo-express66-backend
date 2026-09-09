const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const { supabaseAdmin, supabase } = require('../config/supabase');
const emailTransporter = require('../config/email');
require('dotenv').config();

const PASSWORD_RESET_OTP_TTL_MINUTES = 10;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RESEND_SECONDS = 60;

function createPasswordResetOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return 'invalid-email';
  return `${local.slice(0, 2)}***@${domain}`;
}

async function sendPasswordResetEmail(email, otp, requestId) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  console.log('[OTP][SMTP_SEND_START]', {
    requestId,
    to: maskEmail(email),
    from: maskEmail(from || ''),
    transport: process.env.SMTP_SERVICE === 'gmail' || process.env.SMTP_HOST === 'smtp.gmail.com' ? 'gmail-465-tls' : 'custom',
  });

  const startedAt = Date.now();
  const info = await emailTransporter.sendMail({
    from: from ? `Cargo Express 66 <${from}>` : undefined,
    to: email,
    subject: 'Cargo Express 66 password reset code',
    text: `Your Cargo Express 66 password reset code is ${otp}. It expires in ${PASSWORD_RESET_OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h2 style="color:#2563eb">Cargo Express 66</h2><p>Use this one-time code to reset your password:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827">${otp}</p><p>This code expires in ${PASSWORD_RESET_OTP_TTL_MINUTES} minutes and can be used only once.</p><p style="color:#6b7280;font-size:13px">If you did not request a password reset, you can ignore this email.</p></div>`,
  });

  console.log('[OTP][SMTP_SEND_SUCCESS]', {
    requestId,
    to: maskEmail(email),
    messageId: info.messageId,
    response: info.response,
    accepted: info.accepted,
    rejected: info.rejected,
    durationMs: Date.now() - startedAt,
  });
  return info;
}

/**
 * Generate a unique customer code in the required format: CX-AAAAAA
 */
function numberToLetters(num, length = 6) {
  let result = '';
  let temp = num;

  for (let i = 0; i < length; i += 1) {
    const code = temp % 26;
    result = String.fromCharCode(65 + code) + result;
    temp = Math.floor(temp / 26);
  }

  return result;
}

async function generateCustomerCode() {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('customer_code');

  if (error) throw error;

  const existingCodes = Array.isArray(data) ? data.map((row) => row.customer_code).filter(Boolean) : [];
  const maxIndex = existingCodes.reduce((max, code) => {
    const match = /^CX-([A-Z]{6})$/.exec(code);
    if (!match) return max;

    const letters = match[1];
    let value = 0;
    for (let i = 0; i < letters.length; i += 1) {
      value = value * 26 + (letters.charCodeAt(i) - 65);
    }
    return Math.max(max, value + 1);
  }, 0);

  return `CX-${numberToLetters(maxIndex, 6)}`;
}

/**
 * Issue JWT access + refresh tokens for a user
 */
function issueTokens(userId, role) {
  const accessToken = jwt.sign(
    { sub: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const refreshToken = jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );

  return { accessToken, refreshToken };
}

/**
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorDetails = errors.array().map(e => `${e.param}: ${e.msg}`).join('; ');
      console.error('[REGISTER] Validation failed:', errorDetails);
      return res.status(422).json({
        error: 'Validation failed',
        details: errors.array(),
        message: errorDetails
      });
    }

    const { first_name, last_name, middle_name, phone, email, password, delivery_address } = req.body;
    const normalizedEmail = email.toLowerCase();

    console.log('[REGISTER] Attempting registration for email:', normalizedEmail);

    // Check if email already exists in customers
    const { data: existingCustomer, error: existingCustomerError } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingCustomerError) {
      console.error('[REGISTER] Error checking existing customer:', existingCustomerError);
      throw existingCustomerError;
    }

    if (existingCustomer) {
      console.warn('[REGISTER] Email already registered:', normalizedEmail);
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create auth user in Supabase Auth using admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });

    if (authError) {
      const message = authError.message || '';
      console.error('[REGISTER] Supabase auth creation failed:', message);
      if (/(already|exists|duplicate)/i.test(message)) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw authError;
    }

    const userId = authData.user.id;
    console.log('[REGISTER] Auth user created with ID:', userId);

    let customer;
    let customerError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const customerCode = await generateCustomerCode();
      const result = await supabaseAdmin
        .from('customers')
        .insert({
          user_id: userId,
          customer_code: customerCode,
          first_name,
          last_name,
          middle_name: middle_name || null,
          phone,
          email: normalizedEmail,
          delivery_address,
          role: 'customer',
          is_active: true,
        })
        .select()
        .single();

      customer = result.data;
      customerError = result.error;

      if (!customerError) {
        console.log('[REGISTER] Customer record created:', customerCode);
        break;
      }

      if (customerError.code === '23505' && /customer_code|email|user_id/i.test(customerError.message || '')) {
        console.warn(`[REGISTER] Duplicate key attempt ${attempt + 1}, retrying...`);
        continue;
      }

      break;
    }

    if (customerError) {
      console.error('[REGISTER] Customer creation failed:', customerError.message);
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw customerError;
    }

    const { accessToken, refreshToken } = issueTokens(userId, customer.role);

    console.log('[REGISTER] Registration successful for email:', normalizedEmail);
    res.status(201).json({
      message: 'Registration successful',
      data: {
        customer: sanitizeCustomer(customer),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    });
  } catch (err) {
    console.error('[REGISTER] Unexpected error:', err.message || err);
    next(err);
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorDetails = errors.array().map(e => `${e.param}: ${e.msg}`).join('; ');
      console.error('[LOGIN] Validation failed:', errorDetails);
      return res.status(422).json({
        error: 'Validation failed',
        details: errors.array(),
        message: errorDetails
      });
    }

    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();
    console.log('[LOGIN] Attempting login for email:', normalizedEmail);

    // Fetch customer by email
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (error || !customer) {
      console.warn('[LOGIN] Customer not found:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!customer.is_active) {
      console.warn('[LOGIN] Account deactivated:', normalizedEmail);
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    // Verify password via Supabase Auth
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: password
    });

    if (signInError) {
      console.warn('[LOGIN] Invalid password for email:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = issueTokens(customer.user_id, customer.role);

    console.log('[LOGIN] Login successful for email:', normalizedEmail, 'role:', customer.role);
    res.json({
      message: 'Login successful',
      data: {
        customer: sanitizeCustomer(customer),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    });
  } catch (err) {
    console.error('[LOGIN] Unexpected error:', err.message || err);
    next(err);
  }
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res, next) => {
  try {
    // Stateless JWT — client discards tokens
    // Optionally sign out from Supabase Auth session
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/refresh
 */
const refresh = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { refresh_token } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(
        refresh_token,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
      );
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // Fetch customer to get current role
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('user_id', decoded.sub)
      .single();

    if (error || !customer) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!customer.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const { accessToken, refreshToken: newRefreshToken } = issueTokens(decoded.sub, customer.role);

    res.json({
      data: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 */
const me = async (req, res, next) => {
  try {
    res.json({ data: sanitizeCustomer(req.user) });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/auth/me
 */
const updateProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const allowedFields = ['first_name', 'last_name', 'middle_name', 'phone', 'delivery_address'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(422).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ data: sanitizeCustomer(data) });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/auth/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { current_password, new_password } = req.body;

    // Verify current password via Supabase Auth
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: current_password
    });

    if (signInError) {
      return res.status(400).json({ error: 'Invalid current password' });
    }

    // Update in Supabase Auth
    if (req.user.user_id) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(req.user.user_id, {
        password: new_password
      });
      if (authError) throw authError;
    }

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const requestId = req.requestId || 'no-request-id';
    const startedAt = Date.now();
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.warn('[OTP][VALIDATION_FAILED]', { requestId, details: errors.array() });
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const normalizedEmail = req.body.email.toLowerCase();
    console.log('[OTP][START]', { requestId, email: maskEmail(normalizedEmail) });
    const genericResponse = {
      message: 'If an account exists for this email, a verification code has been sent.',
      request_id: requestId,
    };

    const { data: customer, error: customerError } = await supabaseAdmin
      .from('customers')
      .select('user_id, email, is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer || !customer.is_active) {
      console.log('[OTP][NO_ACTIVE_ACCOUNT]', { requestId, email: maskEmail(normalizedEmail) });
      return res.json(genericResponse);
    }
    console.log('[OTP][ACCOUNT_FOUND]', { requestId, userId: customer.user_id });

    const resendCutoff = new Date(Date.now() - PASSWORD_RESET_RESEND_SECONDS * 1000).toISOString();
    const { data: recentRequest, error: recentRequestError } = await supabaseAdmin
      .from('password_reset_otps')
      .select('id')
      .eq('email', normalizedEmail)
      .gte('requested_at', resendCutoff)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRequestError) throw recentRequestError;
    if (recentRequest) {
      console.log('[OTP][THROTTLED]', { requestId, email: maskEmail(normalizedEmail) });
      return res.json(genericResponse);
    }

    const otp = createPasswordResetOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin.from('password_reset_otps').insert({
      email: normalizedEmail,
      user_id: customer.user_id,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (insertError) throw insertError;
    console.log('[OTP][DB_INSERT_SUCCESS]', {
      requestId,
      expiresAt,
      durationMs: Date.now() - startedAt,
    });
    try {
      await sendPasswordResetEmail(normalizedEmail, otp, requestId);
    } catch (emailError) {
      await supabaseAdmin.from('password_reset_otps').delete().eq('email', normalizedEmail).eq('otp_hash', otpHash);
      console.error('[OTP][SMTP_SEND_FAILED]', {
        requestId,
        code: emailError.code,
        command: emailError.command,
        responseCode: emailError.responseCode,
        message: emailError.message,
        durationMs: Date.now() - startedAt,
      });
      return res.status(503).json({
        error: 'Email service is temporarily unavailable. Please try again later.',
        request_id: requestId,
      });
    }
    console.log('[OTP][COMPLETE]', { requestId, status: 200, durationMs: Date.now() - startedAt });
    return res.json(genericResponse);
  } catch (err) {
    console.error('[OTP][UNEXPECTED_ERROR]', {
      requestId: req.requestId || 'no-request-id',
      code: err.code,
      message: err.message || err,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
    next(err);
  }
};

/**
 * POST /api/auth/reset-password
 */
const resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { email, otp, new_password } = req.body;
    const normalizedEmail = email.toLowerCase();
    const { data: resetRequest, error: requestError } = await supabaseAdmin
      .from('password_reset_otps')
      .select('*')
      .eq('email', normalizedEmail)
      .is('used_at', null)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!resetRequest || new Date(resetRequest.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'The code is invalid or expired.' });
    }
    if (resetRequest.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    const isValidOtp = await bcrypt.compare(otp, resetRequest.otp_hash);
    if (!isValidOtp) {
      await supabaseAdmin
        .from('password_reset_otps')
        .update({ attempts: resetRequest.attempts + 1 })
        .eq('id', resetRequest.id);
      return res.status(400).json({ error: 'The code is invalid or expired.' });
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      resetRequest.user_id,
      { password: new_password }
    );
    if (updateAuthError) throw updateAuthError;

    const { error: consumeError } = await supabaseAdmin
      .from('password_reset_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('id', resetRequest.id);
    if (consumeError) throw consumeError;

    return res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('[RESET_PASSWORD] Unexpected error:', err.message || err);
    next(err);
  }
};

/**
 * Remove sensitive fields from customer object
 */
function sanitizeCustomer(customer) {
  const { password_hash, ...safe } = customer;
  return safe;
}

module.exports = {
  register,
  login,
  logout,
  refresh,
  me,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
