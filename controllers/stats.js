const { query, transaction } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');
const achievementService = require('../services/achievementService');

/**
 * Statistics controller for game performance tracking
 */

/**
 * Submit match statistics validation
 */
const submitMatchStatsValidation = [
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required'),
  body('score')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Score must be non-negative integer'),
  body('completionTime')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Completion time must be non-negative integer'),
  body('achievements')
    .optional()
    .isArray()
    .withMessage('Achievements must be an array'),
  body('performanceMetrics')
    .optional()
    .isObject()
    .withMessage('Performance metrics must be an object'),
  body('gameEvents')
    .optional()
    .isArray()
    .withMessage('Game events must be an array')
];

/**
 * Submit match statistics
 */
const submitMatchStats = async (req, res) => {
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

    const userId = req.user.id;
    const {
      sessionId,
      score = 0,
      completionTime,
      achievements = [],
      performanceMetrics = {},
      gameEvents = []
    } = req.body;

    // Verify user was in the session
    const sessionCheck = await query(`
      SELECT s.id, s.status, s.game_mode, sp.joined_at
      FROM game_sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE s.id = $1 AND sp.user_id = $2
    `, [sessionId, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'User was not in this session'
        }
      });
    }

    const session = sessionCheck.rows[0];

    // Check if stats already submitted for this session by this user
    const existingStats = await query(`
      SELECT id FROM game_stats
      WHERE session_id = $1 AND player_id = $2
    `, [sessionId, userId]);

    if (existingStats.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Statistics already submitted for this session'
        }
      });
    }

    // Insert match statistics
    const statsResult = await query(`
      INSERT INTO game_stats (
        session_id, player_id, score, completion_time,
        achievements, performance_metrics, game_events
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `, [
      sessionId,
      userId,
      score,
      completionTime,
      JSON.stringify(achievements),
      JSON.stringify(performanceMetrics),
      JSON.stringify(gameEvents)
    ]);

    const statsRecord = statsResult.rows[0];

    // Update player statistics (this will be handled by triggers, but we can also do it here)
    await updatePlayerStats(userId, {
      score,
      completionTime,
      achievements: achievements.length,
      gameMode: session.game_mode
    });

    // Check for achievements based on match completion
    // Determine if this was a win based on score or other criteria
    const isWin = score > 0 && achievements.length > 0; // Simplified win detection
    const matchDuration = completionTime ? Math.ceil(completionTime / 60000) : 0; // Convert to minutes

    await achievementService.onMatchCompleted(userId, {
      won: isWin,
      duration_minutes: matchDuration,
      score: score
    });

    winston.info(`Match stats submitted: User ${userId}, Session ${sessionId}, Score ${score}`);

    res.status(201).json({
      stats_id: statsRecord.id,
      session_id: sessionId,
      score,
      completion_time: completionTime,
      achievements_count: achievements.length,
      submitted_at: statsRecord.created_at
    });

  } catch (err) {
    winston.error('Submit match stats error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to submit match statistics'
      }
    });
  }
};

/**
 * Update player statistics after match
 */
