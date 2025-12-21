const { query, transaction } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

/**
 * Session management controller for Disney Infinity multiplayer
 */

/**
 * Create session validation
 */
const createSessionValidation = [
  body('gameMode')
    .isIn(['toybox', 'adventure', 'versus', 'cooperative'])
    .withMessage('Invalid game mode'),
  body('maxPlayers')
    .optional()
    .isInt({ min: 2, max: 4 })
    .withMessage('Max players must be 2-4'),
  body('region')
    .optional()
    .isLength({ min: 2, max: 10 })
    .withMessage('Region must be 2-10 characters'),
  body('isPrivate')
    .optional()
    .isBoolean()
    .withMessage('isPrivate must be boolean'),
  body('password')
    .optional()
    .isLength({ min: 4, max: 20 })
    .withMessage('Password must be 4-20 characters')
];

/**
 * Join session validation
 */
const joinSessionValidation = [
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required'),
  body('password')
    .optional()
    .isLength({ min: 4, max: 20 })
    .withMessage('Password must be 4-20 characters')
];

/**
 * Create a new game session
 */
const createSession = async (req, res) => {
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

    const hostUserId = req.user.id;
    const {
      gameMode,
      maxPlayers = 4,
      region = 'global',
      isPrivate = false,
      password = null,
      sessionData = {}
    } = req.body;

    // Check if user is already in an active session
    const existingSession = await query(`
      SELECT s.id, sp.player_status
      FROM game_sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE sp.user_id = $1 AND s.status IN ('waiting', 'active')
      ORDER BY s.created_at DESC LIMIT 1
    `, [hostUserId]);

    if (existingSession.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is already in an active session',
          session_id: existingSession.rows[0].id
        }
      });
    }

    // Create the session
    const sessionResult = await query(`
      INSERT INTO game_sessions (
        host_user_id, game_mode, region, max_players, current_players,
        player_ids, status, session_data
      ) VALUES ($1, $2, $3, $4, 1, $5, 'waiting', $6)
      RETURNING id, created_at
    `, [
      hostUserId,
      gameMode,
      region,
      maxPlayers,
      [hostUserId],
      JSON.stringify({
        ...sessionData,
        isPrivate,
        password: isPrivate && password ? password : null
      })
    ]);

    const session = sessionResult.rows[0];

    // Add host as first player
    await query(`
      INSERT INTO session_players (
        session_id, user_id, player_status, joined_at
      ) VALUES ($1, $2, 'ready', NOW())
    `, [session.id, hostUserId]);

    winston.info(`Session created: ${session.id} by user ${hostUserId} for ${gameMode}`);

    res.status(201).json({
      session_id: session.id,
      game_mode: gameMode,
      region: region,
      max_players: maxPlayers,
      current_players: 1,
      status: 'waiting',
      is_private: isPrivate,
      created_at: session.created_at
    });

  } catch (err) {
    winston.error('Create session error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to create session'
      }
    });
  }
};

/**
 * Join an existing game session
 */
