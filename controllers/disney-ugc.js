/**
 * Disney UGC Controller - Disney-format Response Wrapper
 * 
 * This controller wraps the existing toybox controller and formats responses
 * to match Disney's original UGC API format.
 */

const crypto = require('crypto');
const { supabase } = require('../config/database');
const { validationResult } = require('express-validator');
const winston = require('winston');
const achievementService = require('../services/achievementService');

/**
 * Convert string status to Disney numeric code
 */
function statusToCode(status) {
  const map = {
    'in_review': 1,
    'approved': 2,
    'published': 4,
    'retired': 8,
    'flagged': 16
  };
  return map[status] || 1;
}

/**
 * Convert numeric status to internal numeric (for database queries)
 */
function statusCodeToInternal(code) {
  const map = {
    1: 1, // NOT_APPROVED → in_review
    2: 2, // APPROVED → approved
    4: 3, // PUBLISHED → published
    8: 8, // RETIRED → retired
    16: 16 // FLAGGED → flagged
  };
  return map[code] || 1;
}

/**
 * Format toybox for Disney API response
 */
function formatToyboxDisney(toybox, includeExtras = true) {
  const formatted = {
    id: toybox.id,
    title: toybox.title,
    description: toybox.description || '',
    _creatorId: toybox.creator_id,
    _status: toybox._status || statusToCode(toybox.status_text),
    creation_time: toybox.creation_time || Math.floor(new Date(toybox.created_at).getTime() / 1000),
    last_update_time: toybox.last_update_time || Math.floor(new Date(toybox.updated_at || toybox.created_at).getTime() / 1000),
    version: toybox.version || 3
  };

  if (includeExtras) {
    // Add performance scores
    formatted.platform_performance = toybox.platform_performance || { pc: 95, default: 95 };
    
    // Add counts
    formatted.download_count = toybox.download_count || 0;
    
    // Add metadata
    if (toybox.igps) formatted.igps = toybox.igps;
    if (toybox.abilities) formatted.abilities = toybox.abilities;
    if (toybox.genres) formatted.genres = toybox.genres;
    if (toybox.object_counts) formatted.object_counts = toybox.object_counts;
    if (toybox.total_objects) formatted.total_objects = toybox.total_objects;
    if (toybox.unique_objects) formatted.unique_objects = toybox.unique_objects;
    if (toybox.playsets) formatted.playsets = toybox.playsets;
    if (toybox.required_playsets_size) formatted.required_playsets_size = toybox.required_playsets_size;
    
    // Add creator username if available
    if (toybox.creator_username) {
      formatted.creator_username = toybox.creator_username;
    }
    
    // Add screenshot metadata if exists
    if (toybox.screenshot_metadata) {
      formatted.screenshot_metadata = toybox.screenshot_metadata;
    }
    
    // Add featured flag
    if (toybox.featured !== undefined) {
      formatted.featured = toybox.featured;
    }
  }

  return formatted;
}

/**
 * List public toyboxes (Disney format)
 */
