const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { query, transaction, getClient } = require('../config/database');
const { body, param, query: queryParam, validationResult } = require('express-validator');
const winston = require('winston');
const achievementService = require('../services/achievementService');

/**
 * Toybox controller - handles UGC operations
 */

// Initialize Supabase client (only if credentials are available)
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Generate file hash for duplicate detection
 */
const generateFileHash = (buffer) => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

/**
 * Upload toybox validation
 */
const uploadValidation = [
  body('contentInfo').isObject().withMessage('contentInfo required'),
  body('contentInfo.name').isLength({ min: 1, max: 255 }).withMessage('Name required (1-255 chars)'),
  body('contentInfo.version').isInt({ min: 1, max: 10 }).withMessage('Valid version required')
];

/**
 * Upload toybox
 */
const uploadToybox = async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    if (!req.files || !req.files.content) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Toybox content file required'
        }
      });
    }

    const { contentInfo, screenshotInfo } = req.body;
    const contentFile = req.files.content;
    const screenshotFile = req.files.screenshot;

    // Parse JSON fields
    let parsedContentInfo, parsedScreenshotInfo;
    try {
      parsedContentInfo = typeof contentInfo === 'string' ? JSON.parse(contentInfo) : contentInfo;
      parsedScreenshotInfo = screenshotInfo ? (typeof screenshotInfo === 'string' ? JSON.parse(screenshotInfo) : screenshotInfo) : null;
    } catch (err) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON in contentInfo or screenshotInfo'
        }
      });
    }

    // Validate file size
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 104857600; // 100MB default
    if (contentFile.size > maxSize) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: `File too large. Maximum size: ${maxSize} bytes`
        }
      });
    }

    // Generate file hash for duplicate detection
    const fileHash = generateFileHash(contentFile.data);

    // Check for duplicate toybox
    const existingToybox = await query(
      'SELECT id FROM toyboxes WHERE file_hash = $1',
      [fileHash]
    );

    if (existingToybox.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'This toybox has already been uploaded',
          existing_id: existingToybox.rows[0].id
        }
      });
    }

    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Upload content file to Supabase (skip in test environment)
      let contentUpload = { path: `toybox_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.dat` };

      if (supabase) {
        const { data: uploadData, error: contentError } = await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .upload(contentUpload.path, contentFile.data, {
            contentType: 'application/octet-stream',
            upsert: false
          });

        if (contentError) {
          throw new Error(`Content upload failed: ${contentError.message}`);
        }
        contentUpload = uploadData;
      }

      // Upload screenshot if provided
      let screenshotPath = null;
      let screenshotMetadata = null;

      if (screenshotFile && supabase) {
        const screenshotFileName = `screenshot_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
        const { data: screenshotUpload, error: screenshotError } = await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .upload(screenshotFileName, screenshotFile.data, {
            contentType: 'image/png',
            upsert: false
          });

        if (screenshotError) {
          // Don't fail the whole upload if screenshot fails
          winston.warn(`Screenshot upload failed: ${screenshotError.message}`);
        } else {
          screenshotPath = screenshotUpload.path;
          screenshotMetadata = parsedScreenshotInfo;
        }
      }

      // Insert toybox record
      const toyboxResult = await client.query(`
        INSERT INTO toyboxes (
          creator_id, title, description, version, status, shared,
          file_path, file_size, file_hash, screenshot, screenshot_metadata,
          avatars, abilities, genres, playsets, required_playsets_size,
          total_objects, unique_objects, object_counts, data_size
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id, created_at
      `, [
        req.user.id,
        parsedContentInfo.name,
        parsedContentInfo.desc || '',
        parsedContentInfo.version || 3,
        1, // in_review status
        true,
        contentUpload.path,
        contentFile.size,
        fileHash,
        screenshotPath,
        screenshotMetadata,
        parsedContentInfo.igps || [],
        parsedContentInfo.abilities || [],
        parsedContentInfo.genres || [],
        parsedContentInfo.playsets || [],
        parsedContentInfo.required_playsets_size || 0,
        parsedContentInfo.total_objects || 0,
        parsedContentInfo.unique_objects || 0,
        parsedContentInfo.object_counts || {},
        contentFile.size
      ]);

      await client.query('COMMIT');

      const toybox = toyboxResult.rows[0];

      // Check for toybox creation achievements
      await achievementService.onToyboxCreated(req.user.id, {
        toybox_id: toybox.id,
        title: parsedContentInfo.name
      });

      winston.info(`Toybox uploaded: ${parsedContentInfo.name} by ${req.user.username} (${toybox.id})`);

      res.status(201).json({
        id: toybox.id,
        status: 'in_review',
        created_at: toybox.created_at,
        message: 'Toybox uploaded successfully and is pending review'
      });

    } catch (err) {
      await client.query('ROLLBACK');

      // Clean up uploaded files on error
      if (contentUpload?.path) {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([contentUpload.path]);
      }
      if (screenshotPath) {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([screenshotPath]);
      }

      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    winston.error('Toybox upload error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Upload failed'
      }
    });
  }
};

/**
 * Download toybox validation
 */
const downloadValidation = [
  param('id').isUUID().withMessage('Invalid toybox ID')
];

/**
 * Download toybox
 */
const downloadToybox = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { id } = req.params;
    const acceptHeader = req.headers.accept;

    // Get toybox metadata
    const toyboxResult = await query(`
      SELECT
        t.*,
        u.username as creator_display_name,
        COALESCE(AVG(r.rating), 0) as average_rating,
        COUNT(DISTINCT r.id) as rating_count,
        COUNT(DISTINCT l.id) as like_count,
        CASE WHEN $2::uuid IS NOT NULL THEN
          EXISTS(SELECT 1 FROM toybox_likes WHERE toybox_id = t.id AND user_id = $2)
        ELSE false END as liked_by_user
      FROM toyboxes t
      LEFT JOIN users u ON t.creator_id = u.id
      LEFT JOIN toybox_ratings r ON t.id = r.toybox_id
      LEFT JOIN toybox_likes l ON t.id = l.toybox_id
      WHERE t.id = $1 AND t.status = 3  -- published only
      GROUP BY t.id, u.username
    `, [id, req.user?.id]);

    if (toyboxResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    const toybox = toyboxResult.rows[0];

    // Check if requesting binary data
    if (acceptHeader === 'application/octet-stream') {
      // Download binary file (skip in test environment)
      if (!supabase) {
        return res.status(501).json({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'File download not available in test environment'
          }
        });
      }

      const { data, error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET || 'toyboxes')
        .download(toybox.file_path);

      if (error) {
        winston.error('File download error:', error);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'File download failed'
          }
        });
      }

      // Record download
      await query(`
        INSERT INTO toybox_downloads (toybox_id, user_id, ip_address, user_agent)
        VALUES ($1, $2, $3, $4)
      `, [
        id,
        req.user?.id || null,
        req.ip,
        req.get('User-Agent')
      ]);

      // Track download for achievements (only for authenticated users)
      if (req.user?.id) {
        await achievementService.onToyboxDownloaded(req.user.id, {
          toybox_id: id,
          creator_id: toybox.creator_id
        });
      }

      // Update download count
      await query(
        'UPDATE toyboxes SET download_count = download_count + 1 WHERE id = $1',
        [id]
      );

      // Set headers
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', toybox.file_size);
      res.setHeader('Content-Disposition', `attachment; filename="${toybox.title}.toybox"`);

      // Stream file data
      return data.arrayBuffer().then(buffer => {
        res.send(Buffer.from(buffer));
      });

    } else {
      // Return metadata
      res.json({
        id: toybox.id,
        name: toybox.title,
        desc: toybox.description,
        creator_id: toybox.creator_id,
        creator_display_name: toybox.creator_display_name,
        downloads: { count: toybox.download_count },
        likes: { count: parseInt(toybox.like_count), liked_by_user: toybox.liked_by_user },
        rating: parseFloat(toybox.average_rating),
        created_at: toybox.created_at,
        version: toybox.version,
        total_objects: toybox.total_objects,
        unique_objects: toybox.unique_objects
      });
    }

  } catch (err) {
    winston.error('Toybox download error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Download failed'
      }
    });
  }
};

/**
 * List toyboxes validation
 */
const listValidation = [
  queryParam('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  queryParam('page_size').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be 1-100'),
  queryParam('sort_field').optional().isIn(['created_at', 'updated_at', 'download_count', 'title']).withMessage('Invalid sort field'),
  queryParam('sort_direction').optional().isIn(['asc', 'desc']).withMessage('Sort direction must be asc or desc')
];

/**
 * List toyboxes
 */
const listToyboxes = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const {
      page = 1,
      page_size = 20,
      sort_field = 'created_at',
      sort_direction = 'desc',
      creators,
      igps,
      abilities,
      genres,
      versions,
      featured,
      minimum_performance,
      search
    } = req.query;

    // Build WHERE clause
    let whereConditions = ['t.status = 3']; // published only
    let queryParams = [];
    let paramIndex = 1;

    // Creators filter
    if (creators) {
      const creatorList = creators.split(',').map(c => c.trim());
      whereConditions.push(`u.username = ANY($${paramIndex})`);
      queryParams.push(creatorList);
      paramIndex++;
    }

    // Avatar (IGP) filter
    if (igps) {
      const igpList = igps.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (igpList.length > 0) {
        whereConditions.push(`t.avatars && $${paramIndex}`);
        queryParams.push(igpList);
        paramIndex++;
      }
    }

    // Abilities filter
    if (abilities) {
      const abilityList = abilities.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (abilityList.length > 0) {
        whereConditions.push(`t.abilities && $${paramIndex}`);
        queryParams.push(abilityList);
        paramIndex++;
      }
    }

    // Genres filter
    if (genres) {
      const genreList = genres.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (genreList.length > 0) {
        whereConditions.push(`t.genres && $${paramIndex}`);
        queryParams.push(genreList);
        paramIndex++;
      }
    }

    // Versions filter
    if (versions) {
      const versionList = versions.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
      if (versionList.length > 0) {
        whereConditions.push(`t.version = ANY($${paramIndex})`);
        queryParams.push(versionList);
        paramIndex++;
      }
    }

    // Featured filter
    if (featured === 'true') {
      whereConditions.push('t.featured = true');
    }

    // Minimum performance filter
    if (minimum_performance) {
      const minPerf = parseInt(minimum_performance);
      if (!isNaN(minPerf)) {
        whereConditions.push(`(t.platform_performance->>'default')::int >= $${paramIndex}`);
        queryParams.push(minPerf);
        paramIndex++;
      }
    }

    // Search filter
    if (search) {
      whereConditions.push(`t.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
      queryParams.push(search);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Build ORDER BY clause
    const orderBy = `t.${sort_field} ${sort_direction.toUpperCase()}`;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM toyboxes t
      LEFT JOIN users u ON t.creator_id = u.id
      WHERE ${whereClause}
    `;

    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    const offset = (page - 1) * page_size;
    const dataQuery = `
      SELECT
        t.id, t.title, t.description, t.created_at, t.updated_at, t.version,
        t.total_objects, t.unique_objects, t.featured, t.download_count,
        u.username as creator_display_name,
        COALESCE(AVG(r.rating), 0) as average_rating,
        COUNT(DISTINCT r.id) as rating_count,
        COUNT(DISTINCT l.id) as like_count
      FROM toyboxes t
      LEFT JOIN users u ON t.creator_id = u.id
      LEFT JOIN toybox_ratings r ON t.id = r.toybox_id
      LEFT JOIN toybox_likes l ON t.id = l.toybox_id
      WHERE ${whereClause}
      GROUP BY t.id, u.username
      ORDER BY ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(page_size, offset);

    const dataResult = await query(dataQuery, queryParams);

    const items = dataResult.rows.map(row => ({
      id: row.id,
      name: row.title,
      creator_display_name: row.creator_display_name,
      downloads: { count: parseInt(row.download_count) },
      likes: { count: parseInt(row.like_count) },
      rating: parseFloat(row.average_rating),
      created_at: row.created_at,
      featured: row.featured,
      status: 'published'
    }));

    res.json({
      items,
      total,
      page: parseInt(page),
      page_size: parseInt(page_size),
      has_more: (page * page_size) < total
    });

  } catch (err) {
    winston.error('Toybox list error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to retrieve toyboxes'
      }
    });
  }
};

module.exports = {
  uploadToybox,
  downloadToybox,
  listToyboxes,
  uploadValidation,
  downloadValidation,
  listValidation
};
