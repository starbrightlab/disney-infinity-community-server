const { supabase } = require('../config/database');
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
    const { data: sessionData, error: sessionError } = await supabase
      .from('session_players')
      .select(`
        game_sessions!inner (
          id,
          status,
          game_mode
        ),
        joined_at
      `)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (sessionError || !sessionData) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'User was not in this session'
        }
      });
    }

    const session = {
      id: sessionData.game_sessions.id,
      status: sessionData.game_sessions.status,
      game_mode: sessionData.game_sessions.game_mode,
      joined_at: sessionData.joined_at
    };

    // Check if stats already submitted for this session by this user
    const { data: existingStats, error: statsError } = await supabase
      .from('game_stats')
      .select('id')
      .eq('session_id', sessionId)
      .eq('player_id', userId);

    if (statsError) {
      winston.error('Failed to check existing stats:', statsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to check existing statistics'
        }
      });
    }

    if (existingStats && existingStats.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Statistics already submitted for this session'
        }
      });
    }

    // Insert match statistics
    const { data: statsRecord, error: insertError } = await supabase
      .from('game_stats')
      .insert([{
        session_id: sessionId,
        player_id: userId,
        score: score,
        completion_time: completionTime,
        achievements: achievements,
        performance_metrics: performanceMetrics,
        game_events: gameEvents
      }])
      .select('id, created_at')
      .single();

    if (insertError) {
      winston.error('Failed to insert game stats:', insertError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to submit game statistics'
        }
      });
    }

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
    const { data: currentStats, error: statsError } = await supabase
      .from('player_stats')
      .select(`
        games_played, games_won, games_lost, total_score,
        total_play_time, best_score, average_completion_time,
        skill_rating, win_streak, current_streak
      `)
      .eq('user_id', userId)
      .single();

    let stats = currentStats;
    if (statsError || !stats) {
      // Create initial stats record
      const { error: insertError } = await supabase
        .from('player_stats')
        .insert([{
          user_id: userId,
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
        }]);

      if (insertError && insertError.code !== '23505') { // Ignore duplicate key error
        winston.error('Failed to create initial player stats:', insertError);
        throw insertError;
      }

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
    const { error: updateError } = await supabase
      .from('player_stats')
      .update({
        games_played: newGamesPlayed,
        games_won: newGamesWon,
        games_lost: newGamesLost,
        total_score: newTotalScore,
        best_score: newBestScore,
        average_completion_time: newAverageCompletionTime,
        win_streak: newWinStreak,
        current_streak: newCurrentStreak,
        last_played: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      winston.error('Failed to update player stats:', updateError);
      throw updateError;
    }

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
      const { data: friendshipCheck, error: friendError } = await supabase
        .from('friends')
        .select('id')
        .or(`and(user_id.eq.${requestingUserId},friend_id.eq.${userId}),and(user_id.eq.${userId},friend_id.eq.${requestingUserId})`)
        .eq('friendship_status', 'active');

      if (friendError || !friendshipCheck || friendshipCheck.length === 0) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Can only view stats of friends'
          }
        });
      }
    }

    // Get player stats
    const { data: playerStats, error: statsError } = await supabase
      .from('player_stats')
      .select(`
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
      `)
      .eq('user_id', userId)
      .single();

    if (statsError || !playerStats) {
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

    const stats = playerStats;
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
    try {
      let query = supabase
        .from('player_stats')
        .select(`
          user_id,
          users!inner(username),
          games_played,
          games_won,
          games_lost,
          total_score,
          best_score,
          skill_rating,
          win_streak,
          last_played
        `);

      // Apply filters
      if (gameMode && gameMode !== 'all') {
        // Note: This assumes we might add game_mode filtering in the future
        // For now, we'll skip this filter since player_stats doesn't have game_mode
      }

      if (minGamesPlayed > 0) {
        query = query.gte('games_played', minGamesPlayed);
      }

      // Apply sorting
      let orderBy = 'games_played';
      let ascending = false;

      switch (sortBy) {
        case 'total_score':
          orderBy = 'total_score';
          break;
        case 'games_won':
          orderBy = 'games_won';
          break;
        case 'skill_rating':
          orderBy = 'skill_rating';
          break;
        case 'best_score':
          orderBy = 'best_score';
          break;
        case 'win_rate':
          // For win rate, we'll need to calculate it client-side since Supabase doesn't support complex expressions easily
          break;
      }

      query = query.order(orderBy, { ascending }).order('games_played', { ascending: false });

      const { data: leaderboardData, error: leaderboardError } = await query
        .range(offset, offset + limit - 1);

      if (leaderboardError) {
        throw leaderboardError;
      }

      // Calculate win rates and format data
      const leaderboard = leaderboardData.map(player => ({
        user_id: player.user_id,
        username: player.users.username,
        games_played: player.games_played,
        games_won: player.games_won,
        games_lost: player.games_lost,
        total_score: player.total_score,
        best_score: player.best_score,
        skill_rating: player.skill_rating,
        win_streak: player.win_streak,
        win_rate: player.games_played > 0 ? Math.round((player.games_won / player.games_played) * 1000) / 10 : 0,
        last_played: player.last_played
      }));

      // Sort by win rate if that's the selected sort
      if (sortBy === 'win_rate') {
        leaderboard.sort((a, b) => b.win_rate - a.win_rate || b.games_played - a.games_played);
      }

      var leaderboardResult = { rows: leaderboard };
    } catch (err) {
      // If query fails, return empty result
      winston.warn('Leaderboard query failed, returning empty result:', err.message);
      var leaderboardResult = { rows: [] };
    }

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
    // Get total count with same filters
    let countQuery = supabase
      .from('player_stats')
      .select('*', { count: 'exact', head: true });

    if (minGamesPlayed > 0) {
      countQuery = countQuery.gte('games_played', minGamesPlayed);
    }

    const { count: totalPlayers, error: countError } = await countQuery;

    if (countError) {
      winston.error('Failed to count leaderboard players:', countError);
      throw countError;
    }

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

    const { data: matchesData, error: matchesError } = await supabase
      .from('game_stats')
      .select(`
        id,
        session_id,
        score,
        completion_time,
        achievements,
        created_at,
        game_sessions!inner (
          game_mode,
          status,
          ended_at
        ),
        session_players!left (
          users!left (
            username
          )
        )
      `)
      .eq('player_id', userId)
      .in('game_sessions.status', ['completed', 'abandoned'])
      .neq('session_players.user_id', userId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (matchesError) {
      winston.error('Failed to get recent matches:', matchesError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get recent matches'
        }
      });
    }

    const matches = matchesData.map(row => ({
      stats_id: row.id,
      session_id: row.session_id,
      game_mode: row.game_sessions.game_mode,
      session_status: row.game_sessions.status,
      ended_at: row.game_sessions.ended_at,
      score: row.score,
      completion_time: row.completion_time,
      achievements: row.achievements,
      submitted_at: row.created_at,
      opponent: row.session_players?.[0]?.users?.username || null
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
