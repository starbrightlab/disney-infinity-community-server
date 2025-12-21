/**
 * Profile Management Controller
 * Handles user profile operations including customization, avatars, and statistics
 */

const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Get user profile
 */
const getProfile = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const query = `
        SELECT
          id,
          username,
          profile_data,
          created_at,
          last_login,
          is_active
        FROM users
        WHERE id = $1 AND is_active = TRUE
      `;

      const result = await pool.query(query, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User profile not found'
          }
        });
      }

      const user = result.rows[0];
      const profileData = user.profile_data || {};

      // Calculate profile completion percentage
      const completionScore = calculateProfileCompletion(profileData);

      res.json({
        profile: {
          id: user.id,
          username: user.username,
          display_name: profileData.display_name || user.username,
          bio: profileData.bio || '',
          avatar: profileData.avatar || { character_id: 1, costume: 'default', accessories: [] },
          theme: profileData.theme || { primary_color: '#4A90E2', background: 'default' },
          privacy_settings: profileData.privacy_settings || {
            profile_visibility: 'public',
            stats_visibility: 'public'
          },
          achievements_visible: profileData.achievements_visible !== false,
          show_online_status: profileData.show_online_status !== false,
          profile_completion: completionScore,
          created_at: user.created_at,
          last_login: user.last_login
        }
      });
    } catch (error) {
      console.error('Error getting profile:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve profile'
        }
      });
    }
  }
];

/**
 * Update user profile
 */
const updateProfile = [
  authenticateToken,
  [
    body('display_name')
      .optional()
      .isLength({ min: 1, max: 50 })
      .withMessage('Display name must be 1-50 characters')
      .matches(/^[a-zA-Z0-9\s\-_]+$/)
      .withMessage('Display name contains invalid characters'),
    body('bio')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Bio must be less than 500 characters'),
    body('privacy_settings.profile_visibility')
      .optional()
      .isIn(['public', 'friends', 'private'])
      .withMessage('Invalid profile visibility setting'),
    body('privacy_settings.stats_visibility')
      .optional()
      .isIn(['public', 'friends', 'private'])
      .withMessage('Invalid stats visibility setting'),
    body('theme.primary_color')
      .optional()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('Invalid primary color format'),
    body('theme.background')
      .optional()
      .isIn(['default', 'dark', 'light', 'custom'])
      .withMessage('Invalid theme background'),
    body('achievements_visible')
      .optional()
      .isBoolean()
      .withMessage('achievements_visible must be a boolean'),
    body('show_online_status')
      .optional()
      .isBoolean()
      .withMessage('show_online_status must be a boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid profile data',
            details: errors.array()
          }
        });
      }

      const userId = req.user.id;
      const updates = req.body;

      // Get current profile data
      const currentQuery = 'SELECT profile_data FROM users WHERE id = $1';
      const currentResult = await pool.query(currentQuery, [userId]);

      if (currentResult.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      const currentProfileData = currentResult.rows[0].profile_data || {};

      // Check for duplicate display name if being updated
      if (updates.display_name && updates.display_name !== currentProfileData.display_name) {
        const duplicateQuery = `
          SELECT id FROM users
          WHERE profile_data->>'display_name' = $1 AND id != $2 AND is_active = TRUE
        `;
        const duplicateResult = await pool.query(duplicateQuery, [updates.display_name, userId]);

        if (duplicateResult.rows.length > 0) {
          return res.status(409).json({
            error: {
              code: 'DISPLAY_NAME_TAKEN',
              message: 'Display name is already taken'
            }
          });
        }
      }

      // Merge updates with existing profile data
      const updatedProfileData = {
        ...currentProfileData,
        ...updates,
        updated_at: new Date().toISOString()
      };

      // Update profile
      const updateQuery = `
        UPDATE users
        SET profile_data = $1
        WHERE id = $2
        RETURNING id, username, profile_data, last_login
      `;

      const result = await pool.query(updateQuery, [JSON.stringify(updatedProfileData), userId]);

      const profileData = result.rows[0].profile_data;
      const completionScore = calculateProfileCompletion(profileData);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: {
          id: result.rows[0].id,
          username: result.rows[0].username,
          display_name: profileData.display_name || result.rows[0].username,
          bio: profileData.bio || '',
          avatar: profileData.avatar || { character_id: 1, costume: 'default', accessories: [] },
          theme: profileData.theme || { primary_color: '#4A90E2', background: 'default' },
          privacy_settings: profileData.privacy_settings || {
            profile_visibility: 'public',
            stats_visibility: 'public'
          },
          achievements_visible: profileData.achievements_visible !== false,
          show_online_status: profileData.show_online_status !== false,
          profile_completion: completionScore,
          last_login: result.rows[0].last_login
        }
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update profile'
        }
      });
    }
  }
];

/**
 * Update user avatar
 */
