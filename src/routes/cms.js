const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/cms — list all pages (public: only published)
router.get('/', async (req, res, next) => {
  try {
    let query = supabaseAdmin
      .from('cms_pages')
      .select('id, slug, title_ru, title_en, is_published')
      .order('slug');

    // Only return published pages to non-admin
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/cms/:slug — public (published only for unauthenticated)
router.get('/:slug', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cms_pages')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Page not found' });

    // Hide unpublished pages from public
    if (!data.is_published && !req.headers.authorization) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/cms/:slug — admin only (upsert)
router.put(
  '/:slug',
  authenticate,
  requireRole('admin'),
  [
    body('title_ru').optional().trim(),
    body('title_en').optional().trim(),
    body('content_ru').optional(),
    body('content_en').optional(),
  ],
  async (req, res, next) => {
    try {
      const { title_ru, title_en, content_ru, content_en, is_published } = req.body;
      const updates = { slug: req.params.slug };
      if (title_ru !== undefined) updates.title_ru = title_ru;
      if (title_en !== undefined) updates.title_en = title_en;
      if (content_ru !== undefined) updates.content_ru = content_ru;
      if (content_en !== undefined) updates.content_en = content_en;
      if (is_published !== undefined) updates.is_published = is_published;

      const { data, error } = await supabaseAdmin
        .from('cms_pages')
        .upsert(updates, { onConflict: 'slug' })
        .select()
        .single();

      if (error) throw error;
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/cms/:slug — admin only
router.delete('/:slug', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('cms_pages')
      .delete()
      .eq('slug', req.params.slug);
    if (error) throw error;
    res.json({ message: 'Page deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
