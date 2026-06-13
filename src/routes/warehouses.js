const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/warehouses — public list of active warehouses
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('warehouses')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/warehouses/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('warehouses')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Warehouse not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/warehouses — admin only
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('country').trim().notEmpty().withMessage('Country is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
  ],
  async (req, res, next) => {
    try {
      const { name, country, city, address, is_active = true } = req.body;
      const { data, error } = await supabaseAdmin
        .from('warehouses')
        .insert({ name, country, city, address, is_active })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/warehouses/:id — admin only
router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { name, country, city, address, is_active } = req.body;
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (country !== undefined) updates.country = country;
      if (city !== undefined) updates.city = city;
      if (address !== undefined) updates.address = address;
      if (is_active !== undefined) updates.is_active = is_active;

      const { data, error } = await supabaseAdmin
        .from('warehouses')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Warehouse not found' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/warehouses/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('warehouses')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Warehouse deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
