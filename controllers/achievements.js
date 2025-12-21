/**
 * Achievement System Controller
 * Handles achievement tracking, awarding, and management
 */

const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Get all achievements
 */
const getAchievements = [
  authenticateToken,
  async (req, res) => {
    try {
      const { category, difficulty } = req.query;

      let query = `
        SELECT
          a.id,
          a.name,
          a.description,
          a.icon,
          a.category,
          a.difficulty,
          a.requirements,
          a.rewards,
          a.max_progress,
          a.created_at,
          ac.name as category_name,
          ac.description as category_description
        FROM achievements a
        LEFT JOIN achievement_categories ac ON a.category = ac.name
        WHERE a.is_active = TRUE
      `;

      const params = [];
      const conditions = [];

      if (category) {
        conditions.push(`a.category = $${params.length + 1}`);
        params.push(category);
      }

      if (difficulty) {
        conditions.push(`a.difficulty = $${params.length + 1}`);
        params.push(difficulty);
      }

      if (conditions.length > 0) {
        query += ` AND ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY ac.sort_order ASC, a.difficulty DESC, a.created_at ASC`;

      const result = await pool.query(query, params);

      // Get achievement categories for reference
      const categoriesQuery = `
        SELECT name, description, icon, sort_order
        FROM achievement_categories
        WHERE is_active = TRUE
        ORDER BY sort_order ASC
      `;

      const categoriesResult = await pool.query(categoriesQuery);

      res.json({
        achievements: result.rows,
        categories: categoriesResult.rows,
        meta: {
          total: result.rows.length,
          filters: { category, difficulty }
        }
      });
    } catch (error) {
      console.error('Error getting achievements:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve achievements'
        }
      });
    }
  }
];

/**
 * Get player achievements
 */
const getPlayerAchievements = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.params.userId || req.user.id;
      const { include_progress = false, category } = req.query;

      // Check privacy settings if viewing another user's achievements
      if (userId !== req.user.id) {
        const privacyQuery = `
          SELECT profile_data->'privacy_settings'->>'stats_visibility' as stats_visibility,
                 profile_data->>'achievements_visible' as achievements_visible
          FROM users
          WHERE id = $1
        `;
        const privacyResult = await pool.query(privacyQuery, [userId]);

        if (privacyResult.rows.length === 0) {
          return res.status(404).json({
            error: {
              code: 'USER_NOT_FOUND',
              message: 'User not found'
            }
          });
        }

        const privacy = privacyResult.rows[0];
        if (privacy.achievements_visible === 'false' ||
            privacy.stats_visibility === 'private') {
          return res.status(403).json({
            error: {
              code: 'ACHIEVEMENTS_PRIVATE',
              message: 'This user\'s achievements are private'
            }
          });
        }

        if (privacy.stats_visibility === 'friends') {
          // Check if viewer is friends
          const friendQuery = `
            SELECT 1 FROM friends
            WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
            AND status = 'accepted'
          `;
          const friendResult = await pool.query(friendQuery, [userId, req.user.id]);
          if (friendResult.rows.length === 0) {
            return res.status(403).json({
              error: {
                code: 'ACHIEVEMENTS_FRIENDS_ONLY',
                message: 'This user\'s achievements are only visible to friends'
              }
            });
          }
        }
      }

      // Get unlocked achievements
      let unlockedQuery = `
        SELECT
          pa.unlocked_at,
          pa.is_new,
          a.id,
          a.name,
          a.description,
          a.icon,
          a.category,
          a.difficulty,
          a.rewards,
          ac.name as category_name
        FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        LEFT JOIN achievement_categories ac ON a.category = ac.name
        WHERE pa.user_id = $1
      `;

      const params = [userId];
      if (category) {
        unlockedQuery += ` AND a.category = $${params.length + 1}`;
        params.push(category);
      }

      unlockedQuery += ` ORDER BY pa.unlocked_at DESC`;

      const unlockedResult = await pool.query(unlockedQuery, params);

      let progressResult = null;
      if (include_progress) {
        // Get achievement progress for incomplete achievements
        const progressQuery = `
          SELECT
            ap.progress,
            ap.completed,
            ap.completed_at,
            a.id,
            a.name,
            a.description,
            a.icon,
            a.category,
            a.difficulty,
            a.max_progress,
            a.requirements,
            ac.name as category_name
          FROM achievement_progress ap
          JOIN achievements a ON ap.achievement_id = a.id
          LEFT JOIN achievement_categories ac ON a.category = ac.name
          WHERE ap.user_id = $1 AND ap.completed = FALSE
        `;

        if (category) {
          progressQuery += ` AND a.category = $2`;
          progressResult = await pool.query(progressQuery, [userId, category]);
        } else {
          progressResult = await pool.query(progressQuery, [userId]);
        }
      }

      // Get achievement statistics
      const statsQuery = `
        SELECT
          COUNT(CASE WHEN difficulty = 'bronze' THEN 1 END) as bronze_count,
          COUNT(CASE WHEN difficulty = 'silver' THEN 1 END) as silver_count,
          COUNT(CASE WHEN difficulty = 'gold' THEN 1 END) as gold_count,
          COUNT(CASE WHEN difficulty = 'platinum' THEN 1 END) as platinum_count,
          COUNT(*) as total_count
        FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.user_id = $1
      `;

      const statsResult = await pool.query(statsQuery, [userId]);
      const stats = statsResult.rows[0];

      res.json({
        achievements: {
          unlocked: unlockedResult.rows,
          in_progress: progressResult ? progressResult.rows : null
        },
        statistics: {
          total_unlocked: parseInt(stats.total_count),
          by_difficulty: {
            bronze: parseInt(stats.bronze_count),
            silver: parseInt(stats.silver_count),
            gold: parseInt(stats.gold_count),
            platinum: parseInt(stats.platinum_count)
          }
        },
        meta: {
          user_id: userId,
          is_own_profile: userId === req.user.id,
          include_progress: include_progress === 'true' || include_progress === true
        }
      });
    } catch (error) {
      console.error('Error getting player achievements:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve achievements'
        }
      });
    }
  }
];

