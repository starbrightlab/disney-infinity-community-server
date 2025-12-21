/**
 * Achievement Service
 * Automatically tracks and awards achievements based on player actions
 */

const pool = require('../config/database');
const { checkAndAwardAchievements } = require('../controllers/achievements');

class AchievementService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the achievement service
   */
  async initialize() {
    if (this.initialized) return;

    console.log('Initializing Achievement Service...');

    // Cache achievement definitions for performance
    await this.cacheAchievementDefinitions();

    this.initialized = true;
    console.log('Achievement Service initialized');
  }

  /**
   * Cache achievement definitions
   */
  async cacheAchievementDefinitions() {
    try {
      const query = `
        SELECT id, name, requirements
        FROM achievements
        WHERE is_active = TRUE
      `;

      const result = await pool.query(query);
      this.achievementDefinitions = {};

      result.rows.forEach(achievement => {
        this.achievementDefinitions[achievement.id] = {
          name: achievement.name,
          requirements: achievement.requirements
        };
      });

      console.log(`Cached ${result.rows.length} achievement definitions`);
    } catch (error) {
      console.error('Error caching achievement definitions:', error);
    }
  }

  /**
   * Track match completion and check for achievements
   */
  async onMatchCompleted(userId, matchData) {
    try {
      const criteriaData = {
        match_win: matchData.won ? 1 : 0,
        match_loss: matchData.won ? 0 : 1,
        total_matches: 1
      };

      // Check for match-based achievements
      await checkAndAwardAchievements(userId, 'match_win', criteriaData);

      // Update daily analytics
      await this.updateDailyAnalytics(userId, {
        matches_played: 1,
        matches_won: matchData.won ? 1 : 0,
        play_time_minutes: matchData.duration_minutes || 0
      });

    } catch (error) {
      console.error('Error processing match completion achievements:', error);
    }
  }

  /**
   * Track toybox creation and check for achievements
   */
  async onToyboxCreated(userId, toyboxData) {
    try {
      const criteriaData = {
        toyboxes_created: 1
      };

      // Check for creation-based achievements
      await checkAndAwardAchievements(userId, 'toybox_created', criteriaData);

      // Update daily analytics
      await this.updateDailyAnalytics(userId, {
        toyboxes_created: 1
      });

    } catch (error) {
      console.error('Error processing toybox creation achievements:', error);
    }
  }

  /**
   * Track toybox download and check for achievements
   */
  async onToyboxDownloaded(userId, toyboxData) {
    try {
      // Update daily analytics
      await this.updateDailyAnalytics(userId, {
        toyboxes_downloaded: 1
      });

    } catch (error) {
      console.error('Error processing toybox download:', error);
    }
  }

  /**
   * Track friend addition and check for achievements
   */
  async onFriendAdded(userId, friendData) {
    try {
      const criteriaData = {
        friends_added: 1
      };

      // Check for social achievements
      await checkAndAwardAchievements(userId, 'friends_added', criteriaData);

      // Update daily analytics
      await this.updateDailyAnalytics(userId, {
        friends_added: 1
      });

    } catch (error) {
      console.error('Error processing friend addition achievements:', error);
    }
  }

  /**
   * Track play time and check for achievements
   */
  async onPlayTimeUpdate(userId, minutesPlayed) {
    try {
      // Update daily analytics
      await this.updateDailyAnalytics(userId, {
        play_time_minutes: minutesPlayed
      });

      // Check for play time achievements (weekly check to avoid spam)
      const totalPlayTime = await this.getTotalPlayTime(userId);
      if (totalPlayTime > 0 && totalPlayTime % 60 === 0) { // Every hour
        const criteriaData = {
          hours: Math.floor(totalPlayTime / 60)
        };
        await checkAndAwardAchievements(userId, 'play_time', criteriaData);
      }

    } catch (error) {
      console.error('Error processing play time achievements:', error);
    }
  }

  /**
   * Track character usage and check for achievements
   */
  async onCharacterUsed(userId, characterId) {
    try {
      // Update daily analytics with character usage
      await this.updateCharacterUsage(userId, characterId);

      // Check for character collection achievements
      const uniqueCharacters = await this.getUniqueCharacterCount(userId);
      if (uniqueCharacters > 0) {
        const criteriaData = {
          unique_characters: uniqueCharacters
        };
        await checkAndAwardAchievements(userId, 'characters_used', criteriaData);
      }

    } catch (error) {
      console.error('Error processing character usage achievements:', error);
    }
  }

  /**
   * Get total play time for user
   */
  async getTotalPlayTime(userId) {
    try {
      const query = `
        SELECT SUM(play_time_minutes) as total_minutes
        FROM profile_analytics
        WHERE user_id = $1
      `;

      const result = await pool.query(query, [userId]);
      return parseInt(result.rows[0].total_minutes) || 0;
    } catch (error) {
      console.error('Error getting total play time:', error);
      return 0;
    }
  }

  /**
   * Get unique character count for user
   */
  async getUniqueCharacterCount(userId) {
    try {
      const query = `
        SELECT COUNT(DISTINCT character_id) as unique_count
        FROM (
          SELECT jsonb_object_keys(characters_used) as character_id
          FROM profile_analytics
          WHERE user_id = $1 AND characters_used IS NOT NULL
        ) as char_keys
      `;

      const result = await pool.query(query, [userId]);
      return parseInt(result.rows[0].unique_count) || 0;
    } catch (error) {
      console.error('Error getting unique character count:', error);
      return 0;
    }
  }

  /**
   * Update daily analytics
   */
  async updateDailyAnalytics(userId, data) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // First, try to update existing record
      const updateQuery = `
        UPDATE profile_analytics
        SET
          play_time_minutes = play_time_minutes + $2,
          matches_played = matches_played + $3,
          matches_won = matches_won + $4,
          toyboxes_created = toyboxes_created + $5,
          toyboxes_downloaded = toyboxes_downloaded + $6,
          friends_added = friends_added + $7,
          achievements_unlocked = achievements_unlocked + $8,
          updated_at = NOW()
        WHERE user_id = $1 AND date = $9
      `;

      const result = await pool.query(updateQuery, [
        userId,
        data.play_time_minutes || 0,
        data.matches_played || 0,
        data.matches_won || 0,
        data.toyboxes_created || 0,
        data.toyboxes_downloaded || 0,
        data.friends_added || 0,
        data.achievements_unlocked || 0,
        today
      ]);

      // If no row was updated, insert new record
      if (result.rowCount === 0) {
        const insertQuery = `
          INSERT INTO profile_analytics (
            user_id, date, play_time_minutes, matches_played, matches_won,
            toyboxes_created, toyboxes_downloaded, friends_added, achievements_unlocked
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        await pool.query(insertQuery, [
          userId,
          today,
          data.play_time_minutes || 0,
          data.matches_played || 0,
          data.matches_won || 0,
          data.toyboxes_created || 0,
          data.toyboxes_downloaded || 0,
          data.friends_added || 0,
          data.achievements_unlocked || 0
        ]);
      }
    } catch (error) {
      console.error('Error updating daily analytics:', error);
    }
  }

  /**
   * Update character usage in analytics
   */
  async updateCharacterUsage(userId, characterId) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get current character usage
      const selectQuery = `
        SELECT characters_used
        FROM profile_analytics
        WHERE user_id = $1 AND date = $2
      `;

      const selectResult = await pool.query(selectQuery, [userId, today]);
      let charactersUsed = {};

      if (selectResult.rows.length > 0 && selectResult.rows[0].characters_used) {
        charactersUsed = selectResult.rows[0].characters_used;
      }

      // Increment usage count
      const currentCount = parseInt(charactersUsed[characterId.toString()]) || 0;
      charactersUsed[characterId.toString()] = currentCount + 1;

      // Update the record
      const updateQuery = `
        UPDATE profile_analytics
        SET characters_used = $3, updated_at = NOW()
        WHERE user_id = $1 AND date = $2
      `;

      const updateResult = await pool.query(updateQuery, [userId, today, JSON.stringify(charactersUsed)]);

      // If no row was updated, insert new record
      if (updateResult.rowCount === 0) {
        const insertQuery = `
          INSERT INTO profile_analytics (user_id, date, characters_used)
          VALUES ($1, $2, $3)
        `;

        await pool.query(insertQuery, [userId, today, JSON.stringify(charactersUsed)]);
      }
    } catch (error) {
      console.error('Error updating character usage:', error);
    }
  }

  /**
   * Process achievement on login (for catch-up)
   */
  async onUserLogin(userId) {
    try {
      // Update last login
      await pool.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [userId]
      );

      // Could add login streak achievements here
    } catch (error) {
      console.error('Error processing user login:', error);
    }
  }

  /**
   * Get achievement progress for a user
   */
  async getAchievementProgress(userId, achievementId) {
    try {
      const query = `
        SELECT progress, completed, completed_at
        FROM achievement_progress
        WHERE user_id = $1 AND achievement_id = $2
      `;

      const result = await pool.query(query, [userId, achievementId]);
      return result.rows[0] || { progress: 0, completed: false, completed_at: null };
    } catch (error) {
      console.error('Error getting achievement progress:', error);
      return { progress: 0, completed: false, completed_at: null };
    }
  }

  /**
   * Bulk achievement check for maintenance
   */
  async bulkAchievementCheck(userIds = null) {
    try {
      let userQuery = 'SELECT id FROM users WHERE is_active = TRUE';
      if (userIds) {
        userQuery += ` AND id = ANY($1)`;
      }

      const users = userIds
        ? await pool.query(userQuery, [userIds])
        : await pool.query(userQuery);

      console.log(`Running bulk achievement check for ${users.rows.length} users`);

      for (const user of users.rows) {
        // Recalculate achievements based on current stats
        await this.recalculateUserAchievements(user.id);
      }

      console.log('Bulk achievement check completed');
    } catch (error) {
      console.error('Error in bulk achievement check:', error);
    }
  }

  /**
   * Recalculate achievements for a user based on their current stats
   */
  async recalculateUserAchievements(userId) {
    try {
      // Get current stats
      const statsQuery = `
        SELECT
          (SELECT COUNT(*) FROM player_achievements WHERE user_id = $1) as achievements_unlocked,
          (SELECT COUNT(*) FROM friends f WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted') as friends_count,
          (SELECT COUNT(*) FROM toyboxes WHERE creator_id = $1 AND status = 3) as toyboxes_created,
          (SELECT SUM(matches_played) FROM profile_analytics WHERE user_id = $1) as total_matches,
          (SELECT SUM(matches_won) FROM profile_analytics WHERE user_id = $1) as matches_won,
          (SELECT SUM(play_time_minutes) FROM profile_analytics WHERE user_id = $1) as total_play_time,
          (SELECT COUNT(DISTINCT character_id) FROM (
            SELECT jsonb_object_keys(characters_used) as character_id
            FROM profile_analytics
            WHERE user_id = $1 AND characters_used IS NOT NULL
          ) as chars) as unique_characters
        FROM users WHERE id = $1
      `;

      const statsResult = await pool.query(statsQuery, [userId]);
      const stats = statsResult.rows[0];

      // Check each achievement type
      const checks = [
        { type: 'match_win', data: { wins: parseInt(stats.matches_won) || 0 } },
        { type: 'friends_added', data: { friends: parseInt(stats.friends_count) || 0 } },
        { type: 'toybox_created', data: { toyboxes: parseInt(stats.toyboxes_created) || 0 } },
        { type: 'play_time', data: { hours: Math.floor((parseInt(stats.total_play_time) || 0) / 60) } },
        { type: 'characters_used', data: { unique_characters: parseInt(stats.unique_characters) || 0 } }
      ];

      for (const check of checks) {
        if (check.data[Object.keys(check.data)[0]] > 0) {
          await checkAndAwardAchievements(userId, check.type, check.data);
        }
      }

    } catch (error) {
      console.error(`Error recalculating achievements for user ${userId}:`, error);
    }
  }
}

module.exports = new AchievementService();