async function updatePlayerStats(userId, matchData) {
  try {
    // Get current player stats
    const currentStats = await query(`
      SELECT
        games_played, games_won, games_lost, total_score,
        total_play_time, best_score, average_completion_time,
        skill_rating, win_streak, current_streak
      FROM player_stats
      WHERE user_id = $1
    `, [userId]);

    let stats = currentStats.rows[0];
    if (!stats) {
      // Create initial stats record
      await query(`
        INSERT INTO player_stats (user_id)
        VALUES ($1)
      `, [userId]);

      stats = {
        games_played: 0,
        games_won: 0,
        games_lost: 0,
        total_score: 0,
        total_play_time: 0,
        best_score: 0,
        average_completion_time: null,
        skill_rating: 1000,
        win_streak: 0,
        current_streak: 0
      };
    }

    // Update stats based on match data
    const newGamesPlayed = stats.games_played + 1;
    const newTotalScore = stats.total_score + matchData.score;
    const newBestScore = Math.max(stats.best_score, matchData.score);

    // Calculate new average completion time
    let newAverageCompletionTime = stats.average_completion_time;
    if (matchData.completionTime) {
      if (stats.average_completion_time) {
        newAverageCompletionTime = Math.round(
          ((stats.average_completion_time * stats.games_played) + matchData.completionTime) / newGamesPlayed
        );
      } else {
        newAverageCompletionTime = matchData.completionTime;
      }
    }

    // Simple win/loss determination (could be enhanced)
    const won = matchData.score > 500; // Simple threshold, could be game-specific
    const newGamesWon = stats.games_won + (won ? 1 : 0);
    const newGamesLost = stats.games_lost + (won ? 0 : 1);

    // Update win streak
    let newWinStreak = stats.win_streak;
    let newCurrentStreak = won ? stats.current_streak + 1 : 0;
    if (newCurrentStreak > newWinStreak) {
      newWinStreak = newCurrentStreak;
    }

    // Update player stats
    await query(`
      UPDATE player_stats
      SET
        games_played = $1,
        games_won = $2,
        games_lost = $3,
        total_score = $4,
        best_score = $5,
        average_completion_time = $6,
        win_streak = $7,
        current_streak = $8,
        last_played = NOW(),
        updated_at = NOW()
      WHERE user_id = $9
    `, [
      newGamesPlayed,
      newGamesWon,
      newGamesLost,
      newTotalScore,
      newBestScore,
      newAverageCompletionTime,
      newWinStreak,
      newCurrentStreak,
      userId
    ]);

    winston.debug(`Player stats updated: User ${userId}, Games: ${newGamesPlayed}, Score: ${newTotalScore}`);

  } catch (err) {
    winston.error('Update player stats error:', err);
    // Don't throw - stats update failure shouldn't break match submission
  }
}

/**
 * Get player statistics
 */
const getPlayerStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.id;

    // Allow users to view their own stats or friends' public stats
    if (userId !== requestingUserId) {
      // Check if they are friends
      const friendshipCheck = await query(`
        SELECT id FROM friends
        WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
          AND friendship_status = 'active'
      `, [requestingUserId, userId]);

      if (friendshipCheck.rows.length === 0) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Can only view stats of friends'
          }
        });
      }
    }

    // Get player stats
    const statsResult = await query(`
      SELECT
        games_played,
        games_won,
        games_lost,
        total_score,
        total_play_time,
        best_score,
        average_completion_time,
        skill_rating,
        win_streak,
        current_streak,
        last_played,
        created_at
      FROM player_stats
      WHERE user_id = $1
    `, [userId]);

    if (statsResult.rows.length === 0) {
      return res.json({
        user_id: userId,
        games_played: 0,
        games_won: 0,
        games_lost: 0,
        total_score: 0,
        win_rate: 0,
        average_score: 0,
        best_score: 0,
        skill_rating: 1000,
        last_played: null
      });
    }

    const stats = statsResult.rows[0];
    const winRate = stats.games_played > 0 ? (stats.games_won / stats.games_played) * 100 : 0;
    const averageScore = stats.games_played > 0 ? stats.total_score / stats.games_played : 0;

    res.json({
      user_id: userId,
      games_played: stats.games_played,
      games_won: stats.games_won,
      games_lost: stats.games_lost,
      total_score: stats.total_score,
      total_play_time: stats.total_play_time,
      win_rate: Math.round(winRate * 100) / 100,
      average_score: Math.round(averageScore * 100) / 100,
      best_score: stats.best_score,
      average_completion_time: stats.average_completion_time,
      skill_rating: stats.skill_rating,
      win_streak: stats.win_streak,
      current_streak: stats.current_streak,
      last_played: stats.last_played,
      created_at: stats.created_at
    });

  } catch (err) {
    winston.error('Get player stats error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get player statistics'
      }
    });
  }
};

/**
 * Get leaderboard
 */