/**
 * Get achievement notifications
 */
const getAchievementNotifications = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { limit = 20, unread_only = false } = req.query;

      let query = `
        SELECT
          an.id,
          an.achievement_id,
          an.notification_type,
          an.message,
          an.is_read,
          an.created_at,
          a.name as achievement_name,
          a.description as achievement_description,
          a.icon as achievement_icon,
          a.difficulty,
          a.category
        FROM achievement_notifications an
        JOIN achievements a ON an.achievement_id = a.id
        WHERE an.user_id = $1
      `;

      const params = [userId];

      if (unread_only === 'true' || unread_only === true) {
        query += ` AND an.is_read = FALSE`;
      }

      query += ` ORDER BY an.created_at DESC LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));

      const result = await pool.query(query, params);

      // Mark notifications as read if requested
      if (result.rows.length > 0 && req.query.mark_read === 'true') {
        const unreadIds = result.rows.filter(n => !n.is_read).map(n => n.id);
        if (unreadIds.length > 0) {
          await pool.query(
            `UPDATE achievement_notifications SET is_read = TRUE WHERE id = ANY($1)`,
            [unreadIds]
          );
        }
      }

      // Get unread count
      const unreadCountQuery = `
        SELECT COUNT(*) as unread_count
        FROM achievement_notifications
        WHERE user_id = $1 AND is_read = FALSE
      `;

      const unreadResult = await pool.query(unreadCountQuery, [userId]);

      res.json({
        notifications: result.rows,
        meta: {
          total: result.rows.length,
          unread_count: parseInt(unreadResult.rows[0].unread_count),
          limit: parseInt(limit),
          unread_only: unread_only === 'true' || unread_only === true
        }
      });
    } catch (error) {
      console.error('Error getting achievement notifications:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve notifications'
        }
      });
    }
  }
];

/**
 * Mark notifications as read
 */
const markNotificationsRead = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { notification_ids } = req.body;

      if (!notification_ids || !Array.isArray(notification_ids)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'notification_ids must be an array'
          }
        });
      }

      const query = `
        UPDATE achievement_notifications
        SET is_read = TRUE
        WHERE user_id = $1 AND id = ANY($2)
        RETURNING id
      `;

      const result = await pool.query(query, [userId, notification_ids]);

      res.json({
        success: true,
        message: `${result.rows.length} notifications marked as read`,
        updated_count: result.rows.length
      });
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update notifications'
        }
      });
    }
  }
];

/**
 * Check and award achievements (internal function)
 */
async function checkAndAwardAchievements(userId, criteriaType, criteriaData) {
  try {
    const query = `
      SELECT check_achievement_criteria($1, $2, $3) as result
    `;

    await pool.query(query, [userId, criteriaType, JSON.stringify(criteriaData)]);
    return true;
  } catch (error) {
    console.error('Error checking achievements:', error);
    return false;
  }
}

/**
 * Manually trigger achievement check (admin/debug endpoint)
 */
const triggerAchievementCheck = [
  authenticateToken,
  async (req, res) => {
    try {
      const { userId, criteriaType, criteriaData } = req.body;

      if (!userId || !criteriaType || !criteriaData) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'userId, criteriaType, and criteriaData are required'
          }
        });
      }

      // Check if user is admin or checking their own achievements
      if (req.user.id !== userId && !req.user.is_admin) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Can only check achievements for yourself or must be admin'
          }
        });
      }

      const success = await checkAndAwardAchievements(userId, criteriaType, criteriaData);

      if (success) {
        res.json({
          success: true,
          message: 'Achievement check completed'
        });
      } else {
        res.status(500).json({
          error: {
            code: 'ACHIEVEMENT_CHECK_FAILED',
            message: 'Failed to check achievements'
          }
        });
      }
    } catch (error) {
      console.error('Error triggering achievement check:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to trigger achievement check'
        }
      });
    }
  }
];

/**
 * Get achievement leaderboard
 */
const getAchievementLeaderboard = [
  authenticateToken,
  async (req, res) => {
    try {
      const { limit = 50, category } = req.query;

      let query = `
        SELECT
          u.id,
          u.username,
          COALESCE(u.profile_data->>'display_name', u.username) as display_name,
          COUNT(pa.achievement_id) as achievement_count,
          COUNT(CASE WHEN a.difficulty = 'platinum' THEN 1 END) as platinum_count,
          COUNT(CASE WHEN a.difficulty = 'gold' THEN 1 END) as gold_count,
          COUNT(CASE WHEN a.difficulty = 'silver' THEN 1 END) as silver_count,
          COUNT(CASE WHEN a.difficulty = 'bronze' THEN 1 END) as bronze_count,
          MAX(pa.unlocked_at) as last_achievement_date
        FROM users u
        LEFT JOIN player_achievements pa ON u.id = pa.user_id
        LEFT JOIN achievements a ON pa.achievement_id = a.id
        WHERE u.is_active = TRUE
      `;

      const params = [];

      if (category) {
        query += ` AND a.category = $${params.length + 1}`;
        params.push(category);
      }

      query += `
        GROUP BY u.id, u.username, u.profile_data
        ORDER BY achievement_count DESC, platinum_count DESC, gold_count DESC
        LIMIT $${params.length + 1}
      `;

      params.push(parseInt(limit));

      const result = await pool.query(query, params);

      res.json({
        leaderboard: result.rows.map((row, index) => ({
          rank: index + 1,
          ...row,
          achievement_count: parseInt(row.achievement_count),
          platinum_count: parseInt(row.platinum_count),
          gold_count: parseInt(row.gold_count),
          silver_count: parseInt(row.silver_count),
          bronze_count: parseInt(row.bronze_count)
        })),
        meta: {
          limit: parseInt(limit),
          category: category || 'all'
        }
      });
    } catch (error) {
      console.error('Error getting achievement leaderboard:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve leaderboard'
        }
      });
    }
  }
];

module.exports = {
  getAchievements,
  getPlayerAchievements,
  getAchievementNotifications,
  markNotificationsRead,
  triggerAchievementCheck,
  getAchievementLeaderboard,
  checkAndAwardAchievements
};