async function listPublicToyboxes(req, res) {
  try {
    const {
      page = 1,
      page_size = 100,
      sort_field = 'last_update_time',
      sort_direction = 'desc',
      creators,
      igps,
      abilities,
      genres,
      versions,
      minimum_performance,
      platform = 'default',
      hardware_group = 2,
      isFeatured
    } = req.query;

    const limit = Math.min(parseInt(page_size), 200);
    const offset = (parseInt(page) - 1) * limit;

    // Build query
    let query = supabase
      .from('toyboxes')
      .select(`
        *,
        users!toyboxes_creator_id_fkey (username),
        toybox_likes (count),
        toybox_ratings (rating)
      `, { count: 'exact' })
      .eq('_status', 4); // PUBLISHED only

    // Apply filters
    if (creators) {
      const creatorList = creators.split(',');
      query = query.in('users.username', creatorList);
    }

    if (igps) {
      const igpList = igps.split(',').map(Number);
      query = query.overlaps('igps', igpList);
    }

    if (abilities) {
      const abilityList = abilities.split(',').map(Number);
      query = query.overlaps('abilities', abilityList);
    }

    if (genres) {
      const genreList = genres.split(',').map(Number);
      query = query.overlaps('genres', genreList);
    }

    if (versions) {
      const versionList = versions.split(',').map(Number);
      query = query.in('version', versionList);
    }

    if (isFeatured === 'true') {
      query = query.eq('featured', true);
    }

    // Apply sorting
    const sortMap = {
      'last_update_time': 'last_update_time',
      'creation_time': 'creation_time',
      'download_count': 'download_count',
      'title': 'title'
    };
    const sortColumn = sortMap[sort_field] || 'last_update_time';
    query = query.order(sortColumn, { ascending: sort_direction === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: toyboxes, error, count } = await query;

    if (error) {
      winston.error('List public toyboxes error:', error);
      return res.status(500).json({
        error: 'Failed to fetch toyboxes'
      });
    }

    // Format response
    const items = toyboxes.map(t => formatToyboxDisney({
      ...t,
      creator_username: t.users?.username,
      like_count: t.toybox_likes?.length || 0,
      average_rating: t.toybox_ratings?.length > 0
        ? t.toybox_ratings.reduce((sum, r) => sum + r.rating, 0) / t.toybox_ratings.length
        : 0
    }));

    res.json({
      items,
      total: count || 0,
      page: parseInt(page),
      page_size: limit,
      has_more: count > offset + limit
    });

  } catch (err) {
    winston.error('List public toyboxes exception:', err);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
}

/**
 * Get trending toyboxes
 */
async function getTrending(req, res) {
  try {
    const { genre, versions = '2,3', limit = 20 } = req.query;

    let query = supabase
      .from('toyboxes')
      .select(`
        *,
        users!toyboxes_creator_id_fkey (username)
      `)
      .eq('_status', 4)
      .order('download_count', { ascending: false })
      .order('creation_time', { ascending: false })
      .limit(parseInt(limit));

    if (genre) {
      query = query.contains('genres', [parseInt(genre)]);
    }

    const versionList = versions.split(',').map(Number);
    query = query.in('version', versionList);

    const { data: toyboxes, error } = await query;

    if (error) {
      winston.error('Trending error:', error);
      return res.status(500).json({ error: 'Failed to fetch trending' });
    }

    const items = toyboxes.map(t => formatToyboxDisney({
      ...t,
      creator_username: t.users?.username
    }));

    res.json(items);

  } catch (err) {
    winston.error('Trending exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get trending by genre
 */
async function getTrendingByGenre(req, res) {
  const { genre } = req.params;
  req.query.genre = genre;
  return getTrending(req, res);
}

/**
 * Search toyboxes
 */
async function searchToyboxes(req, res) {
  try {
    const { term, page = 1, page_size = 100, hardware_group = 2 } = req.query;

    if (!term) {
      return res.status(400).json({ error: 'Search term required' });
    }

    const limit = Math.min(parseInt(page_size), 200);
    const offset = (parseInt(page) - 1) * limit;

    const { data: toyboxes, error, count } = await supabase
      .from('toyboxes')
      .select(`
        *,
        users!toyboxes_creator_id_fkey (username)
      `, { count: 'exact' })
      .eq('_status', 4)
      .ilike('title', `%${term}%`)
      .range(offset, offset + limit - 1);

    if (error) {
      winston.error('Search error:', error);
      return res.status(500).json({ error: 'Search failed' });
    }

    const items = toyboxes.map(t => formatToyboxDisney({
      ...t,
      creator_username: t.users?.username
    }));

    res.json({
      items,
      total: count || 0,
      page: parseInt(page),
      page_size: limit,
      has_more: count > offset + limit
    });

  } catch (err) {
    winston.error('Search exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get screenshot
 */
async function getScreenshot(req, res) {
  try {
    const { id } = req.params;

    const { data: toybox, error } = await supabase
      .from('toyboxes')
      .select('screenshot, screenshot_metadata')
      .eq('id', id)
      .eq('_status', 4)
      .single();

    if (error || !toybox || !toybox.screenshot) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    // Download from storage
    const { data, error: storageError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET || 'toyboxes')
      .download(toybox.screenshot);

    if (storageError) {
      winston.error('Screenshot download error:', storageError);
      return res.status(500).json({ error: 'Screenshot download failed' });
    }

    // Set headers
    res.setHeader('Content-Type', 'image/png');
    if (toybox.screenshot_metadata) {
      res.setHeader('X-Binary-Metadata', JSON.stringify(toybox.screenshot_metadata));
    }

    // Send image
    data.arrayBuffer().then(buffer => {
      res.send(Buffer.from(buffer));
    });

  } catch (err) {
    winston.error('Screenshot error:', err);
    res.status(500).json({ error: 'Failed to fetch screenshot' });
  }
}

/**
 * Like toybox
 */
async function likeToybox(req, res) {
  try {
    const { id } = req.params;

    // Check if toybox exists
    const { data: toybox, error: toyboxError } = await supabase
      .from('toyboxes')
      .select('id')
      .eq('id', id)
      .eq('_status', 4)
      .single();

    if (toyboxError || !toybox) {
      return res.status(404).json({ error: 'Toybox not found' });
    }

    // Check if already liked
    const { data: existingLike } = await supabase
      .from('toybox_likes')
      .select('id')
      .eq('toybox_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!existingLike) {
      // Add like
      await supabase
        .from('toybox_likes')
        .insert({ toybox_id: id, user_id: req.user.id });
    }

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
    winston.error('Like error:', err);
    res.status(500).json({ error: 'Failed to like toybox' });
  }
}

/**
 * Get object counts
 */
async function getObjectCounts(req, res) {
  try {
    const { id } = req.params;

    const { data: toybox, error } = await supabase
      .from('toyboxes')
      .select('object_counts, _status')
      .eq('id', id)
      .single();

    if (error || !toybox) {
      return res.status(404).json({ error: 'Toybox not found' });
    }

    // Check if user has permission to view
    if (toybox._status !== 4 && (!req.user || toybox.creator_id !== req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(toybox.object_counts || {});

  } catch (err) {
    winston.error('Object counts error:', err);
    res.status(500).json({ error: 'Failed to fetch object counts' });
  }
}

/**
 * List private toyboxes
 */
async function listPrivateToyboxes(req, res) {
  try {
    const { data: toyboxes, error } = await supabase
      .from('toyboxes')
      .select('*')
      .eq('creator_id', req.user.id)
      .order('last_update_time', { ascending: false });

    if (error) {
      winston.error('List private toyboxes error:', error);
      return res.status(500).json({ error: 'Failed to fetch toyboxes' });
    }

    const items = toyboxes.map(t => formatToyboxDisney({
      ...t,
      creator_username: req.user.username
    }));

    res.json({
      items,
      total: items.length,
      page: 1,
      page_size: items.length,
      has_more: false
    });

  } catch (err) {
    winston.error('List private toyboxes exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Export controller functions
module.exports = {
  listPublicToyboxes,
  getTrending,
  getTrendingByGenre,
  searchToyboxes,
  getScreenshot,
  likeToybox,
  getObjectCounts,
  listPrivateToyboxes,
  
  // Re-export from original controller - these are fully implemented
  uploadToybox: require('./toybox').uploadToybox,
  downloadToybox: require('./toybox').downloadToybox,
  downloadPrivateToybox: require('./toybox').downloadToybox, // Same logic, checks ownership
  updateToybox: require('./toybox').updateToybox,
  deleteToybox: require('./toybox').deleteToybox
};
