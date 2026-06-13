const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const trackingController = require('../controllers/trackingController');
const { authenticate } = require('../middleware/auth');

// All tracking routes require authentication

// GET /api/tracking — list customer's tracking numbers
router.get('/', authenticate, trackingController.list);

// POST /api/tracking — add tracking number
router.post(
  '/',
  authenticate,
  [
    body('tracking_number').trim().notEmpty().withMessage('Tracking number is required'),
    body('store_name').optional().trim(),
    body('country_of_origin').optional().trim(),
    body('warehouse_id').optional(),
    body('notes').optional().trim(),
  ],
  trackingController.create
);

// PUT /api/tracking/:id — update tracking number
router.put(
  '/:id',
  authenticate,
  [
    body('tracking_number').optional().trim().notEmpty(),
    body('store_name').optional().trim(),
    body('country_of_origin').optional().trim(),
    body('warehouse_id').optional(),
    body('notes').optional().trim(),
  ],
  trackingController.update
);

// DELETE /api/tracking/:id — delete tracking number
router.delete('/:id', authenticate, trackingController.remove);

module.exports = router;
