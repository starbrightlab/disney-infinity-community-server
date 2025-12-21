const { supabase } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

/**
 * Matchmaking controller for Disney Infinity multiplayer
 */

/**
 * Join matchmaking queue validation
 */
const joinMatchmakingValidation = [
  body('gameMode')
    .isIn(['toybox', 'adventure', 'versus', 'cooperative'])
    .withMessage('Invalid game mode'),
  body('region')
    .optional()
    .isLength({ min: 2, max: 10 })
    .withMessage('Region must be 2-10 characters'),
  body('skillLevel')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Skill level must be 1-10'),
  body('maxPlayers')
    .optional()
    .isInt({ min: 2, max: 4 })
    .withMessage('Max players must be 2-4'),
  body('preferences')
    .optional()
    .isObject()
    .withMessage('Preferences must be an object')
];

/**
 * Join matchmaking queue
 */
const joinMatchmaking = async (req, res) => {
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
      gameMode,
      region = 'global',
      skillLevel = 5,
      maxPlayers = 4,
      preferences = {}
    } = req.body;

    // Check if user is already in matchmaking queue
    const { data: existingQueue, error: queueError } = await supabase
      .from('matchmaking_queue')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (queueError) {
      winston.error('Failed to check existing matchmaking queue:', queueError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to check matchmaking queue'
        }
      });
    }

    if (existingQueue && existingQueue.length > 0) {
      // User already in queue, return current status
      const queueEntry = existingQueue[0];
      const queueTime = Math.floor((Date.now() - new Date(queueEntry.created_at).getTime()) / 1000);

      return res.json({
        status: 'in_queue',
        queue_id: queueEntry.id,
        queue_time_seconds: queueTime,
        estimated_wait: estimateWaitTime(gameMode, region),
        game_mode: gameMode,
        region: region
      });
    }

    // Add user to matchmaking queue
    const { data: queueEntry, error: insertError } = await supabase
      .from('matchmaking_queue')
      .insert([{
        user_id: userId,
        game_mode: gameMode,
        region: region,
        skill_level: skillLevel,
        max_players: maxPlayers,
        preferences: preferences,
        status: 'active'
      }])
      .select('id, created_at')
      .single();

    if (insertError) {
      winston.error('Failed to add user to matchmaking queue:', insertError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to join matchmaking queue'
        }
      });
    }

    // Try to find a match immediately
    const match = await findMatch(userId, gameMode, region, skillLevel, maxPlayers);

    if (match) {
      // Match found! Create session and remove from queue
      const sessionResult = await createMatchSession(match.hostUserId, match.players, gameMode, maxPlayers);

      // Remove all matched players from queue
      const { error: updateError } = await supabase
        .from('matchmaking_queue')
        .update({ status: 'matched' })
        .in('user_id', match.players);

      if (updateError) {
        winston.error('Failed to update matched players:', updateError);
        // Continue anyway, match was found
      }

      winston.info(`Match found for game mode ${gameMode}, session: ${sessionResult.id}`);

      return res.json({
        status: 'matched',
        session_id: sessionResult.id,
        players: match.players.length,
        game_mode: gameMode,
        region: region
      });
    }

    // No immediate match, return queue status
    const estimatedWait = estimateWaitTime(gameMode, region);

    winston.info(`User ${userId} joined matchmaking queue for ${gameMode}`);

    res.json({
      status: 'queued',
      queue_id: queueEntry.id,
      estimated_wait_seconds: estimatedWait,
      game_mode: gameMode,
      region: region,
      skill_level: skillLevel
    });

  } catch (err) {
    winston.error('Join matchmaking error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to join matchmaking'
      }
    });
  }
};

/**
 * Leave matchmaking queue
 */
const leaveMatchmaking = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: result, error: updateError } = await supabase
      .from('matchmaking_queue')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('status', 'active')
      .select('id');

    if (updateError) {
      winston.error('Failed to leave matchmaking queue:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to leave matchmaking queue'
        }
      });
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Not currently in matchmaking queue'
        }
      });
    }

    winston.info(`User ${userId} left matchmaking queue`);

    res.json({
      status: 'left_queue',
      message: 'Successfully left matchmaking queue'
    });

  } catch (err) {
    winston.error('Leave matchmaking error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to leave matchmaking'
      }
    });
  }
};

/**
 * Get matchmaking status
 */
const getMatchmakingStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: result, error: statusError } = await supabase
      .from('matchmaking_queue')
      .select('id, game_mode, region, skill_level, created_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    if (statusError) {
      winston.error('Failed to get matchmaking status:', statusError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get matchmaking status'
        }
      });
    }

    if (!result || result.length === 0) {
      return res.json({
        in_queue: false,
        status: 'not_queued'
      });
    }

    const queueEntry = result[0];
    const queueTime = Math.floor((Date.now() - new Date(queueEntry.created_at).getTime()) / 1000);

    res.json({
      in_queue: true,
      queue_id: queueEntry.id,
      game_mode: queueEntry.game_mode,
      region: queueEntry.region,
      skill_level: queueEntry.skill_level,
      queue_time_seconds: queueTime,
      estimated_wait_seconds: estimateWaitTime(queueEntry.game_mode, queueEntry.region),
      status: 'waiting'
    });

  } catch (err) {
    winston.error('Get matchmaking status error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get matchmaking status'
      }
    });
  }
};

/**
 * Get matchmaking statistics
 */
const getMatchmakingStats = async (req, res) => {
  try {
    // Get queue statistics by game mode
    const { data: queueStats, error: queueError } = await supabase
      .from('matchmaking_queue')
      .select('game_mode, created_at')
      .eq('status', 'active');

    if (queueError) {
      winston.error('Failed to get queue stats:', queueError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get matchmaking statistics'
        }
      });
    }

    // Aggregate queue stats by game mode
    const queueStatsMap = {};
    queueStats.forEach(entry => {
      if (!queueStatsMap[entry.game_mode]) {
        queueStatsMap[entry.game_mode] = { players_in_queue: 0, total_queue_time: 0 };
      }
      queueStatsMap[entry.game_mode].players_in_queue++;
      const queueTime = (Date.now() - new Date(entry.created_at).getTime()) / 1000;
      queueStatsMap[entry.game_mode].total_queue_time += queueTime;
    });

    const processedQueueStats = Object.entries(queueStatsMap).map(([gameMode, stats]) => ({
      game_mode: gameMode,
      players_in_queue: stats.players_in_queue,
      avg_queue_time_seconds: stats.players_in_queue > 0 ? stats.total_queue_time / stats.players_in_queue : 0
    }));

    // Get active sessions
    const { data: activeSessions, error: sessionsError } = await supabase
      .from('game_sessions')
      .select('game_mode, current_players')
      .eq('status', 'active');

    if (sessionsError) {
      winston.error('Failed to get active sessions:', sessionsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get session statistics'
        }
      });
    }

    // Aggregate session stats by game mode
    const sessionStatsMap = {};
    activeSessions.forEach(session => {
      if (!sessionStatsMap[session.game_mode]) {
        sessionStatsMap[session.game_mode] = { active_sessions: 0, total_players: 0 };
      }
      sessionStatsMap[session.game_mode].active_sessions++;
      sessionStatsMap[session.game_mode].total_players += session.current_players;
    });

    const processedActiveSessions = Object.entries(sessionStatsMap).map(([gameMode, stats]) => ({
      game_mode: gameMode,
      active_sessions: stats.active_sessions,
      total_players: stats.total_players
    }));

    const stats = {
      queue: {},
      sessions: {},
      timestamp: new Date().toISOString()
    };

    // Process queue stats
    processedQueueStats.forEach(row => {
      stats.queue[row.game_mode] = {
        players_waiting: parseInt(row.players_in_queue),
        avg_wait_time_seconds: Math.floor(parseFloat(row.avg_queue_time_seconds) || 0)
      };
    });

    // Process session stats
    processedActiveSessions.forEach(row => {
      stats.sessions[row.game_mode] = {
        active_games: parseInt(row.active_sessions),
        total_players: parseInt(row.total_players)
      };
    });

    res.json(stats);

  } catch (err) {
    winston.error('Get matchmaking stats error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get matchmaking statistics'
      }
    });
  }
};

/**
 * Find a match for a user
 * @param {string} userId - User ID looking for match
 * @param {string} gameMode - Game mode
 * @param {string} region - Region
 * @param {number} skillLevel - Skill level
 * @param {number} maxPlayers - Maximum players
 * @returns {Object|null} Match data or null
 */
