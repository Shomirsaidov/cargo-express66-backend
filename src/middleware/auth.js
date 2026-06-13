const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
require('dotenv').config();

/**
 * Verify JWT from Authorization header and attach customer to req.user.
 * Supports both custom JWTs (issued by authController) and Supabase JWTs.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify custom JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch customer profile using user_id stored in JWT
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

    req.user = customer;
    req.userId = decoded.sub;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

/**
 * Optional auth — attaches user if token present, proceeds either way.
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next();
    }

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('user_id', decoded.sub)
      .single();

    if (customer && customer.is_active) {
      req.user = customer;
      req.userId = decoded.sub;
    }
    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, optionalAuthenticate };
