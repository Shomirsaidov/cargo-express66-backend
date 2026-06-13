const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/services/public — no auth required
router.get('/public', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('additional_services')
      .select('id, name, description, price, price_type, percentage, minimum_fee')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/services — admin
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('additional_services')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/services/:id
router.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('additional_services')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Service not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/services — admin only
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('price_type')
      .isIn(['fixed', 'percentage'])
      .withMessage('price_type must be fixed or percentage'),
  ],
  async (req, res, next) => {
    try {
      const { name, description, price, price_type, percentage, minimum_fee, is_active = true } = req.body;
      const { data, error } = await supabaseAdmin
        .from('additional_services')
        .insert({ name, description, price, price_type, percentage, minimum_fee, is_active })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/services/:id
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, description, price, price_type, percentage, minimum_fee, is_active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (price_type !== undefined) updates.price_type = price_type;
    if (percentage !== undefined) updates.percentage = percentage;
    if (minimum_fee !== undefined) updates.minimum_fee = minimum_fee;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from('additional_services')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Service not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/services/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('additional_services')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Service deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
