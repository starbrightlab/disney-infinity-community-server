/**
 * Disney UGC API Compatibility Layer
 * 
 * This router provides compatibility with Disney's original UGC API URL structure:
 * /{version}/{product}/{visibility}/toybox
 * 
 * Maps Disney's URL format to the modern /api/v1/toybox endpoints
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// Configure multer for Disney-style multipart uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 104857600, // 100MB
    files: 2 // data + screenshot
  }
});

// Import toybox controller functions
const toyboxController = require('../controllers/toybox');

/**
 * Helper function to convert Disney status codes to string status
 * Disney uses numeric status codes:
 * 1 = NOT_APPROVED
 * 2 = APPROVED  
 * 4 = PUBLISHED (featured/public)
 * 8 = RETIRED (old DI2 content)
 * 16 = FLAGGED
 */
function statusCodeToString(code) {
  switch (code) {
    case 1: return 'in_review';
    case 2: return 'approved';
    case 3:
    case 4: return 'published';
    case 8: return 'retired';
    case 16: return 'flagged';
    default: return 'published';
  }
}

function statusStringToCode(status) {
  switch (status) {
    case 'in_review': return 1;
    case 'approved': return 2;
    case 'published': return 4;
    case 'retired': return 8;
    case 'flagged': return 16;
    default: return 4;
  }
}

/**
 * Format toybox response to match Disney's expected format
 */
function formatToyboxForDisney(toybox) {
  return {
    id: toybox.id,
    title: toybox.name || toybox.title,
    description: toybox.description || '',
    _creatorId: toybox.creator_id,
    creator_username: toybox.creator_display_name,
    _status: statusStringToCode(toybox.status),
    status: toybox.status,
    creation_time: toybox.created_at ? Math.floor(new Date(toybox.created_at).getTime() / 1000) : null,
    last_update_time: toybox.updated_at ? Math.floor(new Date(toybox.updated_at).getTime() / 1000) : null,
    version: 3, // Disney Infinity 3.0
    
    // Performance scores (stub for now)
    platform_performance: toybox.platform_performance || {
      pc: 95,
      default: 95
    },
    
    // Metadata
    download_count: toybox.downloads?.count || toybox.download_count || 0,
    like_count: toybox.likes?.count || toybox.like_count || 0,
    rating: toybox.rating || 0,
    
    // Optional fields that may exist
    screenshot: toybox.screenshot,
    screenshot_metadata: toybox.screenshot_metadata,
    object_counts: toybox.object_counts,
    igps: toybox.igps,
    abilities: toybox.abilities,
    genres: toybox.genres,
    featured: toybox.featured || false
  };
}

/**
 * Format list response to match Disney's paged format
 */
function formatListResponse(data) {
  return {
    items: data.items ? data.items.map(formatToyboxForDisney) : [],
    total: data.total || 0,
    page: data.page || 1,
    page_size: data.page_size || 20,
    has_more: data.has_more || false
  };
}

// ============================================================================
// PUBLIC TOYBOX ENDPOINTS (Disney format: /v1/{product}/public/toybox)
// ============================================================================

/**
 * List public toyboxes
 * GET /{version}/{product}/public/toybox
 */
