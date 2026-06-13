const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const airwaybillController = require('../controllers/airwaybillController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/airwaybills
router.get('/', authenticate, requireRole('admin', 'warehouse_employee'), airwaybillController.list);

// GET /api/airwaybills/:id
router.get('/:id', authenticate, requireRole('admin', 'warehouse_employee'), airwaybillController.getById);

// POST /api/airwaybills — create AWB
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('awb_number').trim().notEmpty().withMessage('AWB number is required'),
    body('departure_country').trim().notEmpty().withMessage('Departure country is required'),
    body('departure_date').isISO8601().withMessage('Valid departure date is required'),
  ],
  airwaybillController.create
);

// PUT /api/airwaybills/:id — update AWB
router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  airwaybillController.update
);

// DELETE /api/airwaybills/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), airwaybillController.remove);

// POST /api/airwaybills/:id/parcels — assign parcel to AWB
router.post(
  '/:id/parcels',
  authenticate,
  requireRole('admin', 'warehouse_employee'),
  [body('parcel_id').notEmpty().withMessage('Parcel ID is required')],
  airwaybillController.assignParcel
);

// DELETE /api/airwaybills/:id/parcels/:parcel_id — remove parcel from AWB
router.delete(
  '/:id/parcels/:parcel_id',
  authenticate,
  requireRole('admin'),
  airwaybillController.removeParcel
);

// PUT /api/airwaybills/:id/status — update AWB status
router.put(
  '/:id/status',
  authenticate,
  requireRole('admin'),
  [body('status').notEmpty().withMessage('Status is required')],
  airwaybillController.updateStatus
);

module.exports = router;
