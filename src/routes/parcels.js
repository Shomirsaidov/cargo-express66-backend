const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const multer = require('multer');
const parcelController = require('../controllers/parcelController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// GET /api/parcels/scan/:tracking_number — warehouse fast scan
router.get(
  '/scan/:tracking_number',
  authenticate,
  requireRole('admin', 'warehouse_employee'),
  parcelController.scan
);

// GET /api/parcels/track/:tracking_number — public tracking
router.get('/track/:tracking_number', parcelController.getByTrackingNumber);

// GET /api/parcels — list (admin/warehouse see all; customer sees own)
router.get('/', authenticate, parcelController.list);

// GET /api/parcels/:id
router.get('/:id', authenticate, parcelController.getById);

// POST /api/parcels — admin/warehouse create
router.post(
  '/',
  authenticate,
  requireRole('admin', 'warehouse_employee'),
  upload.array('photos', 10),
  [
    body('tracking_number').trim().notEmpty().withMessage('Tracking number is required'),
    body('warehouse_id').notEmpty().withMessage('Warehouse is required'),
  ],
  parcelController.create
);

// PUT /api/parcels/:id — admin/warehouse update
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'warehouse_employee'),
  upload.array('photos', 10),
  parcelController.update
);

// PUT /api/parcels/:id/status — update parcel status
router.put(
  '/:id/status',
  authenticate,
  requireRole('admin', 'warehouse_employee'),
  [body('status').notEmpty().withMessage('Status is required')],
  parcelController.updateStatus
);

// DELETE /api/parcels/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), parcelController.remove);

module.exports = router;
