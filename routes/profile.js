/**
 * Profile Routes
 * API endpoints for user profile management
 */

const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateProfile,
  updateAvatar,
  getDetailedStats,
  getPublicProfile
} = require('../controllers/profile');

// Profile management routes
router.get('/', getProfile);
router.put('/', updateProfile);
router.put('/avatar', updateAvatar);

// Statistics routes
router.get('/stats/detailed', getDetailedStats);

// Public profile routes (no authentication required for viewing)
router.get('/public/:userId', getPublicProfile);

module.exports = router;