const updateAvatar = [
  authenticateToken,
  [
    body('character_id')
      .isInt({ min: 1, max: 1000 })
      .withMessage('Invalid character ID'),
    body('costume')
      .optional()
      .isIn(['default', 'hero', 'villain', 'classic', 'modern'])
      .withMessage('Invalid costume type'),
    body('accessories')
      .optional()
      .isArray()
      .withMessage('Accessories must be an array'),
    body('accessories.*')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Invalid accessory ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid avatar data',
            details: errors.array()
          }
        });
      }

      const userId = req.user.id;
      const { character_id, costume, accessories } = req.body;

      // Validate character combination (basic validation - could be expanded)
      if (!isValidCharacterCombination(character_id, costume, accessories)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CHARACTER_COMBINATION',
            message: 'Invalid character, costume, or accessory combination'
          }
        });
      }

      // Get current profile data
      const currentQuery = 'SELECT profile_data FROM users WHERE id = $1';
      const currentResult = await pool.query(currentQuery, [userId]);

      if (currentResult.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      const currentProfileData = currentResult.rows[0].profile_data || {};

      // Update avatar data
      const updatedProfileData = {
        ...currentProfileData,
        avatar: {
          character_id,
          costume: costume || 'default',
          accessories: accessories || []
        },
        updated_at: new Date().toISOString()
      };

      // Update profile
      const updateQuery = `
        UPDATE users
        SET profile_data = $1
        WHERE id = $2
      `;

      await pool.query(updateQuery, [JSON.stringify(updatedProfileData), userId]);

      res.json({
        success: true,
        message: 'Avatar updated successfully',
        avatar: updatedProfileData.avatar
      });
    } catch (error) {
      console.error('Error updating avatar:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update avatar'
        }
      });
    }
  }
];

/**
 * Get detailed profile statistics
 */
const getDetailedStats = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // Get comprehensive stats from multiple sources
      const statsQuery = `
        WITH user_stats AS (
          SELECT
            u.id,
            u.username,
            u.created_at,
            u.last_login,
            COALESCE(u.profile_data->>'display_name', u.username) as display_name
          FROM users u
          WHERE u.id = $1 AND u.is_active = TRUE
        ),
        game_stats AS (
          SELECT
            COALESCE(SUM(matches_played), 0) as total_matches,
            COALESCE(SUM(matches_won), 0) as matches_won,
            COALESCE(SUM(play_time_minutes), 0) as total_play_time
          FROM profile_analytics
          WHERE user_id = $1
        ),
        social_stats AS (
          SELECT
            COUNT(*) as friends_count
          FROM friends f
          WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
        ),
        creation_stats AS (
          SELECT
            COUNT(*) as toyboxes_created,
            COALESCE(SUM(download_count), 0) as total_downloads
          FROM toyboxes
          WHERE creator_id = $1 AND status = 3
        ),
        achievement_stats AS (
          SELECT
            COUNT(*) as achievements_unlocked,
            COUNT(CASE WHEN pa.is_new = true THEN 1 END) as new_achievements
          FROM player_achievements pa
          WHERE pa.user_id = $1
        )
        SELECT
          us.*,
          gs.total_matches,
          gs.matches_won,
          CASE WHEN gs.total_matches > 0 THEN ROUND((gs.matches_won::decimal / gs.total_matches) * 100, 2) ELSE 0 END as win_rate,
          gs.total_play_time,
          ss.friends_count,
          cs.toyboxes_created,
          cs.total_downloads,
          acs.achievements_unlocked,
          acs.new_achievements
        FROM user_stats us
        CROSS JOIN game_stats gs
        CROSS JOIN social_stats ss
        CROSS JOIN creation_stats cs
        CROSS JOIN achievement_stats acs
      `;

      const result = await pool.query(statsQuery, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      const stats = result.rows[0];

      // Get favorite characters (from analytics)
      const favoriteCharactersQuery = `
        SELECT characters_used
        FROM profile_analytics
        WHERE user_id = $1
        ORDER BY date DESC
        LIMIT 30
      `;

      const charactersResult = await pool.query(favoriteCharactersQuery, [userId]);
      const favoriteCharacters = aggregateCharacterUsage(charactersResult.rows);

      // Get recent achievements
      const recentAchievementsQuery = `
        SELECT
          pa.unlocked_at,
          a.name,
          a.description,
          a.icon,
          a.difficulty,
          a.category
        FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.user_id = $1
        ORDER BY pa.unlocked_at DESC
        LIMIT 10
      `;

      const achievementsResult = await pool.query(recentAchievementsQuery, [userId]);

      res.json({
        stats: {
          user_info: {
            id: stats.id,
            username: stats.username,
            display_name: stats.display_name,
            created_at: stats.created_at,
            last_login: stats.last_login
          },
          gameplay: {
            total_matches: parseInt(stats.total_matches),
            matches_won: parseInt(stats.matches_won),
            matches_lost: parseInt(stats.total_matches) - parseInt(stats.matches_won),
            win_rate: parseFloat(stats.win_rate),
            total_play_time_minutes: parseInt(stats.total_play_time),
            total_play_time_hours: Math.round((parseInt(stats.total_play_time) / 60) * 100) / 100
          },
          social: {
            friends_count: parseInt(stats.friends_count)
          },
          creation: {
            toyboxes_created: parseInt(stats.toyboxes_created),
            total_downloads: parseInt(stats.total_downloads)
          },
          achievements: {
            total_unlocked: parseInt(stats.achievements_unlocked),
            new_achievements: parseInt(stats.new_achievements),
            recent_achievements: achievementsResult.rows
          },
          favorites: {
            characters: favoriteCharacters
          }
        }
      });
    } catch (error) {
      console.error('Error getting detailed stats:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve detailed statistics'
        }
      });
    }
  }
];

