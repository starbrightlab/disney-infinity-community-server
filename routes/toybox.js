const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  uploadToybox,
  downloadToybox,
  listToyboxes,
  uploadValidation,
  downloadValidation,
  listValidation
} = require('../controllers/toybox');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { cacheMiddleware, cacheHelpers } = require('../middleware/cache');

/**
 * Toybox routes
 */

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600, // 100MB default
    files: 2 // content + screenshot
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'application/octet-stream,image/png,image/jpeg').split(',');

    if (file.fieldname === 'content' && !allowedTypes.includes('application/octet-stream')) {
      return cb(new Error('Invalid content file type'), false);
    }

    if (file.fieldname === 'screenshot' && !allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid screenshot file type'), false);
    }

    cb(null, true);
  }
});

// Simple toybox list for debugging (temporary)
router.get('/simple', async (req, res) => {
  try {
    const { supabase } = require('../config/database');
    const { data, error } = await supabase
      .from('toyboxes')
      .select('id,title,created_at,creator_id')
      .limit(5);

    if (error) {
      console.log('Toybox query error:', error);
      return res.status(500).json({
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
    }

    console.log('Toybox query success:', data);
    res.json({ toyboxes: data });
  } catch (err) {
    console.log('Toybox query exception:', err);
    res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
});

// Test endpoint with NO middleware at all (temporary)
router.get('/test', (req, res) => {
  console.log('🧪 TEST ENDPOINT: Request received');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Query:', req.query);
  console.log('Headers:', req.headers);

  res.json({
    success: true,
    message: 'Test endpoint reached',
    method: req.method,
    path: req.path,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

// Query test endpoint (temporary)
router.get('/query', async (req, res) => {
  try {
    console.log('🔍 QUERY ENDPOINT: Testing database query');
    const { supabase } = require('../config/database');

    const { data, error } = await supabase
      .from('toyboxes')
      .select('id,title,created_at')
      .eq('status', 3)
      .limit(5);

    if (error) {
      console.log('❌ Query error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Query success:', data?.length || 0, 'results');
    res.json({ success: true, toyboxes: data });
  } catch (err) {
    console.log('💥 Query exception:', err);
    res.status(500).json({ error: err.message });
  }
});

// Simplified list toyboxes for debugging (temporary) - no middleware
router.get('/basic', async (req, res) => {
  try {
    const { supabase } = require('../config/database');
    const { data, error } = await supabase
      .from('toyboxes')
      .select('id,title,creator_id,created_at,status')
      .eq('status', 3) // published only
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log('Basic toybox list error:', error);
      return res.status(500).json({ error: error.message, code: error.code });
    }

    console.log('Basic toybox list success:', data?.length || 0, 'results');
    res.json({ toyboxes: data || [] });
  } catch (err) {
    console.log('Basic toybox list exception:', err);
    res.status(500).json({ error: err.message });
  }
});

// List toyboxes (public) - cached for 5 minutes
router.get('/', listValidation, optionalAuth, cacheMiddleware(300, (req) => {
  // Create cache key based on query parameters
  const params = new URLSearchParams(req.query);
  params.sort(); // Ensure consistent key ordering
  return `GET:/api/v1/toybox?${params.toString()}`;
}), listToyboxes);

// Upload toybox (requires authentication)
router.post('/', authenticateToken, upload.fields([
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), uploadValidation, async (req, res, next) => {
  // Call controller
  await uploadToybox(req, res, next);

  // Clear cache after successful upload
  if (res.statusCode >= 200 && res.statusCode < 300) {
    cacheHelpers.clearToyboxCache();
  }
});

// Download toybox (public for published toyboxes)
router.get('/:id', downloadValidation, optionalAuth, downloadToybox);

// Get toybox screenshot
router.get('/:id/screenshot', downloadValidation, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const { createClient } = require('@supabase/supabase-js');
    const winston = require('winston');

    const { id } = req.params;

    // Get toybox screenshot info
    const result = await query(
      'SELECT screenshot, screenshot_metadata FROM toyboxes WHERE id = $1 AND status = 3',
      [id]
    );

    if (result.rows.length === 0 || !result.rows[0].screenshot) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Screenshot not found'
        }
      });
    }

    const toybox = result.rows[0];

    // Download from Supabase (skip in test environment)
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(501).json({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Screenshot download not available in test environment'
        }
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET || 'toyboxes')
      .download(toybox.screenshot);

    if (error) {
      winston.error('Screenshot download error:', error);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Screenshot download failed'
        }
      });
    }

    // Set headers
    res.setHeader('Content-Type', 'image/png');
    if (toybox.screenshot_metadata) {
      res.setHeader('X-Binary-Metadata', JSON.stringify(toybox.screenshot_metadata));
    }

    // Stream image data
    data.arrayBuffer().then(buffer => {
      res.send(Buffer.from(buffer));
    });

  } catch (err) {
    const winston = require('winston');
    winston.error('Screenshot fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch screenshot'
      }
    });
  }
});

// Rate toybox
router.post('/:id/rate', authenticateToken, downloadValidation, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const winston = require('winston');
    const { rating } = req.body;

    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Rating must be a number between 1 and 5'
        }
      });
    }

    const { id } = req.params;

    // Check if toybox exists and is published
    const toyboxResult = await query(
      'SELECT id FROM toyboxes WHERE id = $1 AND status = 3',
      [id]
    );

    if (toyboxResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    // Insert or update rating
    await query(`
      INSERT INTO toybox_ratings (toybox_id, user_id, rating)
      VALUES ($1, $2, $3)
      ON CONFLICT (toybox_id, user_id)
      DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()
    `, [id, req.user.id, rating]);

    // Get updated average rating
    const avgResult = await query(
      'SELECT AVG(rating) as average FROM toybox_ratings WHERE toybox_id = $1',
      [id]
    );

    winston.info(`Toybox rated: ${id} by ${req.user.username} (${rating} stars)`);

    // Clear cache for this toybox
    cacheHelpers.clearToyboxCache(id);

    res.json({
      toybox_id: id,
      user_id: req.user.id,
      rating: rating,
      average_rating: parseFloat(avgResult.rows[0].average)
    });

  } catch (err) {
    const winston = require('winston');
    winston.error('Rating error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to submit rating'
      }
    });
  }
});

