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
  console.log('🧪 TEST ENDPOINT V2: Request received at', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Path:', req.path);

  res.json({
    success: true,
    message: 'Test endpoint V2 reached',
    timestamp: new Date().toISOString(),
    deployed: true
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
    const { supabase } = require('../config/database');
    const winston = require('winston');

    const { id } = req.params;

    // Get toybox screenshot info
    const { data: toybox, error } = await supabase
      .from('toyboxes')
      .select('screenshot, screenshot_metadata')
      .eq('id', id)
      .eq('status', 3)
      .single();

    if (error || !toybox || !toybox.screenshot) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Screenshot not found'
        }
      });
    }

    // Download from Supabase storage
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
    const { supabase } = require('../config/database');
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
    const { data: toybox, error: toyboxError } = await supabase
      .from('toyboxes')
      .select('id')
      .eq('id', id)
      .eq('status', 3)
      .single();

    if (toyboxError || !toybox) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    // Insert or update rating using upsert
    const { error: ratingError } = await supabase
      .from('toybox_ratings')
      .upsert({
        toybox_id: id,
        user_id: req.user.id,
        rating: rating,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'toybox_id,user_id'
      });

    if (ratingError) {
      winston.error('Rating upsert error:', ratingError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to save rating'
        }
      });
    }

    // Get updated average rating
    const { data: ratings, error: avgError } = await supabase
      .from('toybox_ratings')
      .select('rating')
      .eq('toybox_id', id);

    const averageRating = ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : 0;

    winston.info(`Toybox rated: ${id} by ${req.user.username} (${rating} stars)`);

    // Clear cache for this toybox
    cacheHelpers.clearToyboxCache(id);

    res.json({
      toybox_id: id,
      user_id: req.user.id,
      rating: rating,
      average_rating: parseFloat(averageRating.toFixed(2))
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
    const { data: toybox, error: toyboxError } = await supabase
      .from('toyboxes')
      .select('id')
      .eq('id', id)
      .eq('status', 3)
      .single();

    if (toyboxError || !toybox) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    // Check if already liked
    const { data: existingLike, error: likeCheckError } = await supabase
      .from('toybox_likes')
      .select('id')
      .eq('toybox_id', id)
      .eq('user_id', req.user.id)
      .single();

    let liked;
    if (existingLike && !likeCheckError) {
      // Unlike - delete the like
      const { error: deleteError } = await supabase
        .from('toybox_likes')
        .delete()
        .eq('toybox_id', id)
        .eq('user_id', req.user.id);

      if (deleteError) {
        winston.error('Like delete error:', deleteError);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Failed to unlike toybox'
          }
        });
      }
      liked = false;
    } else {
      // Like - insert new like
      const { error: insertError } = await supabase
        .from('toybox_likes')
        .insert({
          toybox_id: id,
          user_id: req.user.id
        });

      if (insertError) {
        winston.error('Like insert error:', insertError);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Failed to like toybox'
          }
        });
      }
      liked = true;
    }

    // Get updated like count
    const { count: likesCount, error: countError } = await supabase
      .from('toybox_likes')
      .select('id', { count: 'exact', head: true })
      .eq('toybox_id', id);

    if (countError) {
      winston.error('Like count error:', countError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get like count'
        }
      });
    }

    winston.info(`Toybox ${liked ? 'liked' : 'unliked'}: ${id} by ${req.user.username}`);

    // Clear cache for this toybox
    cacheHelpers.clearToyboxCache(id);

    res.json({
      toybox_id: id,
      user_id: req.user.id,
      liked: liked,
      likes_count: likesCount || 0
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

    // For now, return recent popular toyboxes (simplified trending)
    const { data: toyboxes, error } = await supabase
      .from('toyboxes')
      .select('id, title, creator_id, download_count, created_at')
      .eq('status', 3)
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      winston.error('Trending fetch error:', error);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch trending toyboxes'
        }
      });
    }

    // Get creator usernames
    const creatorIds = [...new Set(toyboxes.map(t => t.creator_id))];
    const { data: creators } = await supabase
      .from('users')
      .select('id, username')
      .in('id', creatorIds);

    const creatorMap = {};
    creators?.forEach(creator => {
      creatorMap[creator.id] = creator.username;
    });

    const items = toyboxes.map(toybox => ({
      id: toybox.id,
      name: toybox.title,
      creator_display_name: creatorMap[toybox.creator_id] || 'Unknown',
      downloads: { count: toybox.download_count || 0 },
      likes: { count: 0 }, // TODO: Add likes count
      rating: 0, // TODO: Add rating
      created_at: toybox.created_at
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
    const { supabase } = require('../config/database');

    // Get user's toyboxes
    const { data: toyboxes, error } = await supabase
      .from('toyboxes')
      .select('id, title, description, status, created_at, updated_at, download_count')
      .eq('creator_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      winston.error('User toyboxes fetch error:', error);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch user toyboxes'
        }
      });
    }

    // For now, return basic info without ratings/likes counts
    // TODO: Add ratings and likes counts in a future update
    const formattedToyboxes = toyboxes.map(toybox => ({
      id: toybox.id,
      title: toybox.title,
      description: toybox.description,
      status: toybox.status === 1 ? 'in_review' : toybox.status === 2 ? 'approved' : toybox.status === 3 ? 'published' : 'unknown',
      created_at: toybox.created_at,
      updated_at: toybox.updated_at,
      downloads: { count: toybox.download_count || 0 },
      likes: { count: 0 }, // TODO: Add likes count
      rating: 0 // TODO: Add rating
    }));

    res.json(formattedToyboxes);

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
