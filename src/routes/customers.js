const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const customerController = require('../controllers/customerController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/customers/me/profile — current customer profile
router.get('/me/profile', authenticate, customerController.getMyProfile);

// GET /api/customers — admin only
router.get('/', authenticate, requireRole('admin'), customerController.list);

// GET /api/customers/:id — admin only
router.get('/:id', authenticate, requireRole('admin'), customerController.getById);

// PUT /api/customers/:id — admin or the customer themselves
router.put(
  '/:id',
  authenticate,
  [
    body('first_name').optional().trim().notEmpty(),
    body('last_name').optional().trim().notEmpty(),
    body('phone').optional().trim().notEmpty(),
    body('delivery_address').optional().trim().notEmpty(),
  ],
  customerController.update
);

// DELETE /api/customers/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), customerController.remove);

module.exports = router;
