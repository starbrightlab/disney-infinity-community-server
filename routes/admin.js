const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAdmin, requireModerator } = require('../middleware/auth');
const {
  getCleanupStats,
  runCleanup,
  getDatabaseHealth,
  optimizeDatabase
} = require('../controllers/cleanup');
const winston = require('winston');

/**
 * Admin routes for moderation and management
 */

// Get server statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // User stats
    const userStats = await query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN last_login > NOW() - INTERVAL '1 day' THEN 1 END) as active_today,
        COUNT(CASE WHEN is_admin THEN 1 END) as admin_count,
        COUNT(CASE WHEN is_moderator THEN 1 END) as moderator_count
      FROM users
    `);

    // Toybox stats
    const toyboxStats = await query(`
      SELECT
        COUNT(*) as total_toyboxes,
        COUNT(CASE WHEN status = 1 THEN 1 END) as pending_review,
        COUNT(CASE WHEN status = 2 THEN 1 END) as approved,
        COUNT(CASE WHEN status = 3 THEN 1 END) as published,
        COUNT(CASE WHEN featured THEN 1 END) as featured
      FROM toyboxes
    `);

    // Download stats
    const downloadStats = await query(`
      SELECT
        SUM(download_count) as total_downloads,
        COUNT(CASE WHEN downloaded_at > NOW() - INTERVAL '1 day' THEN 1 END) as downloads_today
      FROM toybox_downloads
    `);

    // Rating stats
    const ratingStats = await query(`
      SELECT
        COUNT(*) as total_ratings,
        AVG(rating) as average_rating
      FROM toybox_ratings
    `);

    res.json({
      users: {
        total: parseInt(userStats.rows[0].total_users),
        active_today: parseInt(userStats.rows[0].active_today),
        admin_count: parseInt(userStats.rows[0].admin_count),
        moderator_count: parseInt(userStats.rows[0].moderator_count)
      },
      toyboxes: {
        total: parseInt(toyboxStats.rows[0].total_toyboxes),
        published: parseInt(toyboxStats.rows[0].published),
        pending_review: parseInt(toyboxStats.rows[0].pending_review),
        approved: parseInt(toyboxStats.rows[0].approved),
        featured: parseInt(toyboxStats.rows[0].featured)
      },
      downloads: {
        total: parseInt(downloadStats.rows[0].total_downloads || 0),
        today: parseInt(downloadStats.rows[0].downloads_today || 0)
      },
      ratings: {
        total: parseInt(ratingStats.rows[0].total_ratings || 0),
        average: parseFloat(ratingStats.rows[0].average_rating || 0)
      }
    });

  } catch (err) {
    winston.error('Stats fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch statistics'
      }
    });
  }
});

// Moderate toybox status
router.put('/toybox/:id/status', requireModerator, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, moderator_notes } = req.body;

    // Validate status
    const validStatuses = {
      'approved': 2,
      'published': 3,
      'rejected': 0
    };

    if (!validStatuses.hasOwnProperty(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid status. Must be: approved, published, or rejected'
        }
      });
    }

    const numericStatus = validStatuses[status];

    // Update toybox status
    const result = await query(`
      UPDATE toyboxes
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, title, status, creator_id
    `, [numericStatus, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found'
        }
      });
    }

    const toybox = result.rows[0];

    winston.info(`Toybox moderated: ${toybox.title} (${id}) set to ${status} by ${req.user.username}`);

    res.json({
      id: toybox.id,
      status: status,
      updated_at: new Date().toISOString(),
      message: `Toybox ${status} successfully`
    });

  } catch (err) {
    winston.error('Toybox moderation error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to moderate toybox'
      }
    });
  }
});

// Delete toybox (admin only)
router.delete('/toybox/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { createClient } = require('@supabase/supabase-js');

    // Get toybox info for cleanup
    const toyboxResult = await query(
      'SELECT file_path, screenshot FROM toyboxes WHERE id = $1',
      [id]
    );

    if (toyboxResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found'
        }
      });
    }

    const toybox = toyboxResult.rows[0];

    // Delete from database
    await query('DELETE FROM toyboxes WHERE id = $1', [id]);

    // Clean up files from Supabase (skip in test environment)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (process.env.SUPABASE_URL && serviceKey) {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        serviceKey
      );

      const filesToDelete = [];
      if (toybox.file_path) filesToDelete.push(toybox.file_path);
      if (toybox.screenshot) filesToDelete.push(toybox.screenshot);

      if (filesToDelete.length > 0) {
        await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'toyboxes')
          .remove(filesToDelete);
      }
    }

    winston.info(`Toybox deleted: ${id} by ${req.user.username}`);

    res.json({
      message: 'Toybox deleted successfully'
    });

  } catch (err) {
    winston.error('Toybox deletion error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to delete toybox'
      }
    });
  }
});

// Get pending reviews
router.get('/reviews/pending', requireModerator, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        t.id, t.title, t.description, t.created_at, t.file_size,
        u.username as creator_username,
        u.email as creator_email
      FROM toyboxes t
      LEFT JOIN users u ON t.creator_id = u.id
      WHERE t.status = 1
      ORDER BY t.created_at ASC
    `);

    const pendingReviews = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      created_at: row.created_at,
      file_size: parseInt(row.file_size),
      creator: {
        username: row.creator_username,
        email: row.creator_email
      }
    }));

    res.json({
      pending_reviews: pendingReviews,
      count: pendingReviews.length
    });

  } catch (err) {
    winston.error('Pending reviews fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch pending reviews'
      }
    });
  }
});

// Feature/unfeature toybox
router.put('/toybox/:id/feature', requireModerator, async (req, res) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;

    if (typeof featured !== 'boolean') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'featured must be a boolean'
        }
      });
    }

    const result = await query(`
      UPDATE toyboxes
      SET featured = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, title, featured
    `, [featured, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Toybox not found'
        }
      });
    }

    const toybox = result.rows[0];

    winston.info(`Toybox ${featured ? 'featured' : 'unfeatured'}: ${toybox.title} (${id}) by ${req.user.username}`);

    res.json({
      id: toybox.id,
      featured: toybox.featured,
      message: `Toybox ${featured ? 'featured' : 'unfeatured'} successfully`
    });

  } catch (err) {
    winston.error('Feature toggle error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update feature status'
      }
    });
  }
});

// Database cleanup and maintenance (admin only)
router.get('/cleanup/stats', requireAdmin, getCleanupStats);
router.post('/cleanup/run', requireAdmin, runCleanup);
router.get('/database/health', requireAdmin, getDatabaseHealth);
router.post('/database/optimize', requireAdmin, optimizeDatabase);

module.exports = router;
