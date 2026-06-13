const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { validationResult } = require('express-validator');
const { supabaseAdmin, supabase } = require('../config/supabase');
require('dotenv').config();

/**
 * Generate a unique customer code: CX66-XXXXXX
 */
async function generateCustomerCode() {
  const { count, error } = await supabaseAdmin
    .from('customers')
    .select('id', { count: 'exact', head: true });

  if (error) throw error;
  const next = (count || 0) + 1;
  return `CX66-${String(next).padStart(6, '0')}`;
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

    // Check if email already exists in customers
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create auth user in Supabase Auth using admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw authError;
    }

    const userId = authData.user.id;

    // Generate customer code
    const customerCode = await generateCustomerCode();

    // Create customer record
    const { data: customer, error: customerError } = await supabaseAdmin
      .from('customers')
      .insert({
        user_id: userId,
        customer_code: customerCode,
        first_name,
        last_name,
        middle_name: middle_name || null,
        phone,
        email: email.toLowerCase(),
        delivery_address,
        role: 'customer',
        is_active: true,
      })
      .select()
      .single();

    if (customerError) {
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
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
