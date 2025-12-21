const crypto = require('crypto');
const { supabase } = require('../config/database');
const { body, param, query: queryParam, validationResult } = require('express-validator');
const winston = require('winston');
const achievementService = require('../services/achievementService');

/**
 * Toybox controller - handles UGC operations
 */

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
    const { data: existingToybox, error: duplicateError } = await supabase
      .from('toyboxes')
      .select('id')
      .eq('file_hash', fileHash)
      .single();

    if (existingToybox) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'This toybox has already been uploaded',
          existing_id: existingToybox.id
        }
      });
    }

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
      const { data: toybox, error: insertError } = await supabase
        .from('toyboxes')
        .insert([{
          creator_id: req.user.id,
          title: parsedContentInfo.name,
          description: parsedContentInfo.desc || '',
          version: parsedContentInfo.version || 3,
          status: 1, // in_review status
          shared: true,
          file_path: contentUpload.path,
          file_size: contentFile.size,
          file_hash: fileHash,
          screenshot: screenshotPath,
          screenshot_metadata: screenshotMetadata,
          avatars: parsedContentInfo.igps || [],
          abilities: parsedContentInfo.abilities || [],
          genres: parsedContentInfo.genres || [],
          playsets: parsedContentInfo.playsets || [],
          required_playsets_size: parsedContentInfo.required_playsets_size || 0,
          total_objects: parsedContentInfo.total_objects || 0,
          unique_objects: parsedContentInfo.unique_objects || 0,
          object_counts: parsedContentInfo.object_counts || {},
          data_size: contentFile.size
        }])
        .select('id, created_at')
        .single();

      if (insertError) {
        // Clean up uploaded files if insert fails
        if (supabase) {
          await supabase.storage.from(process.env.SUPABASE_BUCKET || 'toyboxes').remove([contentUpload.path]);
          if (screenshotPath) {
            await supabase.storage.from(process.env.SUPABASE_BUCKET || 'toyboxes').remove([screenshotPath]);
          }
        }
        throw insertError;
      }

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
    winston.error('Toybox upload error:', err);

    // Clean up uploaded files on error
    if (contentUpload?.path && supabase) {
      try {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([contentUpload.path]);
      } catch (cleanupErr) {
        winston.warn('Failed to cleanup content file:', cleanupErr.message);
      }
    }
    if (screenshotPath && supabase) {
      try {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([screenshotPath]);
      } catch (cleanupErr) {
        winston.warn('Failed to cleanup screenshot:', cleanupErr.message);
      }
    }

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
    const { data: toybox, error: toyboxError } = await supabase
      .from('toyboxes')
      .select(`
        *,
        users!inner(username)
      `)
      .eq('id', id)
      .eq('status', 3) // published only
      .single();

    if (toyboxError || !toybox) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found or not published'
        }
      });
    }

    // Get ratings statistics
    const { data: ratings } = await supabase
      .from('toybox_ratings')
      .select('rating')
      .eq('toybox_id', id);

    const averageRating = ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : 0;

    // Get like count
    const { count: likeCount } = await supabase
      .from('toybox_likes')
      .select('*', { count: 'exact', head: true })
      .eq('toybox_id', id);

    // Check if current user liked this toybox
    let likedByUser = false;
    if (req.user?.id) {
      const { data: userLike } = await supabase
        .from('toybox_likes')
        .select('id')
        .eq('toybox_id', id)
        .eq('user_id', req.user.id)
        .single();

      likedByUser = !!userLike;
    }

    // Add computed fields to toybox object
    toybox.creator_display_name = toybox.users.username;
    toybox.average_rating = averageRating;
    toybox.rating_count = ratings ? ratings.length : 0;
    toybox.like_count = likeCount || 0;
    toybox.liked_by_user = likedByUser;

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
      const { error: downloadError } = await supabase
        .from('toybox_downloads')
        .insert([{
          toybox_id: id,
          user_id: req.user?.id || null,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        }]);

      if (downloadError) {
        winston.warn('Failed to record download:', downloadError);
        // Don't fail the download for this, just log it
      }

      // Track download for achievements (only for authenticated users)
      if (req.user?.id) {
        await achievementService.onToyboxDownloaded(req.user.id, {
          toybox_id: id,
          creator_id: toybox.creator_id
        });
      }

      // Update download count
      const { error: updateError } = await supabase
        .from('toyboxes')
        .update({
          download_count: (toybox.download_count || 0) + 1
        })
        .eq('id', id);

      if (updateError) {
        winston.warn('Failed to update download count:', updateError);
        // Don't fail the download for this, just log it
      }

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
  queryParam('sort_direction').optional().isIn(['asc', 'desc']).withMessage('Sort direction must be asc or desc'),
  queryParam('minimum_performance').optional().isInt({ min: 0, max: 100 }).withMessage('Minimum performance must be 0-100'),
  queryParam('platform').optional().isIn(['default', 'pc', 'playstation', 'xbox', 'switch']).withMessage('Invalid platform'),
  queryParam('performance_threshold').optional().isInt({ min: 0, max: 100 }).withMessage('Performance threshold must be 0-100')
];

