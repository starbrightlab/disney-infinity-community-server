/**
 * Config Routes
 * Disney Infinity game client configuration endpoint
 * 
 * This endpoint is THE CRITICAL FIRST CALL the game makes on startup.
 * Without this working, NO multiplayer features will function.
 */

const express = require('express');
const router = express.Router();

/**
 * GET /coregames/config/v1/infinity3/steam/
 * 
 * Returns the service endpoint configuration for the Disney Infinity game client.
 * This tells the game where to find all other API services.
 * 
 * The game client expects this exact endpoint based on the TARGET_WIN32 + USE_STEAMWORKS build.
 */
router.get('/coregames/config/v1/infinity3/steam/', (req, res) => {
  console.log('📡 CONFIG REQUEST: Game client requesting service configuration');
  console.log('📡 IMPORTANT: Returning dibeyond.com URLs (not api.dibeyond.com)');
  
  // Build the base URL from environment or use dibeyond.com (NO api. prefix!)
  // The game client queries dibeyond.com directly (not api.dibeyond.com)  
  const baseUrl = process.env.API_BASE_URL || 'https://dibeyond.com';
  
  // This JSON response tells the game where ALL services are located
  const config = {
    // Save game data endpoint
    "url_inf_save": `${baseUrl}/infinity/save/v1/steam/`,
    
    // News/ticker endpoint (can be dummy for now)
    "url_inf_ticker": `${baseUrl}/infinity/ticker/v1/steam/`,
    
    // User Generated Content (Toy Boxes) - CRITICAL for community content
    "url_inf_ugc": `${baseUrl}/infinity/ugc/v2/steam/`,
    
    // Player profiles - CRITICAL for multiplayer
    "url_inf_profile": `${baseUrl}/infinity/profile/v2/steam/`,
    
    // Leaderboards
    "url_inf_leaderboard": `${baseUrl}/infinity/leaderboard/v1/steam/`,
    
    // DLC/Entitlements (can return empty for community server)
    "url_inf_entitlement": `${baseUrl}/infinity/entitlement/v1/steam`,
    
    // Shop URL (can be dummy)
    "url_web_disney_shop": `${baseUrl}/pc-shop`,
    
    // NAT negotiation domain
    "domain_cg_natneg": "dibeyond.com",
    
    // Disney ID creation endpoint - CRITICAL for authentication
    "url_cg_did_create": `${baseUrl}`,
    
    // Friends list endpoint
    "url_cg_friends": `${baseUrl}/coregames/friends/v1/steam`,
    
    // Matchmaking endpoint - CRITICAL for multiplayer sessions
    "url_cg_matchmaking": `${baseUrl}/coregames/matchmaking/v1`,
    
    // Player reporting (can be dummy)
    "url_social_report_player": `${baseUrl}/gxtools/report/v2/queue`
  };
  
  console.log('✅ CONFIG RESPONSE: Sending service configuration to game client');
  console.log('   Base URL:', baseUrl);
  console.log('   Endpoints configured:', Object.keys(config).length);
  
  // Return the configuration
  res.json(config);
});

/**
 * Alternative endpoint for other platforms (if needed in future)
 * Gold Edition uses /pc/ path despite being the Steam version
 */
router.get('/coregames/config/v1/infinity3/:platform/', (req, res) => {
  const { platform } = req.params;
  console.log(`📡 CONFIG REQUEST: Received for platform: ${platform}`);
  
  // Use dibeyond.com (NOT api.dibeyond.com) to match URL patches
  const baseUrl = process.env.API_BASE_URL || 'https://dibeyond.com';
  
  const config = {
    "url_inf_save": `${baseUrl}/infinity/save/v1/${platform}/`,
    "url_inf_ticker": `${baseUrl}/infinity/ticker/v1/${platform}/`,
    "url_inf_ugc": `${baseUrl}/infinity/ugc/v2/${platform}/`,
    "url_inf_profile": `${baseUrl}/infinity/profile/v2/${platform}/`,
    "url_inf_leaderboard": `${baseUrl}/infinity/leaderboard/v1/${platform}/`,
    "url_inf_entitlement": `${baseUrl}/infinity/entitlement/v1/${platform}`,
    "url_web_disney_shop": `${baseUrl}/pc-shop`,
    "domain_cg_natneg": "dibeyond.com",
    "url_cg_did_create": `${baseUrl}`,
    "url_cg_friends": `${baseUrl}/coregames/friends/v1/${platform}`,
    "url_cg_matchmaking": `${baseUrl}/coregames/matchmaking/v1`,
    "url_social_report_player": `${baseUrl}/gxtools/report/v2/queue`
  };
  
  console.log('✅ CONFIG RESPONSE: Sending service configuration to game client');
  console.log('   Platform:', platform);
  console.log('   Base URL:', baseUrl);
  console.log('   Endpoints configured:', Object.keys(config).length);
  
  res.json(config);
});

module.exports = router;
