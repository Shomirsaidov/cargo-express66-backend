const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/notifications — get current user's notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Admin can see all or filter by customer
    if (req.user.role === 'admin' && req.query.customer_id) {
      query = query.eq('customer_id', req.query.customer_id);
    } else if (req.user.role !== 'admin') {
      query = query.eq('customer_id', req.user.id);
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
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', req.user.id)
      .eq('is_read', false);

    if (error) throw error;
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/:id/read — mark single notification as read
router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    // Ensure notification belongs to user (unless admin)
    const filter = supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id);

    if (req.user.role !== 'admin') {
      filter.eq('customer_id', req.user.id);
    }

    const { data, error } = await filter.select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('customer_id', req.user.id)
      .eq('is_read', false);

    if (error) throw error;
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    let query = supabaseAdmin.from('notifications').delete().eq('id', req.params.id);
    if (req.user.role !== 'admin') {
      query = query.eq('customer_id', req.user.id);
    }
    const { error } = await query;
    if (error) throw error;
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