/**
 * List toyboxes
 */
const listToyboxes = async (req, res) => {
  try {
    console.log('🎯 LIST TOYBOXES: Starting request');
    console.log('Query params:', req.query);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ LIST TOYBOXES: Validation failed:', errors.array());
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    console.log('✅ LIST TOYBOXES: Validation passed');

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
      platform,
      performance_threshold,
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

    // Performance filters
    if (minimum_performance) {
      // Legacy support: minimum_performance filters by 'default' platform
      const minPerf = parseInt(minimum_performance);
      if (!isNaN(minPerf)) {
        whereConditions.push(`(t.platform_performance->>'default')::int >= $${paramIndex}`);
        queryParams.push(minPerf);
        paramIndex++;
      }
    }

    if (platform && minimum_performance) {
      // Platform-specific performance filter: platform=pc&minimum_performance=85
      const platformName = platform.toLowerCase();
      const minPerf = parseInt(minimum_performance);
      if (!isNaN(minPerf) && ['default', 'pc', 'playstation', 'xbox', 'switch'].includes(platformName)) {
        whereConditions.push(`(t.platform_performance->>'${platformName}')::int >= $${paramIndex}`);
        queryParams.push(minPerf);
        paramIndex++;
      }
    }

    if (performance_threshold) {
      // Any platform threshold filter: performance_threshold=90
      const threshold = parseInt(performance_threshold);
      if (!isNaN(threshold)) {
        // Check if any platform meets or exceeds the threshold
        // The GIN index on platform_performance will optimize these JSONB path queries
        whereConditions.push(`
          (t.platform_performance->>'default')::int >= $${paramIndex} OR
          (t.platform_performance->>'pc')::int >= $${paramIndex} OR
          (t.platform_performance->>'playstation')::int >= $${paramIndex} OR
          (t.platform_performance->>'xbox')::int >= $${paramIndex} OR
          (t.platform_performance->>'switch')::int >= $${paramIndex}
        `);
        queryParams.push(threshold);
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

    // Full implementation with proper filtering
    console.log('🔍 LIST TOYBOXES: Building filtered query...');

    let query = supabase
      .from('toyboxes')
      .select(`
        id, title, description, created_at, updated_at, version,
        total_objects, unique_objects, featured, download_count,
        users!inner(username),
        toybox_ratings(rating),
        toybox_likes(id)
      `, { count: 'exact' })
      .eq('status', 3);

    // Apply creator filtering - get user IDs first, then filter
    if (creators) {
      const creatorList = creators.split(',').map(c => c.trim());
      console.log('👤 Applying creator filter:', creatorList);

      // First get user IDs for these usernames
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id')
        .in('username', creatorList);

      if (userError) {
        console.log('❌ Creator lookup failed:', userError);
      } else if (users && users.length > 0) {
        const userIds = users.map(u => u.id);
        console.log('👤 Found user IDs:', userIds);
        query = query.in('creator_id', userIds);
      } else {
        console.log('👤 No users found for creator filter');
        // Return empty result if no matching creators
        return res.json({
          items: [],
          total: 0,
          page: parseInt(page),
          page_size: parseInt(page_size),
          has_more: false
        });
      }
    }

    // Apply featured filter
    if (featured === 'true') {
      console.log('⭐ Applying featured filter');
      query = query.eq('featured', true);
    }

    // Apply version filter
    if (versions) {
      const versionList = versions.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
      if (versionList.length > 0) {
        console.log('🔢 Applying version filter:', versionList);
        query = query.in('version', versionList);
      }
    }

    // Apply IGP/avatar filter (array overlap)
    if (igps) {
      const igpList = igps.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (igpList.length > 0) {
        console.log('🎭 Applying IGP filter:', igpList);
        query = query.overlaps('avatars', igpList);
      }
    }

    // Apply abilities filter (array overlap)
    if (abilities) {
      const abilityList = abilities.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (abilityList.length > 0) {
        console.log('⚡ Applying abilities filter:', abilityList);
        query = query.overlaps('abilities', abilityList);
      }
    }

    // Apply genres filter (array overlap)
    if (genres) {
      const genreList = genres.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (genreList.length > 0) {
        console.log('🎨 Applying genres filter:', genreList);
        query = query.overlaps('genres', genreList);
      }
    }

    // Note: Performance filtering requires JSONB queries which are complex in Supabase
    // TODO: Implement performance filtering as a future enhancement
    // This would require either post-processing or custom RPC functions

    // Apply search filter
    if (search) {
      console.log('🔍 Applying search filter:', search);
      // Use Supabase text search if available, otherwise basic ILIKE
      query = query.ilike('title', `%${search}%`);
    }

    // Apply sorting
    query = query.order(sort_field, { ascending: sort_direction === 'asc' });

    // Apply pagination
    const offset = (page - 1) * page_size;
    query = query.range(offset, offset + page_size - 1);

    console.log('🚀 Executing filtered query...');
    const { data, error, count } = await query;

    if (error) {
      console.log('❌ LIST TOYBOXES: Query failed:', error);
      return res.status(500).json({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch toyboxes',
          details: error.message
        }
      });
    }

    console.log('✅ LIST TOYBOXES: Query succeeded, got', data?.length || 0, 'toyboxes, total:', count);

    const total = count || 0;

    // Transform data to match expected format
    const toyboxes = (data || []).map(toybox => {
      // Calculate ratings from joined data
      const ratings = toybox.toybox_ratings || [];
      const averageRating = ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
        : 0;

      // Count likes from joined data
      const likes = toybox.toybox_likes || [];

      return {
        id: toybox.id,
        title: toybox.title,
        description: toybox.description,
        created_at: toybox.created_at,
        updated_at: toybox.updated_at,
        version: toybox.version,
        total_objects: toybox.total_objects,
        unique_objects: toybox.unique_objects,
        featured: toybox.featured,
        download_count: toybox.download_count,
        creator_display_name: toybox.users?.username || 'Unknown',
        average_rating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
        rating_count: ratings.length,
        like_count: likes.length
      };
    });

    console.log('📦 LIST TOYBOXES: Formatting response...');

    const items = toyboxes.map(toybox => ({
      id: toybox.id,
      name: toybox.title,
      creator_display_name: toybox.creator_display_name,
      downloads: { count: toybox.download_count || 0 },
      likes: { count: toybox.like_count || 0 },
      rating: toybox.average_rating || 0,
      created_at: toybox.created_at,
      featured: toybox.featured,
      status: 'published'
    }));

    console.log('✅ LIST TOYBOXES: Response formatted, sending', items.length, 'items');

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

/**
 * Update toybox
 */
const updateToybox = async (req, res) => {
  try {
    const { id } = req.params;

    // Get existing toybox and verify ownership
    const { data: existingToybox, error: fetchError } = await supabase
      .from('toyboxes')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existingToybox) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found'
        }
      });
    }

    // Verify ownership
    if (existingToybox.creator_id !== req.user.id) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Not authorized to update this toybox'
        }
      });
    }

    // Parse content info if provided
    let parsedContentInfo, parsedScreenshotInfo;
    const { contentInfo, screenshotInfo } = req.body;
    
    if (contentInfo) {
      try {
        parsedContentInfo = typeof contentInfo === 'string' ? JSON.parse(contentInfo) : contentInfo;
      } catch (err) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in contentInfo'
          }
        });
      }
    }

    if (screenshotInfo) {
      try {
        parsedScreenshotInfo = typeof screenshotInfo === 'string' ? JSON.parse(screenshotInfo) : screenshotInfo;
      } catch (err) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in screenshotInfo'
          }
        });
      }
    }

    // Handle file updates
    const contentFile = req.files?.content || req.files?.data;
    const screenshotFile = req.files?.screenshot;
    
    let newContentPath = existingToybox.file_path;
    let newFileHash = existingToybox.file_hash;
    let newFileSize = existingToybox.file_size;
    let oldContentPath = null;

    // Update content file if provided
    if (contentFile) {
      const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 104857600;
      if (contentFile.size > maxSize) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: `File too large. Maximum size: ${maxSize} bytes`
          }
        });
      }

      // Generate new file hash
      newFileHash = generateFileHash(contentFile.data);

      // Upload new content file
      const newFileName = `toybox_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.dat`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET || 'toyboxes')
        .upload(newFileName, contentFile.data, {
          contentType: 'application/octet-stream',
          upsert: false
        });

      if (uploadError) {
        winston.error('Content upload error:', uploadError);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Failed to upload content file'
          }
        });
      }

      oldContentPath = existingToybox.file_path;
      newContentPath = uploadData.path;
      newFileSize = contentFile.size;
    }

    // Handle screenshot update
    let newScreenshotPath = existingToybox.screenshot;
    let newScreenshotMetadata = existingToybox.screenshot_metadata;
    let oldScreenshotPath = null;

    if (screenshotFile) {
      const screenshotFileName = `screenshot_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
      const { data: screenshotUpload, error: screenshotError } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET || 'toyboxes')
        .upload(screenshotFileName, screenshotFile.data, {
          contentType: 'image/png',
          upsert: false
        });

      if (screenshotError) {
        winston.warn(`Screenshot upload failed: ${screenshotError.message}`);
      } else {
        oldScreenshotPath = existingToybox.screenshot;
        newScreenshotPath = screenshotUpload.path;
        newScreenshotMetadata = parsedScreenshotInfo;
      }
    }

    // Build update object
    const updateData = {
      updated_at: new Date().toISOString()
    };

    // Update metadata if provided
    if (parsedContentInfo) {
      if (parsedContentInfo.name) updateData.title = parsedContentInfo.name;
      if (parsedContentInfo.desc !== undefined) updateData.description = parsedContentInfo.desc;
      if (parsedContentInfo.version) updateData.version = parsedContentInfo.version;
      if (parsedContentInfo.igps) updateData.avatars = parsedContentInfo.igps;
      if (parsedContentInfo.abilities) updateData.abilities = parsedContentInfo.abilities;
      if (parsedContentInfo.genres) updateData.genres = parsedContentInfo.genres;
      if (parsedContentInfo.playsets) updateData.playsets = parsedContentInfo.playsets;
      if (parsedContentInfo.required_playsets_size !== undefined) {
        updateData.required_playsets_size = parsedContentInfo.required_playsets_size;
      }
      if (parsedContentInfo.total_objects !== undefined) {
        updateData.total_objects = parsedContentInfo.total_objects;
      }
      if (parsedContentInfo.unique_objects !== undefined) {
        updateData.unique_objects = parsedContentInfo.unique_objects;
      }
      if (parsedContentInfo.object_counts) {
        updateData.object_counts = parsedContentInfo.object_counts;
      }
    }

    // Update file paths if changed
    if (contentFile) {
      updateData.file_path = newContentPath;
      updateData.file_hash = newFileHash;
      updateData.file_size = newFileSize;
      updateData.data_size = newFileSize;
    }

    if (screenshotFile) {
      updateData.screenshot = newScreenshotPath;
      updateData.screenshot_metadata = newScreenshotMetadata;
    }

    // Update database
    const { error: updateError } = await supabase
      .from('toyboxes')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      winston.error('Toybox update error:', updateError);
      
      // Cleanup newly uploaded files on error
      if (contentFile && newContentPath !== existingToybox.file_path) {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([newContentPath]);
      }
      if (screenshotFile && newScreenshotPath !== existingToybox.screenshot) {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove([newScreenshotPath]);
      }

      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update toybox'
        }
      });
    }

    // Delete old files after successful update
    if (oldContentPath) {
      await supabase.storage
        .from(process.env.SUPABASE_BUCKET || 'toyboxes')
        .remove([oldContentPath])
        .catch(err => winston.warn('Failed to delete old content file:', err));
    }

    if (oldScreenshotPath) {
      await supabase.storage
        .from(process.env.SUPABASE_BUCKET || 'toyboxes')
        .remove([oldScreenshotPath])
        .catch(err => winston.warn('Failed to delete old screenshot:', err));
    }

    winston.info(`Toybox updated: ${id} by ${req.user.username}`);

    res.json({
      id: id,
      message: 'Toybox updated successfully',
      updated_at: updateData.updated_at
    });

  } catch (err) {
    winston.error('Toybox update error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update toybox'
      }
    });
  }
};

/**
 * Delete toybox
 */
const deleteToybox = async (req, res) => {
  try {
    const { id } = req.params;

    // Get toybox and verify ownership
    const { data: toybox, error: fetchError } = await supabase
      .from('toyboxes')
      .select('creator_id, file_path, screenshot')
      .eq('id', id)
      .single();

    if (fetchError || !toybox) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found'
        }
      });
    }

    // Verify ownership
    if (toybox.creator_id !== req.user.id) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Not authorized to delete this toybox'
        }
      });
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('toyboxes')
      .delete()
      .eq('id', id);

    if (deleteError) {
      winston.error('Toybox delete error:', deleteError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to delete toybox'
        }
      });
    }

    // Delete files from storage
    const filesToDelete = [toybox.file_path];
    if (toybox.screenshot) {
      filesToDelete.push(toybox.screenshot);
    }

    await supabase.storage
      .from(process.env.SUPABASE_BUCKET || 'toyboxes')
      .remove(filesToDelete)
      .catch(err => winston.warn('Failed to delete toybox files:', err));

    winston.info(`Toybox deleted: ${id} by ${req.user.username}`);

    res.json({
      message: 'Toybox deleted successfully'
    });

  } catch (err) {
    winston.error('Toybox delete error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to delete toybox'
      }
    });
  }
};

module.exports = {
  uploadToybox,
  downloadToybox,
  listToyboxes,
  updateToybox,
  deleteToybox,
  uploadValidation,
  downloadValidation,
  listValidation
};