/**
 * Get public profile (for viewing other users)
 */
const getPublicProfile = [
  async (req, res) => {
    try {
      const { userId } = req.params;
      const viewerId = req.user ? req.user.id : null;

      const query = `
        SELECT
          u.id,
          u.username,
          u.profile_data,
          u.created_at,
          u.last_login
        FROM users u
        WHERE u.id = $1 AND u.is_active = TRUE
      `;

      const result = await pool.query(query, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      const user = result.rows[0];
      const profileData = user.profile_data || {};

      // Check privacy settings
      const privacySettings = profileData.privacy_settings || { profile_visibility: 'public' };

      if (privacySettings.profile_visibility === 'private') {
        // Only show basic info for private profiles
        return res.json({
          profile: {
            id: user.id,
            username: user.username,
            display_name: profileData.display_name || user.username,
            avatar: profileData.avatar || { character_id: 1, costume: 'default', accessories: [] },
            privacy_settings: privacySettings,
            is_private: true
          }
        });
      }

      if (privacySettings.profile_visibility === 'friends' && viewerId) {
        // Check if viewer is friends with this user
        const friendQuery = `
          SELECT 1 FROM friends
          WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
          AND status = 'accepted'
        `;
        const friendResult = await pool.query(friendQuery, [userId, viewerId]);

        if (friendResult.rows.length === 0) {
          return res.status(403).json({
            error: {
              code: 'PROFILE_PRIVATE',
              message: 'This profile is only visible to friends'
            }
          });
        }
      }

      // Get showcase items
      const showcaseQuery = `
        SELECT showcase_type, showcase_data, display_order
        FROM profile_showcase
        WHERE user_id = $1 AND is_featured = true
        ORDER BY display_order ASC
      `;

      const showcaseResult = await pool.query(showcaseQuery, [userId]);

      res.json({
        profile: {
          id: user.id,
          username: user.username,
          display_name: profileData.display_name || user.username,
          bio: profileData.bio || '',
          avatar: profileData.avatar || { character_id: 1, costume: 'default', accessories: [] },
          theme: profileData.theme || { primary_color: '#4A90E2', background: 'default' },
          achievements_visible: profileData.achievements_visible !== false,
          show_online_status: profileData.show_online_status !== false,
          created_at: user.created_at,
          showcase: showcaseResult.rows,
          privacy_settings: privacySettings
        }
      });
    } catch (error) {
      console.error('Error getting public profile:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve profile'
        }
      });
    }
  }
];

/**
 * Calculate profile completion percentage
 */
function calculateProfileCompletion(profileData) {
  let score = 0;
  const maxScore = 100;

  // Display name (20 points)
  if (profileData.display_name && profileData.display_name.trim().length > 0) {
    score += 20;
  }

  // Bio (15 points)
  if (profileData.bio && profileData.bio.trim().length > 10) {
    score += 15;
  }

  // Avatar customization (25 points)
  const avatar = profileData.avatar || {};
  if (avatar.character_id && avatar.character_id !== 1) score += 10;
  if (avatar.costume && avatar.costume !== 'default') score += 10;
  if (avatar.accessories && avatar.accessories.length > 0) score += 5;

  // Theme customization (10 points)
  if (profileData.theme && profileData.theme.primary_color !== '#4A90E2') {
    score += 10;
  }

  // Privacy settings configured (10 points)
  if (profileData.privacy_settings) {
    score += 10;
  }

  // Achievements visible setting configured (10 points)
  if (profileData.achievements_visible !== undefined) {
    score += 10;
  }

  // Online status setting configured (10 points)
  if (profileData.show_online_status !== undefined) {
    score += 10;
  }

  return Math.min(score, maxScore);
}

/**
 * Validate character combination
 */
function isValidCharacterCombination(characterId, costume, accessories) {
  // Basic validation - in a real implementation, this would check against a database
  // of valid character combinations
  if (characterId < 1 || characterId > 1000) return false;
  if (costume && !['default', 'hero', 'villain', 'classic', 'modern'].includes(costume)) return false;
  if (accessories && accessories.length > 10) return false; // Max 10 accessories
  return true;
}

/**
 * Aggregate character usage from analytics data
 */
function aggregateCharacterUsage(rows) {
  const characterCounts = {};

  rows.forEach(row => {
    if (row.characters_used) {
      Object.entries(row.characters_used).forEach(([charId, count]) => {
        characterCounts[charId] = (characterCounts[charId] || 0) + count;
      });
    }
  });

  // Return top 5 favorite characters
  return Object.entries(characterCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([charId, count]) => ({ character_id: parseInt(charId), usage_count: count }));
}

module.exports = {
  getProfile,
  updateProfile,
  updateAvatar,
  getDetailedStats,
  getPublicProfile
};