const getLeaderboard = async (req, res) => {
  try {
    const {
      gameMode,
      sortBy = 'total_score',
      limit = 50,
      offset = 0
    } = req.query;

    // Validate sort options
    const validSortOptions = ['total_score', 'games_won', 'win_rate', 'skill_rating', 'best_score'];
    if (!validSortOptions.includes(sortBy)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid sort option'
        }
      });
    }

    let whereClause = '';
    let params = [parseInt(limit), parseInt(offset)];
    let paramIndex = 3;

    if (gameMode) {
      whereClause = `WHERE ps.user_id IN (
        SELECT DISTINCT gs.player_id
        FROM game_stats gs
        JOIN game_sessions s ON gs.session_id = s.id
        WHERE s.game_mode = $${paramIndex}
      )`;
      params.push(gameMode);
      paramIndex++;
    }

    // Build order clause
    let orderClause;
    switch (sortBy) {
      case 'total_score':
        orderClause = 'ps.total_score DESC';
        break;
      case 'games_won':
        orderClause = 'ps.games_won DESC';
        break;
      case 'win_rate':
        orderClause = '(CASE WHEN ps.games_played > 0 THEN ps.games_won::float / ps.games_played ELSE 0 END) DESC';
        break;
      case 'skill_rating':
        orderClause = 'ps.skill_rating DESC';
        break;
      case 'best_score':
        orderClause = 'ps.best_score DESC';
        break;
    }

    // Get leaderboard from player_stats, with fallback for no data
    const leaderboardResult = await query(`
      SELECT
        ps.user_id,
        u.username,
        ps.games_played,
        ps.games_won,
        ps.games_lost,
        ps.total_score,
        ps.best_score,
        ps.skill_rating,
        ps.win_streak,
        CASE WHEN ps.games_played > 0 THEN ROUND((ps.games_won::float / ps.games_played) * 100, 1) ELSE 0 END as win_rate,
        ps.last_played
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      ${whereClause}
      ORDER BY ${orderClause}, ps.games_played DESC
      LIMIT $1 OFFSET $2
    `, params).catch(err => {
      // If query fails, return empty result
      winston.warn('Leaderboard query failed, returning empty result:', err.message);
      return { rows: [] };
    });

    const leaderboard = leaderboardResult.rows.map((row, index) => ({
      rank: parseInt(offset) + index + 1,
      user_id: row.user_id,
      username: row.username,
      games_played: row.games_played,
      games_won: row.games_won,
      games_lost: row.games_lost,
      total_score: row.total_score,
      best_score: row.best_score,
      skill_rating: row.skill_rating,
      win_streak: row.win_streak,
      win_rate: parseFloat(row.win_rate),
      last_played: row.last_played
    }));

    // Get total count
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM player_stats ps
      ${whereClause.replace('ps.user_id IN', 'user_id IN')}
    `, params.slice(2));

    const totalPlayers = parseInt(countResult.rows[0].total);

    res.json({
      leaderboard,
      pagination: {
        total: totalPlayers,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (parseInt(offset) + leaderboard.length) < totalPlayers
      },
      sort_by: sortBy,
      game_mode_filter: gameMode || null,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get leaderboard error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get leaderboard'
      }
    });
  }
};

/**
 * Get recent matches
 */
const getRecentMatches = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const matchesResult = await query(`
      SELECT
        gs.id as stats_id,
        gs.session_id,
        s.game_mode,
        s.status as session_status,
        s.ended_at,
        gs.score,
        gs.completion_time,
        gs.achievements,
        gs.created_at as stats_submitted_at,
        u.username as opponent_username
      FROM game_stats gs
      JOIN game_sessions s ON gs.session_id = s.id
      LEFT JOIN session_players sp ON s.id = sp.session_id AND sp.user_id != $1
      LEFT JOIN users u ON sp.user_id = u.id
      WHERE gs.player_id = $1
        AND s.status IN ('completed', 'abandoned')
      ORDER BY gs.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, parseInt(limit), parseInt(offset)]);

    const matches = matchesResult.rows.map(row => ({
      stats_id: row.stats_id,
      session_id: row.session_id,
      game_mode: row.game_mode,
      session_status: row.session_status,
      ended_at: row.ended_at,
      score: row.score,
      completion_time: row.completion_time,
      achievements: row.achievements,
      submitted_at: row.stats_submitted_at,
      opponent: row.opponent_username
    }));

    res.json({
      recent_matches: matches,
      count: matches.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get recent matches error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get recent matches'
      }
    });
  }
};

module.exports = {
  submitMatchStats,
  getPlayerStats,
  getLeaderboard,
  getRecentMatches,
  submitMatchStatsValidation
};
