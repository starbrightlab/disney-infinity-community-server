const express = require('express');
const router = express.Router();
const {
  registerSteamId,
  getSteamLobby,
  createSteamLobby,
  updateSteamLobby,
  getSteamFriends,
  reportSteamOverlay,
  getSteamAchievements,
  registerSteamIdValidation,
  createSteamLobbyValidation,
  updateSteamLobbyValidation,
  reportSteamOverlayValidation
} = require('../controllers/steam');
const { authenticateToken } = require('../middleware/auth');

/**
 * Steam integration routes for Steamworks API coordination
 */

// Register Steam ID for user (requires authentication)
router.post('/register', authenticateToken, registerSteamIdValidation, registerSteamId);

// Get Steam lobby information for a session (requires authentication)
router.get('/lobby/:sessionId', authenticateToken, getSteamLobby);

// Create Steam lobby for a session (host only, requires authentication)
router.post('/lobby/:sessionId/create', authenticateToken, createSteamLobbyValidation, createSteamLobby);

// Update Steam lobby metadata (host only, requires authentication)
router.put('/lobby/:sessionId/metadata', authenticateToken, updateSteamLobbyValidation, updateSteamLobby);

// Get Steam friends integration (requires authentication)
router.get('/friends', authenticateToken, getSteamFriends);

// Report Steam overlay status (requires authentication)
router.post('/overlay', authenticateToken, reportSteamOverlayValidation, reportSteamOverlay);

// Get Steam achievements/progress (requires authentication)
router.get('/achievements', authenticateToken, getSteamAchievements);

module.exports = router;
