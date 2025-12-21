/**
 * Analytics Routes
 * API endpoints for advanced analytics and insights
 */

const express = require('express');
const router = express.Router();
const {
  getPlayerAnalytics,
  getServerAnalytics,
  getPerformanceTrends
} = require('../controllers/analytics');

// Player analytics
router.get('/player/:userId?', getPlayerAnalytics);

// Performance trends
router.get('/trends', getPerformanceTrends);

// Server-wide analytics (admin only)
router.get('/server', getServerAnalytics);

module.exports = router;
