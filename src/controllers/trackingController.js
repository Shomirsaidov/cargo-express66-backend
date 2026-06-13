const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');

/**
 * GET /api/tracking — list customer's tracking numbers
 */
const list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('tracking_numbers')
      .select('*, warehouses(name, country)', { count: 'exact' })
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data, pagination: { page, limit, total: count } });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/tracking — add tracking number
 */
const create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { tracking_number, store_name, country_of_origin, warehouse_id, notes } = req.body;

    // Check for duplicate tracking number for this customer
    const { data: existing } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id')
      .eq('customer_id', req.user.id)
      .eq('tracking_number', tracking_number.trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Tracking number already added' });
    }

    const { data, error } = await supabaseAdmin
      .from('tracking_numbers')
      .insert({
        customer_id: req.user.id,
        tracking_number: tracking_number.trim(),
        store_name: store_name || null,
        country_of_origin: country_of_origin || null,
        warehouse_id: warehouse_id || null,
        notes: notes || null,
        is_linked: false,
      })
      .select('*, warehouses(name, country)')
      .single();

    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/tracking/:id
 */
const update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    // Ensure ownership
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id, customer_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Tracking number not found' });

    if (req.user.role !== 'admin' && existing.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { tracking_number, store_name, country_of_origin, warehouse_id, notes } = req.body;
    const updates = {};
    if (tracking_number !== undefined) updates.tracking_number = tracking_number.trim();
    if (store_name !== undefined) updates.store_name = store_name;
    if (country_of_origin !== undefined) updates.country_of_origin = country_of_origin;
    if (warehouse_id !== undefined) updates.warehouse_id = warehouse_id;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('tracking_numbers')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, warehouses(name, country)')
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/tracking/:id
 */
const remove = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id, customer_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Tracking number not found' });

    if (req.user.role !== 'admin' && existing.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { error } = await supabaseAdmin
      .from('tracking_numbers')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Tracking number deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, create, update, remove };
