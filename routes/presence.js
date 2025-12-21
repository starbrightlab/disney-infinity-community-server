const express = require('express');
const router = express.Router();
const {
  updatePresence,
  getFriendPresence,
  getOnlineFriends,
  getMyPresence,
  bulkPresenceQuery,
  cleanupStalePresence,
  updatePresenceValidation
} = require('../controllers/presence');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');

/**
 * Presence routes for real-time player status tracking
 */

// Update own presence status (requires authentication)
router.post('/update', authenticateToken, updatePresenceValidation, updatePresence);

// Get friend presence statuses (requires authentication)
router.get('/friends', authenticateToken, getFriendPresence);

// Get only online friends (requires authentication)
router.get('/friends/online', authenticateToken, getOnlineFriends);

// Get own presence status (requires authentication)
router.get('/me', authenticateToken, getMyPresence);

// Bulk presence query for multiple users (requires authentication)
router.post('/bulk', authenticateToken, bulkPresenceQuery);

// Clean up stale presence data (admin only)
router.post('/cleanup', authenticateToken, requireAdmin, cleanupStalePresence);

module.exports = router;
