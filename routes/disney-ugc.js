/**
 * Disney Infinity UGC Routes (Primary Implementation)
 * 
 * This router implements Disney's original UGC API URL structure as the primary interface.
 * Format: /{version}/{product}/{visibility}/toybox
 * 
 * All responses use Disney's original format with numeric status codes and Unix timestamps.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { cacheMiddleware, cacheHelpers } = require('../middleware/cache');
const disneyController = require('../controllers/disney-ugc');

// Configure multer for Disney-style multipart uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600, // 100MB
    files: 2 // data/content + screenshot
  },
  fileFilter: (req, file, cb) => {
    // Accept both 'data' and 'content' as field names (Disney used both)
    if (file.fieldname === 'data' || file.fieldname === 'content') {
      cb(null, true);
    } else if (file.fieldname === 'screenshot') {
      cb(null, true);
    } else {
      cb(new Error(`Unexpected field: ${file.fieldname}`), false);
    }
  }
});

// ============================================================================
// PUBLIC TOYBOX ENDPOINTS
// ============================================================================

/**
 * List public toyboxes
 * GET /{version}/{product}/public/toybox
 * 
 * Query parameters:
 * - page: Page number (default: 1)
 * - page_size: Results per page (default: 100, max: 200)
 * - sort_field: last_update_time | creation_time | download_count | title
 * - sort_direction: asc | desc (default: desc)
 * - creators: Comma-separated creator usernames
 * - igps: Comma-separated character IDs
 * - abilities: Comma-separated ability IDs
 * - genres: Comma-separated genre IDs
 * - versions: Comma-separated game versions (2,3)
 * - minimum_performance: 1-100 performance score filter
 * - hardware_group: 1 (low) | 2 (high, default)
 * - isFeatured: true | false
 */
router.get('/:version/:product/public/toybox', optionalAuth, cacheMiddleware(300, (req) => {
  const params = new URLSearchParams(req.query);
  params.sort();
  return `GET:/${req.params.version}/${req.params.product}/public/toybox?${params.toString()}`;
}), disneyController.listPublicToyboxes);

/**
 * Create/upload public toybox
 * POST /{version}/{product}/public/toybox
 * 
 * Multipart form data:
 * - data or content: Binary toybox file (required)
 * - screenshot: PNG/JPEG image (optional)
 * - metadata: JSON string (optional) OR individual form fields
 */
router.post('/:version/:product/public/toybox', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), async (req, res, next) => {
  // Set visibility and status for public upload
  req.body.visibility = 'public';
  req.body.auto_publish = process.env.AUTO_APPROVE_PUBLIC === 'true';
  
  await disneyController.uploadToybox(req, res, next);
  
  // Clear cache after successful upload
  if (res.statusCode >= 200 && res.statusCode < 300) {
    cacheHelpers.clearToyboxCache();
  }
});

/**
 * Get specific public toybox
 * GET /{version}/{product}/public/toybox/{id}
 * 
 * Accept header determines response:
 * - application/octet-stream: Returns binary toybox file
 * - application/json: Returns metadata
 */
router.get('/:version/:product/public/toybox/:id', optionalAuth, disneyController.downloadToybox);

/**
 * Get toybox screenshot
 * GET /{version}/{product}/public/toybox/{id}/screenshot
 * 
 * Returns: PNG/JPEG image with X-Binary-Metadata header
 */
router.get('/:version/:product/public/toybox/:id/screenshot', disneyController.getScreenshot);

/**
 * Like a toybox
 * POST /{version}/{product}/public/toybox/{id}/like
 * 
 * Returns: Like count and user's like status
 */
router.post('/:version/:product/public/toybox/:id/like', authenticateToken, async (req, res, next) => {
  await disneyController.likeToybox(req, res, next);
  
  // Clear cache for this toybox
  if (res.statusCode >= 200 && res.statusCode < 300) {
    cacheHelpers.clearToyboxCache(req.params.id);
  }
});

/**
 * Get trending toyboxes
 * GET /{version}/{product}/public/toybox/trending
 * 
 * Query parameters:
 * - genre: Genre ID filter (optional)
 * - versions: Comma-separated game versions (default: 2,3)
 * - minimum_performance: Performance threshold (default: 1)
 * - hardware_group: 1 | 2 (default: 2)
 */
router.get('/:version/:product/public/toybox/trending', cacheMiddleware(900, (req) => {
  const { genre, versions, hardware_group } = req.query;
  return `GET:/${req.params.version}/${req.params.product}/public/toybox/trending?genre=${genre || ''}&versions=${versions || '2,3'}&hw=${hardware_group || 2}`;
}), disneyController.getTrending);

/**
 * Get trending toyboxes for specific genre
 * GET /{version}/{product}/public/toybox/trending/{genre}
 */
router.get('/:version/:product/public/toybox/trending/:genre', cacheMiddleware(900, (req) => {
  return `GET:/${req.params.version}/${req.params.product}/public/toybox/trending/${req.params.genre}`;
}), disneyController.getTrendingByGenre);

/**
 * Search toyboxes
 * GET /{version}/{product}/public/toybox/search
 * 
 * Query parameters:
 * - term: Search query (required)
 * - page: Page number (default: 1)
 * - page_size: Results per page (default: 100)
 * - hardware_group: 1 | 2 (default: 2)
 */
router.get('/:version/:product/public/toybox/search', disneyController.searchToyboxes);

/**
 * Get toybox object counts
 * GET /{version}/{product}/public/toybox/{id}/object_counts
 */
router.get('/:version/:product/public/toybox/:id/object_counts', disneyController.getObjectCounts);

// ============================================================================
// PRIVATE TOYBOX ENDPOINTS
// ============================================================================

/**
 * List user's private toyboxes
 * GET /{version}/{product}/private/toybox
 */
router.get('/:version/:product/private/toybox', authenticateToken, disneyController.listPrivateToyboxes);

/**
 * Create private toybox
 * POST /{version}/{product}/private/toybox
 */
router.post('/:version/:product/private/toybox', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), async (req, res, next) => {
  req.body.visibility = 'private';
  req.body.auto_publish = false;
  
  await disneyController.uploadToybox(req, res, next);
});

/**
 * Get specific private toybox
 * GET /{version}/{product}/private/toybox/{id}
 */
router.get('/:version/:product/private/toybox/:id', authenticateToken, disneyController.downloadPrivateToybox);

/**
 * Update private toybox
 * PUT /{version}/{product}/private/toybox/{id}
 */
router.put('/:version/:product/private/toybox/:id', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), disneyController.updateToybox);

/**
 * Delete private toybox
 * DELETE /{version}/{product}/private/toybox/{id}
 */
router.delete('/:version/:product/private/toybox/:id', authenticateToken, disneyController.deleteToybox);

// ============================================================================
// HELPER MIDDLEWARE
// ============================================================================

// Add product and version info to request for controllers
router.use((req, res, next) => {
  if (req.params.product) {
    req.disney = {
      version: req.params.version || 'v1',
      product: req.params.product, // pc, ios, x360, ps3, ps4, wiiu, etc.
      visibility: req.path.includes('/private/') ? 'private' : 'public'
    };
  }
  next();
});

module.exports = router;
