const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/settings — admin only
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('*')
      .order('key');

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/:key — admin only
router.get('/:key', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('key', req.params.key)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Setting not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/:key — upsert setting value
router.put('/:key', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { value, description } = req.body;
    if (value === undefined) {
      return res.status(422).json({ error: 'Value is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('settings')
      .upsert(
        { key: req.params.key, value, description },
        { onConflict: 'key' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
