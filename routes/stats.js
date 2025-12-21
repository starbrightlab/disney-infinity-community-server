const express = require('express');
const router = express.Router();
const {
  submitMatchStats,
  getPlayerStats,
  getLeaderboard,
  getRecentMatches,
  submitMatchStatsValidation
} = require('../controllers/stats');
const { authenticateToken } = require('../middleware/auth');

/**
 * Statistics routes for game performance tracking
 */

// Submit match statistics (requires authentication)
router.post('/match', authenticateToken, submitMatchStatsValidation, submitMatchStats);

// Get player statistics (requires authentication)
router.get('/player/:userId', authenticateToken, getPlayerStats);

// Get leaderboard (public)
router.get('/leaderboard', getLeaderboard);

// Get recent matches for authenticated user (requires authentication)
router.get('/recent', authenticateToken, getRecentMatches);

module.exports = router;
