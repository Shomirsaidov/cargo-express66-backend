const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');

function sanitizeCustomer(customer) {
  const { password_hash, ...safe } = customer;
  return safe;
}

/**
 * GET /api/customers/me/profile
 */
const getMyProfile = async (req, res, next) => {
  try {
    res.json({ data: sanitizeCustomer(req.user) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/customers — admin list
 */
const list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role || '';

    let query = supabaseAdmin
      .from('customers')
      .select('id, customer_code, first_name, last_name, middle_name, phone, email, delivery_address, role, is_active, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,customer_code.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }
    if (role) {
      query = query.eq('role', role);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      data,
      pagination: { page, limit, total: count },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/customers/:id — admin
 */
const getById = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('customers')
      .select('id, customer_code, first_name, last_name, middle_name, phone, email, delivery_address, role, is_active, created_at')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Customer not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/customers/:id — admin or the customer themselves
 */
const update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    // Only admin can update other users; customers can only update themselves
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowedFields = ['first_name', 'last_name', 'middle_name', 'phone', 'delivery_address'];

    // Admin can also change role and is_active
    if (req.user.role === 'admin') {
      allowedFields.push('role', 'is_active');
    }

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
      .eq('id', req.params.id)
      .select('id, customer_code, first_name, last_name, middle_name, phone, email, delivery_address, role, is_active, created_at')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer not found' });

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/customers/:id — admin only
 */
const remove = async (req, res, next) => {
  try {
    // Fetch customer to get user_id for Supabase Auth deletion
    const { data: customer, error: fetchError } = await supabaseAdmin
      .from('customers')
      .select('user_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Delete from customers table
    const { error } = await supabaseAdmin
      .from('customers')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    // Delete from Supabase Auth
    if (customer.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(customer.user_id);
    }

    res.json({ message: 'Customer deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyProfile, list, getById, update, remove };