const joinSession = async (req, res) => {
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
    const { sessionId, password } = req.body;

    // Get session details
    const sessionResult = await query(`
      SELECT id, host_user_id, game_mode, region, max_players, current_players,
             player_ids, status, session_data
      FROM game_sessions
      WHERE id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    const session = sessionResult.rows[0];

    // Check if session is joinable
    if (!['waiting', 'active'].includes(session.status)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Session is not accepting new players'
        }
      });
    }

    // Check if session is full
    if (session.current_players >= session.max_players) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Session is full'
        }
      });
    }

    // Check if user is already in this session
    if (session.player_ids.includes(userId)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is already in this session'
        }
      });
    }

    // Check if user is in another active session
    const userSessionCheck = await query(`
      SELECT s.id
      FROM game_sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE sp.user_id = $1 AND s.status IN ('waiting', 'active') AND s.id != $2
    `, [userId, sessionId]);

    if (userSessionCheck.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is already in another session',
          current_session_id: userSessionCheck.rows[0].id
        }
      });
    }

    // Check password if session is private
    const sessionData = session.session_data || {};
    if (sessionData.isPrivate && sessionData.password) {
      if (!password || password !== sessionData.password) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Incorrect password for private session'
          }
        });
      }
    }

    // Add player to session
    const newPlayerIds = [...session.player_ids, userId];
    const newPlayerCount = session.current_players + 1;

    await transaction(async (client) => {
      // Update session
      await client.query(`
        UPDATE game_sessions
        SET player_ids = $1, current_players = $2, updated_at = NOW()
        WHERE id = $3
      `, [newPlayerIds, newPlayerCount, sessionId]);

      // If session is now full, start it
      if (newPlayerCount >= session.max_players) {
        await client.query(`
          UPDATE game_sessions
          SET status = 'active', started_at = NOW()
          WHERE id = $1
        `, [sessionId]);
      }

      // Add player record
      await client.query(`
        INSERT INTO session_players (
          session_id, user_id, player_status, joined_at
        ) VALUES ($1, $2, 'joined', NOW())
      `, [sessionId, userId]);
    });

    winston.info(`User ${userId} joined session ${sessionId}`);

    res.json({
      session_id: sessionId,
      game_mode: session.game_mode,
      region: session.region,
      status: newPlayerCount >= session.max_players ? 'active' : 'waiting',
      current_players: newPlayerCount,
      max_players: session.max_players
    });

  } catch (err) {
    winston.error('Join session error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to join session'
      }
    });
  }
};

/**
 * Leave a game session
 */
const leaveSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    // Get current session info
    const sessionResult = await query(`
      SELECT id, host_user_id, player_ids, current_players, status
      FROM game_sessions
      WHERE id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    const session = sessionResult.rows[0];

    // Check if user is in this session
    if (!session.player_ids.includes(userId)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is not in this session'
        }
      });
    }

    const newPlayerIds = session.player_ids.filter(id => id !== userId);
    const newPlayerCount = session.current_players - 1;

    await transaction(async (client) => {
      if (newPlayerCount === 0) {
        // Last player leaving, end the session
        await client.query(`
          UPDATE game_sessions
          SET status = 'completed', ended_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [sessionId]);
      } else {
        // Update session player list
        await client.query(`
          UPDATE game_sessions
          SET player_ids = $1, current_players = $2, updated_at = NOW()
          WHERE id = $3
        `, [newPlayerIds, newPlayerCount, sessionId]);

        // If host is leaving, assign new host
        if (session.host_user_id === userId && newPlayerCount > 0) {
          await client.query(`
            UPDATE game_sessions
            SET host_user_id = $1
            WHERE id = $2
          `, [newPlayerIds[0], sessionId]);
        }
      }

      // Update player status
      await client.query(`
        UPDATE session_players
        SET player_status = 'left', disconnected_at = NOW()
        WHERE session_id = $1 AND user_id = $2
      `, [sessionId, userId]);
    });

    winston.info(`User ${userId} left session ${sessionId}`);

    res.json({
      session_id: sessionId,
      status: newPlayerCount === 0 ? 'completed' : 'waiting',
      remaining_players: newPlayerCount
    });

  } catch (err) {
    winston.error('Leave session error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to leave session'
      }
    });
  }
};

/**
 * Get session details
 */
const getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user ? req.user.id : null;

    const sessionResult = await query(`
      SELECT
        s.id, s.host_user_id, s.game_mode, s.region, s.max_players,
        s.current_players, s.player_ids, s.status, s.session_data,
        s.created_at, s.started_at, s.ended_at,
        u.username as host_username
      FROM game_sessions s
      JOIN users u ON s.host_user_id = u.id
      WHERE s.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    const session = sessionResult.rows[0];

    // Get player details
    const playersResult = await query(`
      SELECT
        sp.user_id, sp.player_status, sp.joined_at, sp.disconnected_at,
        u.username, u.profile_data
      FROM session_players sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.session_id = $1
      ORDER BY sp.joined_at ASC
    `, [sessionId]);

    const players = playersResult.rows.map(player => ({
      user_id: player.user_id,
      username: player.username,
      status: player.player_status,
      joined_at: player.joined_at,
      disconnected_at: player.disconnected_at,
      profile_data: player.profile_data
    }));

    const sessionData = session.session_data || {};
    const isPrivate = sessionData.isPrivate || false;

    res.json({
      session_id: session.id,
      host: {
        user_id: session.host_user_id,
        username: session.host_username
      },
      game_mode: session.game_mode,
      region: session.region,
      max_players: session.max_players,
      current_players: session.current_players,
      status: session.status,
      players: players,
      is_private: isPrivate,
      can_join: !isPrivate && session.status === 'waiting' && session.current_players < session.max_players && (userId ? !session.player_ids.includes(userId) : true),
      created_at: session.created_at,
      started_at: session.started_at,
      ended_at: session.ended_at
    });

  } catch (err) {
    winston.error('Get session error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get session details'
      }
    });
  }
};

