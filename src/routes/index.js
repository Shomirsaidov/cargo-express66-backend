const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const customerRoutes = require('./customers');
const parcelRoutes = require('./parcels');
const trackingRoutes = require('./tracking');
const airwaybillRoutes = require('./airwaybills');
const warehouseRoutes = require('./warehouses');
const tariffRoutes = require('./tariffs');
const serviceRoutes = require('./services');
const notificationRoutes = require('./notifications');
const reportRoutes = require('./reports');
const settingsRoutes = require('./settings');
const cmsRoutes = require('./cms');
const calculatorRoutes = require('./calculator');
const adminRoutes = require('./admin');

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/parcels', parcelRoutes);
router.use('/tracking', trackingRoutes);
router.use('/airwaybills', airwaybillRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/tariffs', tariffRoutes);
router.use('/services', serviceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/settings', settingsRoutes);
router.use('/cms', cmsRoutes);
router.use('/calculator', calculatorRoutes);
router.use('/admin', adminRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
