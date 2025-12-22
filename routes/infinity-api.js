/**
 * Infinity API Routes - Steam Format Compatibility
 * 
 * These routes provide compatibility with the Disney Infinity game client's expected paths.
 * The game expects: /infinity/{service}/v{version}/{platform}/
 * 
 * These routes redirect to the actual implementation in disney-ugc routes.
 */

const express = require('express');
const router = express.Router();

// Import the disney-ugc controller
const disneyController = require('../controllers/disney-ugc');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600,
    files: 2
  }
});

/**
 * UGC Routes - Map game client paths to disney-ugc controller
 */

// List public toyboxes
// GET /infinity/ugc/v2/steam/
router.get('/infinity/ugc/:version/:platform/', optionalAuth, (req, res) => {
  console.log(`📦 UGC LIST: Redirecting to disney-ugc controller`);
  // Transform to disney-ugc format and call controller
  req.params.product = 'infinity3';
  req.params.visibility = 'public';
  disneyController.listPublicToyboxes(req, res);
});

// Get specific toybox
// GET /infinity/ugc/v2/steam/{toyboxId}
router.get('/infinity/ugc/:version/:platform/:toyboxId', optionalAuth, (req, res) => {
  console.log(`📦 UGC GET: ${req.params.toyboxId}`);
  req.params.product = 'infinity3';
  req.params.visibility = 'public';
  disneyController.getToybox(req, res);
});

// Upload toybox
// POST /infinity/ugc/v2/steam/
router.post('/infinity/ugc/:version/:platform/', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), (req, res) => {
  console.log(`📦 UGC UPLOAD`);
  req.params.product = 'infinity3';
  req.params.visibility = 'public';
  disneyController.uploadToybox(req, res);
});

/**
 * Profile Routes - Stub for now
 */

// Get player profile
// GET /infinity/profile/v2/steam/
router.get('/infinity/profile/:version/:platform/', optionalAuth, (req, res) => {
  console.log(`👤 PROFILE GET`);
  // Return minimal profile
  res.json({
    status: 0,
    timestamp: Math.floor(Date.now() / 1000),
    profile: {
      userId: req.user?.userId || 'guest',
      username: req.user?.username || 'Guest Player',
      level: 1,
      experience: 0
    }
  });
});

// Update profile
// PUT /infinity/profile/v2/steam/
router.put('/infinity/profile/:version/:platform/', authenticateToken, (req, res) => {
  console.log(`👤 PROFILE UPDATE`);
  res.json({
    status: 0,
    timestamp: Math.floor(Date.now() / 1000),
    message: 'Profile updated'
  });
});

/**
 * Save Game Routes - Stub
 */
router.get('/infinity/save/:version/:platform/', authenticateToken, (req, res) => {
  console.log(`💾 SAVE GET`);
  res.json({ status: 0, timestamp: Math.floor(Date.now() / 1000), saves: [] });
});

router.post('/infinity/save/:version/:platform/', authenticateToken, (req, res) => {
  console.log(`💾 SAVE POST`);
  res.json({ status: 0, timestamp: Math.floor(Date.now() / 1000), message: 'Saved' });
});

/**
 * Ticker/News Routes - Stub
 */
router.get('/infinity/ticker/:version/:platform/', (req, res) => {
  console.log(`📰 TICKER GET`);
  res.json({
    status: 0,
    timestamp: Math.floor(Date.now() / 1000),
    news: []
  });
});

/**
 * Leaderboard Routes - Stub
 */
router.get('/infinity/leaderboard/:version/:platform/', (req, res) => {
  console.log(`🏆 LEADERBOARD GET`);
  res.json({
    status: 0,
    timestamp: Math.floor(Date.now() / 1000),
    leaderboard: []
  });
});

/**
 * Entitlement/DLC Routes - Stub
 */
router.get('/infinity/entitlement/:version/:platform', (req, res) => {
  console.log(`🎁 ENTITLEMENT GET`);
  res.json({
    status: 0,
    timestamp: Math.floor(Date.now() / 1000),
    entitlements: []
  });
});

module.exports = router;