// Like/unlike toybox
router.post('/:id/like', authenticateToken, downloadValidation, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const winston = require('winston');

    const { id } = req.params;

    // Check if toybox exists and is published
    const toyboxResult = await query(
      'SELECT id FROM toyboxes WHERE id = $1 AND status = 3',
      [id]
    );

    if (toyboxResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    // Check if already liked
    const existingLike = await query(
      'SELECT id FROM toybox_likes WHERE toybox_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    let liked;
    if (existingLike.rows.length > 0) {
      // Unlike
      await query(
        'DELETE FROM toybox_likes WHERE toybox_id = $1 AND user_id = $2',
        [id, req.user.id]
      );
      liked = false;
    } else {
      // Like
      await query(
        'INSERT INTO toybox_likes (toybox_id, user_id) VALUES ($1, $2)',
        [id, req.user.id]
      );
      liked = true;
    }

    // Get updated like count
    const countResult = await query(
      'SELECT COUNT(*) as count FROM toybox_likes WHERE toybox_id = $1',
      [id]
    );

    winston.info(`Toybox ${liked ? 'liked' : 'unliked'}: ${id} by ${req.user.username}`);

    // Clear cache for this toybox
    cacheHelpers.clearToyboxCache(id);

    res.json({
      toybox_id: id,
      liked: liked,
      likes_count: parseInt(countResult.rows[0].count)
    });

  } catch (err) {
    const winston = require('winston');
    winston.error('Like error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update like status'
      }
    });
  }
});

// Get trending toyboxes - cached for 15 minutes
router.get('/trending', cacheMiddleware(900, (req) => {
  const { genre, limit } = req.query;
  return `GET:/api/v1/toybox/trending?genre=${genre || ''}&limit=${limit || 20}`;
}), async (req, res) => {
  try {
    const { query } = require('../config/database');
    const { genre, limit = 20 } = req.query;

    // Trending algorithm: weighted score based on downloads, ratings, and recency
    let queryText = `
      SELECT
        t.id, t.title, t.description, t.created_at, t.download_count,
        u.username as creator_display_name,
        COALESCE(AVG(r.rating), 0) as average_rating,
        COUNT(DISTINCT r.id) as rating_count,
        COUNT(DISTINCT l.id) as like_count,
        -- Trending score: downloads + (ratings * 10) + (recency bonus)
        (t.download_count +
         (COALESCE(AVG(r.rating), 0) * 10) +
         GREATEST(0, 30 - EXTRACT(EPOCH FROM (NOW() - t.created_at))/86400) * 2) as trending_score
      FROM toyboxes t
      LEFT JOIN users u ON t.creator_id = u.id
      LEFT JOIN toybox_ratings r ON t.id = r.toybox_id
      LEFT JOIN toybox_likes l ON t.id = l.toybox_id
      WHERE t.status = 3 AND t.created_at > NOW() - INTERVAL '90 days'
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Genre filter
    if (genre) {
      queryText += ` AND $${paramIndex} = ANY(t.genres)`;
      queryParams.push(parseInt(genre));
      paramIndex++;
    }

    queryText += `
      GROUP BY t.id, u.username
      HAVING COUNT(DISTINCT r.id) > 0 OR t.download_count > 0
      ORDER BY trending_score DESC
      LIMIT $${paramIndex}
    `;

    queryParams.push(parseInt(limit));

    const result = await query(queryText, queryParams);

    const items = result.rows.map(row => ({
      id: row.id,
      name: row.title,
      creator_display_name: row.creator_display_name,
      downloads: { count: parseInt(row.download_count) },
      likes: { count: parseInt(row.like_count) },
      rating: parseFloat(row.average_rating),
      created_at: row.created_at,
      trending_score: parseFloat(row.trending_score)
    }));

    res.json(items);

  } catch (err) {
    const winston = require('winston');
    winston.error('Trending fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch trending toyboxes'
      }
    });
  }
});

// Get user's toyboxes
router.get('/user/list', authenticateToken, async (req, res) => {
  try {
    const { query } = require('../config/database');

    const result = await query(`
      SELECT
        id, title, description, status, created_at, updated_at, download_count,
        (SELECT AVG(rating) FROM toybox_ratings WHERE toybox_id = toyboxes.id) as average_rating,
        (SELECT COUNT(*) FROM toybox_ratings WHERE toybox_id = toyboxes.id) as rating_count,
        (SELECT COUNT(*) FROM toybox_likes WHERE toybox_id = toyboxes.id) as like_count
      FROM toyboxes
      WHERE creator_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);

    const toyboxes = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status === 1 ? 'in_review' : row.status === 2 ? 'approved' : row.status === 3 ? 'published' : 'unknown',
      created_at: row.created_at,
      updated_at: row.updated_at,
      downloads: { count: parseInt(row.download_count) },
      likes: { count: parseInt(row.like_count) },
      rating: parseFloat(row.average_rating || 0)
    }));

    res.json(toyboxes);

  } catch (err) {
    const winston = require('winston');
    winston.error('User toyboxes fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch user toyboxes'
      }
    });
  }
});

module.exports = router;