router.get('/:version/:product/public/toybox', optionalAuth, async (req, res, next) => {
  console.log('📦 Disney UGC API: List public toyboxes');
  console.log('  Version:', req.params.version);
  console.log('  Product:', req.params.product);
  console.log('  Query:', req.query);
  
  // Forward to existing list handler with visibility filter
  req.query.visibility = 'public';
  req.query.status = 'published';
  
  try {
    await toyboxController.listToyboxes(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * Create/upload public toybox
 * POST /{version}/{product}/public/toybox
 */
router.post('/:version/:product/public/toybox', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 },
  { name: 'metadata', maxCount: 1 }
]), async (req, res, next) => {
  console.log('📦 Disney UGC API: Upload public toybox');
  console.log('  Version:', req.params.version);
  console.log('  Product:', req.params.product);
  console.log('  User:', req.user?.username);
  console.log('  Files:', req.files);
  console.log('  Body:', req.body);
  
  // Set visibility
  req.body.visibility = 'public';
  req.body.status = 'published';
  
  try {
    await toyboxController.uploadToybox(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * Get specific public toybox
 * GET /{version}/{product}/public/toybox/{id}
 */
router.get('/:version/:product/public/toybox/:id', optionalAuth, async (req, res, next) => {
  console.log('📦 Disney UGC API: Get public toybox:', req.params.id);
  
  try {
    await toyboxController.downloadToybox(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * Get toybox screenshot
 * GET /{version}/{product}/public/toybox/{id}/screenshot
 */
router.get('/:version/:product/public/toybox/:id/screenshot', async (req, res) => {
  console.log('📦 Disney UGC API: Get screenshot:', req.params.id);
  
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
        error: 'Screenshot not found'
      });
    }

    // Download from Supabase storage
    const { data, error: storageError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET || 'toyboxes')
      .download(toybox.screenshot);

    if (storageError) {
      winston.error('Screenshot download error:', storageError);
      return res.status(500).json({
        error: 'Screenshot download failed'
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
    console.error('Screenshot fetch error:', err);
    res.status(500).json({
      error: 'Failed to fetch screenshot'
    });
  }
});

/**
 * Like a toybox
 * POST /{version}/{product}/public/toybox/{id}/like
 */
router.post('/:version/:product/public/toybox/:id/like', authenticateToken, async (req, res) => {
  console.log('📦 Disney UGC API: Like toybox:', req.params.id);
  
  try {
    const { supabase } = require('../config/database');
    const { id } = req.params;

    // Check if toybox exists
    const { data: toybox, error: toyboxError } = await supabase
      .from('toyboxes')
      .select('id')
      .eq('id', id)
      .eq('status', 3)
      .single();

    if (toyboxError || !toybox) {
      return res.status(404).json({
        error: 'Toybox not found'
      });
    }

    // Check if already liked
    const { data: existingLike } = await supabase
      .from('toybox_likes')
      .select('id')
      .eq('toybox_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (existingLike) {
      // Already liked - return current count
      const { count } = await supabase
        .from('toybox_likes')
        .select('id', { count: 'exact', head: true })
        .eq('toybox_id', id);

      return res.json({
        liked_by_user: true,
        like_count: count || 0
      });
    }

    // Add like
    await supabase
      .from('toybox_likes')
      .insert({
        toybox_id: id,
        user_id: req.user.id
      });

    // Get updated count
    const { count } = await supabase
      .from('toybox_likes')
      .select('id', { count: 'exact', head: true })
      .eq('toybox_id', id);

    res.json({
      liked_by_user: true,
      like_count: count || 0
    });

  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({
      error: 'Failed to like toybox'
    });
  }
});

/**
 * Get trending toyboxes
 * GET /{version}/{product}/public/toybox/trending
 */
router.get('/:version/:product/public/toybox/trending', async (req, res) => {
  console.log('📦 Disney UGC API: Get trending toyboxes');
  
  try {
    const { supabase } = require('../config/database');
    const { genre, limit = 20 } = req.query;

    let query = supabase
      .from('toyboxes')
      .select('id, title, creator_id, download_count, created_at')
      .eq('status', 3)
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (genre) {
      query = query.contains('genres', [parseInt(genre)]);
    }

    const { data: toyboxes, error } = await query;

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch trending toyboxes'
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

    const items = toyboxes.map(toybox => formatToyboxForDisney({
      id: toybox.id,
      name: toybox.title,
      creator_id: toybox.creator_id,
      creator_display_name: creatorMap[toybox.creator_id] || 'Unknown',
      download_count: toybox.download_count || 0,
      created_at: toybox.created_at,
      status: 'published'
    }));

    res.json(items);

  } catch (err) {
    console.error('Trending fetch error:', err);
    res.status(500).json({
      error: 'Failed to fetch trending toyboxes'
    });
  }
});

/**
 * Search toyboxes
 * GET /{version}/{product}/public/toybox/search
 */
router.get('/:version/:product/public/toybox/search', async (req, res) => {
  console.log('📦 Disney UGC API: Search toyboxes');
  console.log('  Term:', req.query.term);
  
  try {
    const { supabase } = require('../config/database');
    const { term, page = 1, page_size = 20 } = req.query;

    if (!term) {
      return res.status(400).json({
        error: 'Search term required'
      });
    }

    // Simple search by title
    const { data: toyboxes, error, count } = await supabase
      .from('toyboxes')
      .select('*', { count: 'exact' })
      .eq('status', 3)
      .ilike('title', `%${term}%`)
      .range((page - 1) * page_size, page * page_size - 1);

    if (error) {
      return res.status(500).json({
        error: 'Search failed'
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

    const items = toyboxes.map(toybox => formatToyboxForDisney({
      ...toybox,
      name: toybox.title,
      creator_display_name: creatorMap[toybox.creator_id] || 'Unknown'
    }));

    res.json({
      items,
      total: count || 0,
      page: parseInt(page),
      page_size: parseInt(page_size),
      has_more: count > page * page_size
    });

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      error: 'Search failed'
    });
  }
});

// ============================================================================
// PRIVATE TOYBOX ENDPOINTS (Disney format: /v1/{product}/private/toybox)
// ============================================================================

/**
 * List user's private toyboxes
 * GET /{version}/{product}/private/toybox
 */
router.get('/:version/:product/private/toybox', authenticateToken, async (req, res) => {
  console.log('📦 Disney UGC API: List private toyboxes for user:', req.user.username);
  
  try {
    const { supabase } = require('../config/database');

    const { data: toyboxes, error } = await supabase
      .from('toyboxes')
      .select('*')
      .eq('creator_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch private toyboxes'
      });
    }

    const items = toyboxes.map(toybox => formatToyboxForDisney({
      ...toybox,
      name: toybox.title,
      creator_display_name: req.user.username
    }));

    res.json({
      items,
      total: items.length,
      page: 1,
      page_size: items.length,
      has_more: false
    });

  } catch (err) {
    console.error('Private toybox list error:', err);
    res.status(500).json({
      error: 'Failed to fetch private toyboxes'
    });
  }
});

/**
 * Create private toybox
 * POST /{version}/{product}/private/toybox
 */
router.post('/:version/:product/private/toybox', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 },
  { name: 'metadata', maxCount: 1 }
]), async (req, res, next) => {
  console.log('📦 Disney UGC API: Upload private toybox');
  
  req.body.visibility = 'private';
  req.body.status = 'in_review';
  
  try {
    await toyboxController.uploadToybox(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * Update private toybox
 * PUT /{version}/{product}/private/toybox/{id}
 */
router.put('/:version/:product/private/toybox/:id', authenticateToken, upload.fields([
  { name: 'data', maxCount: 1 },
  { name: 'content', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 },
  { name: 'metadata', maxCount: 1 }
]), async (req, res) => {
  console.log('📦 Disney UGC API: Update private toybox:', req.params.id);
  
  try {
    const { supabase } = require('../config/database');
    const { id } = req.params;

    // Verify ownership
    const { data: toybox } = await supabase
      .from('toyboxes')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (!toybox || toybox.creator_id !== req.user.id) {
      return res.status(403).json({
        error: 'Not authorized to update this toybox'
      });
    }

    // Update toybox
    const { error } = await supabase
      .from('toyboxes')
      .update({
        title: req.body.title,
        description: req.body.description,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      return res.status(500).json({
        error: 'Update failed'
      });
    }

    res.json({
      id,
      message: 'Toybox updated successfully'
    });

  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({
      error: 'Update failed'
    });
  }
});

/**
 * Delete private toybox
 * DELETE /{version}/{product}/private/toybox/{id}
 */
router.delete('/:version/:product/private/toybox/:id', authenticateToken, async (req, res) => {
  console.log('📦 Disney UGC API: Delete private toybox:', req.params.id);
  
  try {
    const { supabase } = require('../config/database');
    const { id } = req.params;

    // Verify ownership
    const { data: toybox } = await supabase
      .from('toyboxes')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (!toybox || toybox.creator_id !== req.user.id) {
      return res.status(403).json({
        error: 'Not authorized to delete this toybox'
      });
    }

    // Delete toybox
    const { error } = await supabase
      .from('toyboxes')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({
        error: 'Delete failed'
      });
    }

    res.json({
      message: 'Toybox deleted successfully'
    });

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({
      error: 'Delete failed'
    });
  }
});

module.exports = router;
