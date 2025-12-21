const express = require('express');
const router = express.Router();
const {
  joinMatchmaking,
  leaveMatchmaking,
  getMatchmakingStatus,
  getMatchmakingStats,
  joinMatchmakingValidation
} = require('../controllers/matchmaking');
const { authenticateToken } = require('../middleware/auth');

/**
 * Matchmaking routes for Disney Infinity multiplayer
 */

// Join matchmaking queue (requires authentication)
router.post('/join', authenticateToken, joinMatchmakingValidation, joinMatchmaking);

// Leave matchmaking queue (requires authentication)
router.post('/leave', authenticateToken, leaveMatchmaking);

// Get current matchmaking status (requires authentication)
router.get('/status', authenticateToken, getMatchmakingStatus);

// Get matchmaking statistics (public)
router.get('/stats', getMatchmakingStats);

module.exports = router;
