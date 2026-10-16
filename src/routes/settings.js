const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

/**
 * Keys of the `settings` table that are safe to expose on the public website.
 * Structured content (contacts, addresses, FAQ, About page, footer) is stored
 * as JSON in `value`; scalar values are returned as-is.
 */
const PUBLIC_SETTING_KEYS = [
  'company_name',
  'contact_phone',
  'contact_email',
  'office_address',
  'site_contacts',
  'site_locations',
  'site_faq',
  'site_about',
  'site_footer',
];

/** Parse JSON values, leave plain strings untouched. */
const parseSettingValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

// GET /api/settings/public — public site content (NO authentication)
// MUST be declared before '/:key' so Express does not route it to the admin handler.
router.get('/public', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', PUBLIC_SETTING_KEYS);

    if (error) throw error;

    const payload = {};
    for (const row of data || []) {
      payload[row.key] = parseSettingValue(row.value);
    }

    res.json({ data: payload });
  } catch (err) {
    next(err);
  }
});

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

    // `settings.value` is TEXT — serialize structured content (arrays/objects)
    // so the admin UI can post JSON directly.
    const storedValue = typeof value === 'string' ? value : JSON.stringify(value);

    const { data, error } = await supabaseAdmin
      .from('settings')
      .upsert(
        { key: req.params.key, value: storedValue, description },
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
