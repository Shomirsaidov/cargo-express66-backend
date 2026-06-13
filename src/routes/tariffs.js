const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/tariffs/public — no auth required
router.get('/public', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tariffs')
      .select('id, country, price_per_kg, minimum_charge, delivery_time')
      .eq('is_active', true)
      .order('country');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/tariffs — admin sees all
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tariffs')
      .select('*')
      .order('country');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/tariffs/:id
router.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tariffs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Tariff not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/tariffs — admin only
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('country').trim().notEmpty().withMessage('Country is required'),
    body('price_per_kg').isFloat({ min: 0 }).withMessage('Valid price per kg is required'),
    body('minimum_charge').isFloat({ min: 0 }).withMessage('Valid minimum charge is required'),
  ],
  async (req, res, next) => {
    try {
      const { country, price_per_kg, minimum_charge, delivery_time, is_active = true } = req.body;
      const { data, error } = await supabaseAdmin
        .from('tariffs')
        .insert({ country, price_per_kg, minimum_charge, delivery_time, is_active })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/tariffs/:id
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { country, price_per_kg, minimum_charge, delivery_time, is_active } = req.body;
    const updates = {};
    if (country !== undefined) updates.country = country;
    if (price_per_kg !== undefined) updates.price_per_kg = price_per_kg;
    if (minimum_charge !== undefined) updates.minimum_charge = minimum_charge;
    if (delivery_time !== undefined) updates.delivery_time = delivery_time;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from('tariffs')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Tariff not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tariffs/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from('tariffs').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tariff deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