async function findMatch(userId, gameMode, region, skillLevel, maxPlayers) {
  try {
    // Look for existing sessions that need players
    const { data: availableSessions, error: sessionsError } = await supabase
      .from('game_sessions')
      .select('id, host_user_id, current_players, max_players, player_ids, created_at')
      .eq('status', 'waiting')
      .eq('game_mode', gameMode)
      .eq('max_players', maxPlayers)
      .lt('current_players', maxPlayers)  // Use lt (less than) for comparison
      .eq('region', region)
      .order('created_at', { ascending: true })
      .limit(10);

    if (sessionsError) {
      winston.error('Failed to find available sessions:', sessionsError);
      return null;
    }

    // Try to join an existing session
    for (const session of availableSessions) {
      // Check if user is not already in this session
      if (!session.player_ids.includes(userId)) {
        const newPlayerIds = [...session.player_ids, userId];
        const newPlayerCount = session.current_players + 1;

        // Update session with new player
        const { error: updateError } = await supabase
          .from('game_sessions')
          .update({
            player_ids: newPlayerIds,
            current_players: newPlayerCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);

        if (updateError) {
          winston.error('Failed to update session with new player:', updateError);
          continue; // Try next session
        }

        // If session is now full, start it
        if (newPlayerCount >= session.max_players) {
          const { error: startError } = await supabase
            .from('game_sessions')
            .update({
              status: 'active',
              started_at: new Date().toISOString()
            })
            .eq('id', session.id);

          if (startError) {
            winston.error('Failed to start full session:', startError);
          }
        }

        return {
          sessionId: session.id,
          hostUserId: session.host_user_id,
          players: newPlayerIds
        };
      }
    }

    // No suitable existing session found, look for other players in queue
    const { data: queuedPlayers, error: queueError } = await supabase
      .from('matchmaking_queue')
      .select('user_id, skill_level, created_at')
      .eq('status', 'active')
      .eq('game_mode', gameMode)
      .eq('region', region)
      .eq('max_players', maxPlayers)
      .neq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(maxPlayers - 1);

    if (queueError) {
      winston.error('Failed to find queued players:', queueError);
      return null;
    }

    // Sort by skill level proximity (similar to ABS(skill_level - $5) ASC)
    queuedPlayers.sort((a, b) => {
      const aDiff = Math.abs(a.skill_level - skillLevel);
      const bDiff = Math.abs(b.skill_level - skillLevel);
      if (aDiff !== bDiff) return aDiff - bDiff;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    if (queuedPlayers.length >= maxPlayers - 1) {
      // Enough players for a match! Create new session
      const players = [userId, ...queuedPlayers.rows.map(p => p.user_id)];

      return {
        hostUserId: userId,
        players: players
      };
    }

    // Create a new waiting session if we have at least 2 players (including ourselves)
    if (queuedPlayers.rows.length >= 1) {
      const players = [userId, ...queuedPlayers.rows.slice(0, maxPlayers - 1).map(p => p.user_id)];

      return {
        hostUserId: userId,
        players: players
      };
    }

    return null; // No match found

  } catch (err) {
    winston.error('Find match error:', err);
    return null;
  }
}

/**
 * Create a match session
 * @param {string} hostUserId - Host user ID
 * @param {Array} playerIds - Array of player IDs
 * @param {string} gameMode - Game mode
 * @param {number} maxPlayers - Maximum players
 * @returns {Object} Session data
 */
async function createMatchSession(hostUserId, playerIds, gameMode, maxPlayers) {
  const { data: session, error: sessionError } = await supabase
    .from('game_sessions')
    .insert([{
      host_user_id: hostUserId,
      game_mode: gameMode,
      max_players: maxPlayers,
      current_players: playerIds.length,
      player_ids: playerIds,
      status: 'waiting',
      region: 'global'
    }])
    .select('id, created_at')
    .single();

  if (sessionError) {
    winston.error('Failed to create match session:', sessionError);
    throw sessionError;
  }

  // Create session player records
  const playerInserts = playerIds.map(playerId => ({
    session_id: session.id,
    user_id: playerId,
    player_status: 'joined',
    joined_at: new Date().toISOString()
  }));

  const { error: playersError } = await supabase
    .from('session_players')
    .insert(playerInserts);

  if (playersError) {
    winston.error('Failed to create session player records:', playersError);
    throw playersError;
  }

  return {
    id: session.id,
    created_at: session.created_at,
    players: playerIds.length
  };
}

/**
 * Estimate wait time based on game mode and region
 * @param {string} gameMode - Game mode
 * @param {string} region - Region
 * @returns {number} Estimated wait time in seconds
 */
function estimateWaitTime(gameMode, region) {
  // Simple estimation based on current queue lengths
  // In a real implementation, this would use historical data and ML
  const baseWaitTimes = {
    'toybox': 30,
    'adventure': 60,
    'versus': 45,
    'cooperative': 90
  };

  return baseWaitTimes[gameMode] || 60;
}

module.exports = {
  joinMatchmaking,
  leaveMatchmaking,
  getMatchmakingStatus,
  getMatchmakingStats,
  joinMatchmakingValidation
};
