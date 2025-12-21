const express = require('express');
const router = express.Router();
const { register, login, refresh, registerValidation, loginValidation } = require('../controllers/auth');
const { authenticateToken } = require('../middleware/auth');

/**
 * Authentication routes
 */

// User registration
router.post('/register', registerValidation, register);

// User login
router.post('/login', loginValidation, login);

// Refresh access token
router.post('/refresh', refresh);

// Get current user profile (requires authentication)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { supabase } = require('../config/database');

    // Get user profile data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, profile_data, created_at, last_login')
      .eq('id', req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Get toybox stats
    const { data: toyboxStats, error: statsError } = await supabase
      .from('toyboxes')
      .select('id, download_count', { count: 'exact' })
      .eq('creator_id', req.user.id);

    const { data: downloadStats, error: downloadError } = await supabase
      .from('toybox_downloads')
      .select('id', { count: 'exact' })
      .eq('user_id', req.user.id);

    // Calculate stats (handle potential errors gracefully)
    const toyboxesCreated = toyboxStats ? toyboxStats.length : 0;
    const toyboxesDownloaded = downloadStats ? downloadStats.length : 0;
    const totalDownloads = toyboxStats ?
      toyboxStats.reduce((sum, toybox) => sum + (toybox.download_count || 0), 0) : 0;

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      profile_data: user.profile_data,
      created_at: user.created_at,
      last_login: user.last_login,
      stats: {
        toyboxes_created: toyboxesCreated,
        toyboxes_downloaded: toyboxesDownloaded,
        total_downloads: totalDownloads
      }
    });

  } catch (err) {
    const winston = require('winston');
    winston.error('Profile fetch error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch profile'
      }
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { supabase } = require('../config/database');
    const { profile_data } = req.body;

    if (!profile_data || typeof profile_data !== 'object') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'profile_data object required'
        }
      });
    }

    // First get current profile data
    const { data: currentUser, error: getError } = await supabase
      .from('users')
      .select('profile_data')
      .eq('id', req.user.id)
      .single();

    if (getError || !currentUser) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Merge profile data
    const updatedProfileData = { ...currentUser.profile_data, ...profile_data };

    // Update the profile
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ profile_data: updatedProfileData })
      .eq('id', req.user.id)
      .select('profile_data')
      .single();

    if (updateError) {
      const winston = require('winston');
      winston.error('Profile update error:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update profile'
        }
      });
    }

    res.json({
      profile_data: updatedUser.profile_data
    });

  } catch (err) {
    const winston = require('winston');
    winston.error('Profile update error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update profile'
      }
    });
  }
});

module.exports = router;
