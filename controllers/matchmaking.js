const { query, transaction } = require('../config/database');
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
    const existingQueue = await query(
      `SELECT id, created_at FROM matchmaking_queue
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    if (existingQueue.rows.length > 0) {
      // User already in queue, return current status
      const queueEntry = existingQueue.rows[0];
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
    const result = await query(
      `INSERT INTO matchmaking_queue (
        user_id, game_mode, region, skill_level, max_players, preferences, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING id, created_at`,
      [userId, gameMode, region, skillLevel, maxPlayers, JSON.stringify(preferences)]
    );

    const queueEntry = result.rows[0];

    // Try to find a match immediately
    const match = await findMatch(userId, gameMode, region, skillLevel, maxPlayers);

    if (match) {
      // Match found! Create session and remove from queue
      const sessionResult = await createMatchSession(match.hostUserId, match.players, gameMode, maxPlayers);

      // Remove all matched players from queue
      await query(
        'UPDATE matchmaking_queue SET status = \'matched\' WHERE user_id = ANY($1)',
        [match.players]
      );

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

    const result = await query(
      `UPDATE matchmaking_queue
       SET status = 'cancelled', updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'
       RETURNING id`,
      [userId]
    );

    if (result.rows.length === 0) {
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

    const result = await query(
      `SELECT id, game_mode, region, skill_level, created_at, status
       FROM matchmaking_queue
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        in_queue: false,
        status: 'not_queued'
      });
    }

    const queueEntry = result.rows[0];
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
    const queueStats = await query(`
      SELECT
        game_mode,
        COUNT(*) as players_in_queue,
        AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_queue_time_seconds
      FROM matchmaking_queue
      WHERE status = 'active'
      GROUP BY game_mode
    `);

    // Get active sessions
    const activeSessions = await query(`
      SELECT
        game_mode,
        COUNT(*) as active_sessions,
        SUM(current_players) as total_players
      FROM game_sessions
      WHERE status = 'active'
      GROUP BY game_mode
    `);

    const stats = {
      queue: {},
      sessions: {},
      timestamp: new Date().toISOString()
    };

    // Process queue stats
    queueStats.rows.forEach(row => {
      stats.queue[row.game_mode] = {
        players_waiting: parseInt(row.players_in_queue),
        avg_wait_time_seconds: Math.floor(parseFloat(row.avg_queue_time_seconds) || 0)
      };
    });

    // Process session stats
    activeSessions.rows.forEach(row => {
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
    const availableSessions = await query(`
      SELECT
        gs.id,
        gs.host_user_id,
        gs.current_players,
        gs.max_players,
        gs.player_ids,
        gs.created_at
      FROM game_sessions gs
      WHERE gs.status = 'waiting'
        AND gs.game_mode = $1
        AND gs.max_players = $2
        AND gs.current_players < gs.max_players
        AND gs.region = $3
      ORDER BY gs.created_at ASC
      LIMIT 10
    `, [gameMode, maxPlayers, region]);

    // Try to join an existing session
    for (const session of availableSessions.rows) {
      // Check if user is not already in this session
      if (!session.player_ids.includes(userId)) {
        const newPlayerIds = [...session.player_ids, userId];
        const newPlayerCount = session.current_players + 1;

        // Update session with new player
        await query(`
          UPDATE game_sessions
          SET player_ids = $1, current_players = $2, updated_at = NOW()
          WHERE id = $3
        `, [newPlayerIds, newPlayerCount, session.id]);

        // If session is now full, start it
        if (newPlayerCount >= session.max_players) {
          await query(`
            UPDATE game_sessions
            SET status = 'active', started_at = NOW()
            WHERE id = $1
          `, [session.id]);
        }

        return {
          sessionId: session.id,
          hostUserId: session.host_user_id,
          players: newPlayerIds
        };
      }
    }

    // No suitable existing session found, look for other players in queue
    const queuedPlayers = await query(`
      SELECT user_id, skill_level, created_at
      FROM matchmaking_queue
      WHERE status = 'active'
        AND game_mode = $1
        AND region = $2
        AND max_players = $3
        AND user_id != $4
      ORDER BY
        ABS(skill_level - $5) ASC,  -- Prefer similar skill levels
        created_at ASC              -- Then by queue time
      LIMIT $6
    `, [gameMode, region, maxPlayers, userId, skillLevel, maxPlayers - 1]);

    if (queuedPlayers.rows.length >= maxPlayers - 1) {
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
  const sessionResult = await query(`
    INSERT INTO game_sessions (
      host_user_id, game_mode, max_players, current_players, player_ids, status, region
    ) VALUES ($1, $2, $3, $4, $5, 'waiting', 'global')
    RETURNING id, created_at
  `, [hostUserId, gameMode, maxPlayers, playerIds.length, playerIds]);

  const session = sessionResult.rows[0];

  // Create session player records
  for (const playerId of playerIds) {
    await query(`
      INSERT INTO session_players (session_id, user_id, player_status, joined_at)
      VALUES ($1, $2, 'joined', NOW())
    `, [session.id, playerId]);
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
