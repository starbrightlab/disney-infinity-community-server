/**
 * Analytics Controller
 * Provides advanced player insights and analytics
 */

const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Get player analytics
 */
const getPlayerAnalytics = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.params.userId || req.user.id;
      const { period = '30d', detailed = false } = req.query;

      // Check privacy settings if viewing another user's analytics
      if (userId !== req.user.id) {
        const privacyQuery = `
          SELECT profile_data->'privacy_settings'->>'stats_visibility' as stats_visibility
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
        if (privacy.stats_visibility === 'private') {
          return res.status(403).json({
            error: {
              code: 'ANALYTICS_PRIVATE',
              message: 'This user\'s analytics are private'
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
                code: 'ANALYTICS_FRIENDS_ONLY',
                message: 'This user\'s analytics are only visible to friends'
              }
            });
          }
        }
      }

      // Parse period
      const days = parsePeriod(period);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get comprehensive analytics data
      const analyticsQuery = `
        WITH analytics_data AS (
          SELECT
            date,
            play_time_minutes,
            matches_played,
            matches_won,
            toyboxes_created,
            toyboxes_downloaded,
            friends_added,
            achievements_unlocked,
            characters_used,
            game_modes_played
          FROM profile_analytics
          WHERE user_id = $1 AND date >= $2
          ORDER BY date ASC
        ),
        summary_stats AS (
          SELECT
            SUM(play_time_minutes) as total_play_time,
            SUM(matches_played) as total_matches,
            SUM(matches_won) as total_wins,
            SUM(toyboxes_created) as total_toyboxes_created,
            SUM(toyboxes_downloaded) as total_toyboxes_downloaded,
            SUM(friends_added) as total_friends_added,
            SUM(achievements_unlocked) as total_achievements,
            AVG(play_time_minutes) as avg_daily_play_time,
            MAX(play_time_minutes) as max_daily_play_time,
            COUNT(*) as active_days
          FROM profile_analytics
          WHERE user_id = $1 AND date >= $2
        ),
        character_usage AS (
          SELECT
            json_object_agg(
              key,
              value
            ) as character_stats
          FROM (
            SELECT
              key,
              SUM((value)::int) as value
            FROM profile_analytics pa,
            jsonb_object_keys(pa.characters_used) as key,
            jsonb_extract_path(pa.characters_used, key) as value
            WHERE pa.user_id = $1 AND pa.date >= $2
            GROUP BY key
            ORDER BY value DESC
            LIMIT 10
          ) as char_stats
        ),
        game_mode_usage AS (
          SELECT
            json_object_agg(
              key,
              value
            ) as game_mode_stats
          FROM (
            SELECT
              key,
              SUM((value)::int) as value
            FROM profile_analytics pa,
            jsonb_object_keys(pa.game_modes_played) as key,
            jsonb_extract_path(pa.game_modes_played, key) as value
            WHERE pa.user_id = $1 AND pa.date >= $2
            GROUP BY key
            ORDER BY value DESC
            LIMIT 5
          ) as game_stats
        )
        SELECT
          ad.*,
          ss.*,
          cu.character_stats,
          gmu.game_mode_stats
        FROM analytics_data ad
        CROSS JOIN summary_stats ss
        CROSS JOIN character_usage cu
        CROSS JOIN game_mode_usage gmu
      `;

      const result = await pool.query(analyticsQuery, [userId, startDate.toISOString().split('T')[0]]);

      if (result.rows.length === 0) {
        return res.json({
          analytics: {
            period: { days, start_date: startDate.toISOString().split('T')[0] },
            summary: {
              total_play_time: 0,
              total_matches: 0,
              total_wins: 0,
              win_rate: 0,
              total_toyboxes_created: 0,
              total_toyboxes_downloaded: 0,
              total_friends_added: 0,
              total_achievements: 0,
              active_days: 0,
              avg_daily_play_time: 0
            },
            daily_data: [],
            character_usage: {},
            game_mode_usage: {},
            trends: {}
          }
        });
      }

      const row = result.rows[0];
      const dailyData = result.rows.map(r => ({
        date: r.date,
        play_time_minutes: parseInt(r.play_time_minutes),
        matches_played: parseInt(r.matches_played),
        matches_won: parseInt(r.matches_won),
        toyboxes_created: parseInt(r.toyboxes_created),
        toyboxes_downloaded: parseInt(r.toyboxes_downloaded),
        friends_added: parseInt(r.friends_added),
        achievements_unlocked: parseInt(r.achievements_unlocked)
      }));

      // Calculate trends
      const trends = calculateTrends(dailyData);

      // Calculate win rate
      const totalMatches = parseInt(row.total_matches);
      const totalWins = parseInt(row.total_wins);
      const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100 * 100) / 100 : 0;

      const analytics = {
        period: {
          days,
          start_date: startDate.toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0]
        },
        summary: {
          total_play_time: parseInt(row.total_play_time),
          total_matches: totalMatches,
          total_wins: totalWins,
          win_rate: winRate,
          total_toyboxes_created: parseInt(row.total_toyboxes_created),
          total_toyboxes_downloaded: parseInt(row.total_toyboxes_downloaded),
          total_friends_added: parseInt(row.total_friends_added),
          total_achievements: parseInt(row.total_achievements),
          active_days: parseInt(row.active_days),
          avg_daily_play_time: Math.round(parseFloat(row.avg_daily_play_time) * 100) / 100,
          max_daily_play_time: parseInt(row.max_daily_play_time)
        },
        daily_data: detailed ? dailyData : dailyData.slice(-7), // Last 7 days unless detailed
        character_usage: row.character_stats || {},
        game_mode_usage: row.game_mode_stats || {},
        trends
      };

      res.json({ analytics });
    } catch (error) {
      console.error('Error getting player analytics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve analytics'
        }
      });
    }
  }
];

/**
 * Get server-wide analytics (admin only)
 */
const getServerAnalytics = [
  authenticateToken,
  async (req, res) => {
    try {
      // Check if user is admin
      if (!req.user.is_admin) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Admin access required'
          }
        });
      }

      const { period = '30d' } = req.query;
      const days = parsePeriod(period);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const serverQuery = `
        WITH server_stats AS (
          SELECT
            COUNT(DISTINCT pa.user_id) as active_users,
            SUM(pa.play_time_minutes) as total_play_time,
            SUM(pa.matches_played) as total_matches,
            SUM(pa.matches_won) as total_wins,
            SUM(pa.toyboxes_created) as total_toyboxes_created,
            SUM(pa.toyboxes_downloaded) as total_toyboxes_downloaded,
            SUM(pa.friends_added) as total_friends_added,
            SUM(pa.achievements_unlocked) as total_achievements_unlocked,
            AVG(pa.play_time_minutes) as avg_session_length,
            COUNT(*) as total_sessions
          FROM profile_analytics pa
          WHERE pa.date >= $1
        ),
        user_growth AS (
          SELECT
            DATE_TRUNC('week', created_at) as week,
            COUNT(*) as new_users
          FROM users
          WHERE created_at >= $1
          GROUP BY DATE_TRUNC('week', created_at)
          ORDER BY week
        ),
        top_characters AS (
          SELECT
            character_id,
            SUM(usage_count) as total_usage
          FROM (
            SELECT
              (jsonb_object_keys(characters_used))::int as character_id,
              (characters_used->>jsonb_object_keys(characters_used))::int as usage_count
            FROM profile_analytics
            WHERE date >= $1
          ) as char_usage
          GROUP BY character_id
          ORDER BY total_usage DESC
          LIMIT 10
        )
        SELECT
          ss.*,
          json_agg(ug.*) as user_growth,
          json_agg(tc.*) as top_characters
        FROM server_stats ss
        CROSS JOIN (
          SELECT json_agg(user_growth.*) as user_growth FROM user_growth
        ) ug
        CROSS JOIN (
          SELECT json_agg(top_characters.*) as top_characters FROM top_characters
        ) tc
        GROUP BY ss.active_users, ss.total_play_time, ss.total_matches, ss.total_wins,
                 ss.total_toyboxes_created, ss.total_toyboxes_downloaded, ss.total_friends_added,
                 ss.total_achievements_unlocked, ss.avg_session_length, ss.total_sessions,
                 ug.user_growth, tc.top_characters
      `;

      const result = await pool.query(serverQuery, [startDate.toISOString().split('T')[0]]);

      if (result.rows.length === 0) {
        return res.json({
          server_analytics: {
            period: { days, start_date: startDate.toISOString().split('T')[0] },
            summary: {
              active_users: 0,
              total_play_time: 0,
              total_matches: 0,
              total_wins: 0,
              total_toyboxes_created: 0,
              total_toyboxes_downloaded: 0,
              total_friends_added: 0,
              total_achievements_unlocked: 0,
              avg_session_length: 0,
              total_sessions: 0
            },
            user_growth: [],
            top_characters: []
          }
        });
      }

      const row = result.rows[0];

      res.json({
        server_analytics: {
          period: {
            days,
            start_date: startDate.toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0]
          },
          summary: {
            active_users: parseInt(row.active_users),
            total_play_time: parseInt(row.total_play_time),
            total_matches: parseInt(row.total_matches),
            total_wins: parseInt(row.total_wins),
            win_rate: row.total_matches > 0 ? Math.round((row.total_wins / row.total_matches) * 100 * 100) / 100 : 0,
            total_toyboxes_created: parseInt(row.total_toyboxes_created),
            total_toyboxes_downloaded: parseInt(row.total_toyboxes_downloaded),
            total_friends_added: parseInt(row.total_friends_added),
            total_achievements_unlocked: parseInt(row.total_achievements_unlocked),
            avg_session_length: Math.round(parseFloat(row.avg_session_length) * 100) / 100,
            total_sessions: parseInt(row.total_sessions)
          },
          user_growth: row.user_growth || [],
          top_characters: row.top_characters || []
        }
      });
    } catch (error) {
      console.error('Error getting server analytics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve server analytics'
        }
      });
    }
  }
];

/**
 * Get performance trends
 */
const getPerformanceTrends = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { metric = 'win_rate', period = '90d' } = req.query;

      const days = parsePeriod(period);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      let query;
      switch (metric) {
        case 'win_rate':
          query = `
            SELECT
              date,
              CASE WHEN matches_played > 0
                THEN ROUND((matches_won::decimal / matches_played) * 100, 2)
                ELSE 0 END as value,
              matches_played,
              matches_won
            FROM profile_analytics
            WHERE user_id = $1 AND date >= $2 AND matches_played > 0
            ORDER BY date ASC
          `;
          break;
        case 'play_time':
          query = `
            SELECT
              date,
              play_time_minutes as value,
              play_time_minutes,
              NULL as secondary_value
            FROM profile_analytics
            WHERE user_id = $1 AND date >= $2
            ORDER BY date ASC
          `;
          break;
        case 'toybox_creation':
          query = `
            SELECT
              date,
              toyboxes_created as value,
              toyboxes_created,
              toyboxes_downloaded as secondary_value
            FROM profile_analytics
            WHERE user_id = $1 AND date >= $2
            ORDER BY date ASC
          `;
          break;
        default:
          return res.status(400).json({
            error: {
              code: 'INVALID_METRIC',
              message: 'Invalid metric. Use: win_rate, play_time, toybox_creation'
            }
          });
      }

      const result = await pool.query(query, [userId, startDate.toISOString().split('T')[0]]);

      const trends = calculateDetailedTrends(result.rows, metric);

      res.json({
        trends: {
          metric,
          period: { days, start_date: startDate.toISOString().split('T')[0] },
          data: result.rows,
          analysis: trends
        }
      });
    } catch (error) {
      console.error('Error getting performance trends:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve performance trends'
        }
      });
    }
  }
];

/**
 * Parse period string to days
 */
function parsePeriod(period) {
  const match = period.match(/^(\d+)([dwmy])$/);
  if (!match) return 30; // Default to 30 days

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'd': return value;
    case 'w': return value * 7;
    case 'm': return value * 30;
    case 'y': return value * 365;
    default: return 30;
  }
}

/**
 * Calculate trends from daily data
 */
function calculateTrends(dailyData) {
  if (dailyData.length < 7) {
    return { trend: 'insufficient_data', change_percent: 0 };
  }

  const recent = dailyData.slice(-7);
  const previous = dailyData.slice(-14, -7);

  const recentAvg = recent.reduce((sum, d) => sum + d.play_time_minutes, 0) / recent.length;
  const previousAvg = previous.reduce((sum, d) => sum + d.play_time_minutes, 0) / previous.length;

  const changePercent = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

  let trend = 'stable';
  if (changePercent > 10) trend = 'increasing';
  else if (changePercent < -10) trend = 'decreasing';

  return {
    trend,
    change_percent: Math.round(changePercent * 100) / 100,
    recent_avg: Math.round(recentAvg * 100) / 100,
    previous_avg: Math.round(previousAvg * 100) / 100
  };
}

/**
 * Calculate detailed trends with more analysis
 */
function calculateDetailedTrends(data, metric) {
  if (data.length < 2) {
    return { trend: 'insufficient_data', analysis: {} };
  }

  const values = data.map(d => parseFloat(d.value));
  const recent = values.slice(-7);
  const previous = values.slice(-14, -7);

  const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const previousAvg = previous.length > 0 ? previous.reduce((sum, v) => sum + v, 0) / previous.length : recentAvg;

  const changePercent = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

  // Calculate volatility (standard deviation)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const volatility = Math.sqrt(variance);

  // Find best and worst periods
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const maxIndex = values.indexOf(maxValue);
  const minIndex = values.indexOf(minValue);

  let trend = 'stable';
  if (changePercent > 15) trend = 'strong_increase';
  else if (changePercent > 5) trend = 'moderate_increase';
  else if (changePercent < -15) trend = 'strong_decrease';
  else if (changePercent < -5) trend = 'moderate_decrease';

  return {
    trend,
    change_percent: Math.round(changePercent * 100) / 100,
    volatility: Math.round(volatility * 100) / 100,
    recent_average: Math.round(recentAvg * 100) / 100,
    overall_average: Math.round(mean * 100) / 100,
    best_performance: {
      value: maxValue,
      date: data[maxIndex].date
    },
    worst_performance: {
      value: minValue,
      date: data[minIndex].date
    },
    consistency_rating: volatility < mean * 0.2 ? 'high' : volatility < mean * 0.5 ? 'medium' : 'low'
  };
}

module.exports = {
  getPlayerAnalytics,
  getServerAnalytics,
  getPerformanceTrends
};