/**
 * List available sessions
 */
const listSessions = async (req, res) => {
  try {
    const {
      gameMode,
      region = 'global',
      status = 'waiting',
      limit = 20,
      offset = 0
    } = req.query;

    let whereConditions = ['s.status = $1'];
    let params = [status];
    let paramIndex = 2;

    if (gameMode) {
      whereConditions.push(`s.game_mode = $${paramIndex}`);
      params.push(gameMode);
      paramIndex++;
    }

    if (region && region !== 'global') {
      whereConditions.push(`s.region = $${paramIndex}`);
      params.push(region);
      paramIndex++;
    }

    // Exclude private sessions unless user is authenticated and invited
    whereConditions.push(`NOT (s.session_data->>'isPrivate')::boolean`);

    const whereClause = whereConditions.join(' AND ');

    const sessionsResult = await query(`
      SELECT
        s.id, s.host_user_id, s.game_mode, s.region, s.max_players,
        s.current_players, s.status, s.created_at,
        u.username as host_username,
        s.session_data
      FROM game_sessions s
      JOIN users u ON s.host_user_id = u.id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const sessions = sessionsResult.rows.map(session => ({
      session_id: session.id,
      host: {
        user_id: session.host_user_id,
        username: session.host_username
      },
      game_mode: session.game_mode,
      region: session.region,
      max_players: session.max_players,
      current_players: session.current_players,
      status: session.status,
      created_at: session.created_at
    }));

    res.json({
      sessions: sessions,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: sessions.length === parseInt(limit)
      }
    });

  } catch (err) {
    winston.error('List sessions error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to list sessions'
      }
    });
  }
};

/**
 * Update session status (host only)
 */
const updateSessionStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { status, sessionData } = req.body;

    // Verify user is host
    const sessionResult = await query(`
      SELECT host_user_id, status as current_status
      FROM game_sessions
      WHERE id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    const session = sessionResult.rows[0];

    if (session.host_user_id !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only session host can update status'
        }
      });
    }

    // Validate status transition
    const validStatuses = ['waiting', 'active', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid status'
        }
      });
    }

    const updateData = {
      status: status,
      updated_at: new Date()
    };

    if (status === 'active' && session.current_status === 'waiting') {
      updateData.started_at = new Date();
    } else if (['completed', 'cancelled'].includes(status)) {
      updateData.ended_at = new Date();
    }

    if (sessionData) {
      updateData.session_data = sessionData;
    }

    await query(`
      UPDATE game_sessions
      SET status = $1, updated_at = $2, started_at = $3, ended_at = $4, session_data = session_data || $5
      WHERE id = $6
    `, [
      updateData.status,
      updateData.updated_at,
      updateData.started_at || null,
      updateData.ended_at || null,
      JSON.stringify(sessionData || {}),
      sessionId
    ]);

    winston.info(`Session ${sessionId} status updated to ${status} by host ${userId}`);

    res.json({
      session_id: sessionId,
      status: status,
      updated_at: updateData.updated_at
    });

  } catch (err) {
    winston.error('Update session status error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update session status'
      }
    });
  }
};

module.exports = {
  createSession,
  joinSession,
  leaveSession,
  getSession,
  listSessions,
  updateSessionStatus,
  createSessionValidation,
  joinSessionValidation
};
