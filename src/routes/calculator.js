const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const calculatorController = require('../controllers/calculatorController');

// POST /api/calculator/calculate — public, no auth
router.post(
  '/calculate',
  [
    body('country')
      .trim()
      .notEmpty()
      .withMessage('Country is required'),
    body('weight')
      .isFloat({ min: 0.01 })
      .withMessage('Weight must be a positive number'),
    body('service_ids')
      .optional()
      .isArray()
      .withMessage('service_ids must be an array'),
  ],
  calculatorController.calculate
);

module.exports = router;
