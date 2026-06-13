const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/reports/weekly?format=excel|csv|pdf&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get(
  '/weekly',
  authenticate,
  requireRole('admin'),
  reportController.generateWeeklyReport
);

module.exports = router;
