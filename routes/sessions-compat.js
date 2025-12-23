const express = require('express');
const router = express.Router();
const {
  createSession,
  joinSession,
  leaveSession,
  getSession,
  listSessions,
  updateSessionStatus
} = require('../controllers/sessions');
const { authenticateToken } = require('../middleware/auth');

/**
 * CoreGames Sessions v1 API Compatibility Routes
 * 
 * The Wii U (and other platforms) expect multiplayer session management
 * at /coregames/sessions/v1/ endpoints. These routes map to our modern session system.
 * 
 * Original Disney endpoints we're replicating:
 * - POST /coregames/sessions/v1/create - Create new multiplayer session
 * - POST /coregames/sessions/v1/join - Join existing session
 * - POST /coregames/sessions/v1/{id}/leave - Leave a session
 * - GET /coregames/sessions/v1/{id} - Get session details
 * - GET /coregames/sessions/v1/list - List available sessions
 * - PUT /coregames/sessions/v1/{id}/status - Update session status
 */

/**
 * POST /coregames/sessions/v1/create
 * Create a new multiplayer game session
 */
router.post('/create', authenticateToken, async (req, res) => {
  console.log('🎮 Sessions v1: Create session request from game client');
  console.log('   User:', req.user.username);
  
  try {
    await createSession(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session creation failed:', error);
    res.status(500).json({
      error: 'SESSION_CREATE_FAILED',
      message: 'Could not create multiplayer session'
    });
  }
});

/**
 * POST /coregames/sessions/v1/join
 * Join an existing multiplayer session
 */
router.post('/join', authenticateToken, async (req, res) => {
  console.log('🎮 Sessions v1: Join session request from game client');
  console.log('   User:', req.user.username);
  
  try {
    await joinSession(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session join failed:', error);
    res.status(500).json({
      error: 'SESSION_JOIN_FAILED',
      message: 'Could not join multiplayer session'
    });
  }
});

/**
 * POST /coregames/sessions/v1/:sessionId/leave
 * Leave a multiplayer session
 */
router.post('/:sessionId/leave', authenticateToken, async (req, res) => {
  console.log('🎮 Sessions v1: Leave session request from game client');
  console.log('   User:', req.user.username);
  console.log('   Session:', req.params.sessionId);
  
  try {
    await leaveSession(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session leave failed:', error);
    res.status(500).json({
      error: 'SESSION_LEAVE_FAILED',
      message: 'Could not leave multiplayer session'
    });
  }
});

/**
 * GET /coregames/sessions/v1/:sessionId
 * Get details about a specific session
 */
router.get('/:sessionId', async (req, res) => {
  console.log('🎮 Sessions v1: Get session details request');
  console.log('   Session:', req.params.sessionId);
  
  try {
    await getSession(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session fetch failed:', error);
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: 'Session does not exist'
    });
  }
});

/**
 * GET /coregames/sessions/v1/list
 * List all available multiplayer sessions
 */
router.get('/list', async (req, res) => {
  console.log('🎮 Sessions v1: List sessions request from game client');
  
  try {
    await listSessions(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session list failed:', error);
    res.status(500).json({
      error: 'SESSION_LIST_FAILED',
      message: 'Could not retrieve session list'
    });
  }
});

/**
 * Alternative list endpoint (without /list suffix)
 * Some game versions might call /coregames/sessions/v1/ directly
 */
router.get('/', async (req, res) => {
  console.log('🎮 Sessions v1: List sessions request (root) from game client');
  
  try {
    await listSessions(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session list failed:', error);
    res.status(500).json({
      error: 'SESSION_LIST_FAILED',
      message: 'Could not retrieve session list'
    });
  }
});

/**
 * PUT /coregames/sessions/v1/:sessionId/status
 * Update session status (host only)
 */
router.put('/:sessionId/status', authenticateToken, async (req, res) => {
  console.log('🎮 Sessions v1: Update session status request');
  console.log('   User:', req.user.username);
  console.log('   Session:', req.params.sessionId);
  console.log('   New status:', req.body.status);
  
  try {
    await updateSessionStatus(req, res);
  } catch (error) {
    console.error('❌ Sessions v1: Session status update failed:', error);
    res.status(500).json({
      error: 'SESSION_UPDATE_FAILED',
      message: 'Could not update session status'
    });
  }
});

module.exports = router;
