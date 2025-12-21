const express = require('express');
const router = express.Router();
const {
  createSession,
  joinSession,
  leaveSession,
  getSession,
  listSessions,
  updateSessionStatus,
  createSessionValidation,
  joinSessionValidation
} = require('../controllers/sessions');
const { authenticateToken } = require('../middleware/auth');

/**
 * Session management routes for Disney Infinity multiplayer
 */

// Create a new game session (requires authentication)
router.post('/create', authenticateToken, createSessionValidation, createSession);

// Join an existing game session (requires authentication)
router.post('/join', authenticateToken, joinSessionValidation, joinSession);

// Leave a game session (requires authentication)
router.post('/:sessionId/leave', authenticateToken, leaveSession);

// Get session details (public for listing, authenticated for full details)
router.get('/:sessionId', getSession);

// List available sessions (public)
router.get('/', listSessions);

// Update session status (host only, requires authentication)
router.put('/:sessionId/status', authenticateToken, updateSessionStatus);

module.exports = router;
