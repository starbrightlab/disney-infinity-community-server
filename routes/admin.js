const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { requireAdmin, requireModerator } = require('../middleware/auth');
const {
  getCleanupStats,
  runCleanup,
  getDatabaseHealth,
  optimizeDatabase
} = require('../controllers/cleanup');
const winston = require('winston');
const monitoring = require('../services/monitoring');

/**
 * Admin routes for moderation and management
 */

// Get server statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // User stats
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('last_login, is_admin, is_moderator');

    if (userError) {
      winston.error('User stats error:', userError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch user stats'
        }
      });
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const userStats = {
      total_users: users.length,
      active_today: users.filter(u => u.last_login && new Date(u.last_login) > oneDayAgo).length,
      admin_count: users.filter(u => u.is_admin).length,
      moderator_count: users.filter(u => u.is_moderator).length
    };

    // Toybox stats
    const { data: toyboxes, error: toyboxError } = await supabase
      .from('toyboxes')
      .select('status, featured');

    if (toyboxError) {
      winston.error('Toybox stats error:', toyboxError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch toybox stats'
        }
      });
    }

    const toyboxStats = {
      total_toyboxes: toyboxes.length,
      pending_review: toyboxes.filter(t => t.status === 1).length,
      approved: toyboxes.filter(t => t.status === 2).length,
      published: toyboxes.filter(t => t.status === 3).length,
      featured: toyboxes.filter(t => t.featured).length
    };

    // Download stats (simplified - toyboxes have download_count field)
    const { data: downloads, error: downloadError } = await supabase
      .from('toyboxes')
      .select('download_count');

    const totalDownloads = downloads?.reduce((sum, t) => sum + (t.download_count || 0), 0) || 0;

    const downloadStats = {
      total_downloads: totalDownloads,
      downloads_today: 0 // TODO: Implement download tracking with timestamps
    };

    // Rating stats
    const { data: ratings, error: ratingError } = await supabase
      .from('toybox_ratings')
      .select('rating');

    const totalRatings = ratings?.length || 0;
    const averageRating = totalRatings > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings
      : 0;

    const ratingStats = {
      total_ratings: totalRatings,
      average_rating: averageRating
    };

    res.json({
      users: {
        total: userStats.total_users,
        active_today: userStats.active_today,
        admin_count: userStats.admin_count,
        moderator_count: userStats.moderator_count
      },
      toyboxes: {
        total: toyboxStats.total_toyboxes,
        published: toyboxStats.published,
        pending_review: toyboxStats.pending_review,
        approved: toyboxStats.approved,
        featured: toyboxStats.featured
      },
      downloads: {
        total: downloadStats.total_downloads,
        today: downloadStats.downloads_today
      },
      ratings: {
        total: ratingStats.total_ratings,
        average: parseFloat(ratingStats.average_rating.toFixed(2))
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
    const { data: toybox, error: updateError } = await supabase
      .from('toyboxes')
      .update({
        status: numericStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, title, status, creator_id')
      .single();

    if (updateError || !toybox) {
      if (updateError?.code === 'PGRST116') {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Toybox not found'
          }
        });
      }
      winston.error('Toybox status update error:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update toybox status'
        }
      });
    }

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
    const { data: toybox, error: fetchError } = await supabase
      .from('toyboxes')
      .select('file_path, screenshot')
      .eq('id', id)
      .single();

    if (fetchError || !toybox) {
      if (fetchError?.code === 'PGRST116') {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Toybox not found'
          }
        });
      }
      winston.error('Toybox fetch error:', fetchError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch toybox'
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
    const { data: toyboxes, error } = await supabase
      .from('toyboxes')
      .select('id, title, description, created_at, file_size, creator_id')
      .eq('status', 1)
      .order('created_at', { ascending: true });

    if (error) {
      winston.error('Pending reviews fetch error:', error);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch pending reviews'
        }
      });
    }

    // Get creator info
    const creatorIds = [...new Set(toyboxes.map(t => t.creator_id))];
    const { data: creators } = await supabase
      .from('users')
      .select('id, username, email')
      .in('id', creatorIds);

    const creatorMap = {};
    creators?.forEach(creator => {
      creatorMap[creator.id] = creator;
    });

    const pendingReviews = toyboxes.map(toybox => {
      const creator = creatorMap[toybox.creator_id] || {};
      return {
        id: toybox.id,
        title: toybox.title,
        description: toybox.description,
        created_at: toybox.created_at,
        file_size: toybox.file_size || 0,
        creator: {
          username: creator.username,
          email: creator.email
        }
      }
    });

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

    const { data: toybox, error: updateError } = await supabase
      .from('toyboxes')
      .update({
        featured: featured,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, title, featured')
      .single();

    if (updateError || !toybox) {
      if (updateError?.code === 'PGRST116') {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Toybox not found'
          }
        });
      }
      winston.error('Toybox feature update error:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update toybox feature status'
        }
      });
    }

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

// Monitoring and alerts (admin only)
router.get('/alerts', requireAdmin, async (req, res) => {
  try {
    const alertSummary = monitoring.getAlertSummary();

    res.json({
      alerts: alertSummary,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    winston.error('Alerts fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch alerts'
      }
    });
  }
});

// Configure alert thresholds (admin only)
router.put('/alerts/thresholds', requireAdmin, async (req, res) => {
  try {
    const { thresholds } = req.body;

    if (!thresholds || typeof thresholds !== 'object') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Thresholds object required'
        }
      });
    }

    monitoring.setThresholds(thresholds);

    res.json({
      message: 'Alert thresholds updated successfully',
      thresholds: monitoring.thresholds,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    winston.error('Thresholds update error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update thresholds'
      }
    });
  }
});

module.exports = router;
