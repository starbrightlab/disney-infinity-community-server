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
    const { query } = require('../config/database');

    const result = await query(`
      SELECT id, username, email, profile_data, created_at, last_login,
             (SELECT COUNT(*) FROM toyboxes WHERE creator_id = users.id) as toyboxes_created,
             (SELECT COUNT(*) FROM toybox_downloads WHERE user_id = users.id) as toyboxes_downloaded,
             (SELECT COALESCE(SUM(download_count), 0) FROM toyboxes WHERE creator_id = users.id) as total_downloads
      FROM users WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const user = result.rows[0];

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      profile_data: user.profile_data,
      created_at: user.created_at,
      last_login: user.last_login,
      stats: {
        toyboxes_created: parseInt(user.toyboxes_created),
        toyboxes_downloaded: parseInt(user.toyboxes_downloaded),
        total_downloads: parseInt(user.total_downloads)
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
    const { query } = require('../config/database');
    const { profile_data } = req.body;

    if (!profile_data || typeof profile_data !== 'object') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'profile_data object required'
        }
      });
    }

    const result = await query(
      'UPDATE users SET profile_data = profile_data || $1 WHERE id = $2 RETURNING profile_data',
      [profile_data, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    res.json({
      profile_data: result.rows[0].profile_data
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
