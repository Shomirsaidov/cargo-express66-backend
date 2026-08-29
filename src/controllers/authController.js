const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { validationResult } = require('express-validator');
const { supabaseAdmin, supabase } = require('../config/supabase');
require('dotenv').config();

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
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { first_name, last_name, middle_name, phone, email, password, delivery_address } = req.body;

    const normalizedEmail = email.toLowerCase();

    // Check if email already exists in customers
    const { data: existingCustomer, error: existingCustomerError } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingCustomerError) {
      throw existingCustomerError;
    }

    if (existingCustomer) {
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
      if (/(already|exists|duplicate)/i.test(message)) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw authError;
    }

    const userId = authData.user.id;

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

      if (!customerError) break;

      if (customerError.code === '23505' && /customer_code|email|user_id/i.test(customerError.message || '')) {
        continue;
      }

      break;
    }

    if (customerError) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw customerError;
    }

    const { accessToken, refreshToken } = issueTokens(userId, customer.role);

    res.status(201).json({
      message: 'Registration successful',
      data: {
        customer: sanitizeCustomer(customer),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    });
  } catch (err) {
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
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { email, password } = req.body;

    // Fetch customer by email
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !customer) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!customer.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    // Verify password via Supabase Auth
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password: password
    });

    if (signInError) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = issueTokens(customer.user_id, customer.role);

    res.json({
      message: 'Login successful',
      data: {
        customer: sanitizeCustomer(customer),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    });
  } catch (err) {
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
 * Remove sensitive fields from customer object
 */
function sanitizeCustomer(customer) {
  const { password_hash, ...safe } = customer;
  return safe;
}

module.exports = { register, login, logout, refresh, me, updateProfile, changePassword };
