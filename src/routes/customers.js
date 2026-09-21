const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const customerController = require('../controllers/customerController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/customers/me/profile — current customer profile
router.get('/me/profile', authenticate, customerController.getMyProfile);

// GET /api/customers — admin and warehouse employee search/list
router.get('/', authenticate, requireRole('admin', 'warehouse_employee'), customerController.list);

// GET /api/customers/:id — admin only
router.get('/:id', authenticate, requireRole('admin'), customerController.getById);

router.put(
  '/:id',
  authenticate,
  [
    body('first_name').optional().trim().notEmpty().withMessage('Имя не может быть пустым'),
    body('last_name').optional().trim().notEmpty().withMessage('Фамилия не может быть пустой'),
    body('middle_name').optional().trim(),
    body('phone').optional().trim(),
    body('delivery_address').optional().trim(),
    body('role').optional().isIn(['customer', 'warehouse_employee', 'admin']),
    body('is_active').optional().isBoolean(),
  ],
  customerController.update
);

// DELETE /api/customers/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), customerController.remove);

module.exports = router;
