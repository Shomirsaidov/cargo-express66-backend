const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/destination-countries — public list of active destination countries
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('destination_countries')
      .select('*')
      .order('name');

    if (error) {
      // Fallback if table doesn't exist yet or other DB error
      console.warn('DB error fetching destination countries, using seed defaults:', error.message);
      return res.json({
        data: [
          { id: '1', name: 'Таджикистан', is_active: true },
          { id: '2', name: 'Узбекистан', is_active: true },
          { id: '3', name: 'Азербайджан', is_active: true },
          { id: '4', name: 'Казахстан', is_active: true },
          { id: '5', name: 'Киргизия', is_active: true }
        ]
      });
    }
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/destination-countries/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('destination_countries')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Destination country not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/destination-countries — admin only
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
  ],
  async (req, res, next) => {
    try {
      const { name, is_active = true } = req.body;
      const { data, error } = await supabaseAdmin
        .from('destination_countries')
        .insert({ name, is_active })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/destination-countries/:id — admin only
router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { name, is_active } = req.body;
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (is_active !== undefined) updates.is_active = is_active;

      const { data, error } = await supabaseAdmin
        .from('destination_countries')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Destination country not found' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/destination-countries/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('destination_countries')
      .delete()
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Destination country not found' });
    res.json({ message: 'Destination country deleted successfully', data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
