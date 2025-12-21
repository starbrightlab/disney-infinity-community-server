const { query } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');
const { updatePresenceStatus, sendNotificationToUser } = require('../socket');

/**
 * Presence controller for player status tracking
 */

/**
 * Update presence validation
 */
const updatePresenceValidation = [
  body('status')
    .isIn(['online', 'offline', 'away', 'in_game', 'in_menu'])
    .withMessage('Invalid status'),
  body('currentGameMode')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Game mode must be 1-100 characters'),
  body('currentSessionId')
    .optional()
    .isUUID()
    .withMessage('Session ID must be valid UUID')
];

/**
 * Update player presence status
 */
const updatePresence = async (req, res) => {
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
    const { status, currentGameMode, currentSessionId } = req.body;

    // Update presence in database
    await updatePresenceStatus(userId, status, currentGameMode, currentSessionId);

    // Send real-time update to friends via WebSocket
    // This will be handled by the Socket.io presence_update event

    winston.info(`Presence updated for user ${userId}: ${status}`);

    res.json({
      status: 'presence_updated',
      user_id: userId,
      presence: {
        status,
        current_game_mode: currentGameMode,
        current_session_id: currentSessionId,
        last_seen: new Date().toISOString()
      }
    });

  } catch (err) {
    winston.error('Update presence error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update presence'
      }
    });
  }
};

/**
 * Get friend presence statuses
 */
const getFriendPresence = async (req, res) => {
  try {
    const userId = req.user.id;
    const { includeOffline = true } = req.query;

    // Get user's friends with their presence
    const friendsResult = await query(`
      SELECT
        CASE
          WHEN f.user_id = $1 THEN f.friend_id
          ELSE f.user_id
        END as friend_id,
        u.username,
        COALESCE(p.status, 'offline') as status,
        p.last_seen,
        p.current_game_mode,
        p.current_session_id,
        p.steam_status
      FROM friends f
      JOIN users u ON (
        CASE
          WHEN f.user_id = $1 THEN f.friend_id = u.id
          ELSE f.user_id = u.id
        END
      )
      LEFT JOIN player_presence p ON p.user_id = u.id
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.friendship_status = 'active'
        AND ($2 OR COALESCE(p.status, 'offline') != 'offline')
      ORDER BY
        CASE
          WHEN COALESCE(p.status, 'offline') = 'online' THEN 1
          WHEN COALESCE(p.status, 'offline') = 'in_game' THEN 2
          WHEN COALESCE(p.status, 'offline') = 'away' THEN 3
          ELSE 4
        END,
        u.username
    `, [userId, includeOffline]);

    const friends = friendsResult.rows.map(row => ({
      user_id: row.friend_id,
      username: row.username,
      status: row.status,
      last_seen: row.last_seen,
      current_game_mode: row.current_game_mode,
      current_session_id: row.current_session_id,
      steam_status: row.steam_status
    }));

    res.json({
      friends,
      total_friends: friends.length,
      online_count: friends.filter(f => f.status === 'online' || f.status === 'in_game').length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get friend presence error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get friend presence'
      }
    });
  }
};

/**
 * Get online friends only
 */
const getOnlineFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get only online/in-game friends
    const friendsResult = await query(`
      SELECT
        CASE
          WHEN f.user_id = $1 THEN f.friend_id
          ELSE f.user_id
        END as friend_id,
        u.username,
        p.status,
        p.last_seen,
        p.current_game_mode,
        p.current_session_id,
        p.steam_status
      FROM friends f
      JOIN users u ON (
        CASE
          WHEN f.user_id = $1 THEN f.friend_id = u.id
          ELSE f.user_id = u.id
        END
      )
      JOIN player_presence p ON p.user_id = u.id
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.friendship_status = 'active'
        AND p.status IN ('online', 'in_game')
      ORDER BY u.username
    `, [userId]);

    const onlineFriends = friendsResult.rows.map(row => ({
      user_id: row.friend_id,
      username: row.username,
      status: row.status,
      last_seen: row.last_seen,
      current_game_mode: row.current_game_mode,
      current_session_id: row.current_session_id,
      steam_status: row.steam_status
    }));

    res.json({
      online_friends: onlineFriends,
      count: onlineFriends.length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get online friends error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get online friends'
      }
    });
  }
};

/**
 * Get user's own presence status
 */
const getMyPresence = async (req, res) => {
  try {
    const userId = req.user.id;

    const presenceResult = await query(`
      SELECT
        status,
        last_seen,
        current_game_mode,
        current_session_id,
        steam_status
      FROM player_presence
      WHERE user_id = $1
    `, [userId]);

    if (presenceResult.rows.length === 0) {
      return res.json({
        status: 'offline',
        last_seen: null,
        current_game_mode: null,
        current_session_id: null,
        steam_status: {}
      });
    }

    const presence = presenceResult.rows[0];

    res.json({
      status: presence.status,
      last_seen: presence.last_seen,
      current_game_mode: presence.current_game_mode,
      current_session_id: presence.current_session_id,
      steam_status: presence.steam_status || {}
    });

  } catch (err) {
    winston.error('Get my presence error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get presence status'
      }
    });
  }
};

/**
 * Bulk presence query (for batch operations)
 */
const bulkPresenceQuery = async (req, res) => {
  try {
    const userId = req.user.id;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 100) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'userIds must be array with 1-100 items'
        }
      });
    }

    // Check if all requested users are friends (privacy control)
    const friendsCheck = await query(`
      SELECT DISTINCT
        CASE
          WHEN f.user_id = $1 THEN f.friend_id
          ELSE f.user_id
        END as friend_id
      FROM friends f
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.friendship_status = 'active'
        AND (
          CASE
            WHEN f.user_id = $1 THEN f.friend_id
            ELSE f.user_id
          END = ANY($2)
        )
    `, [userId, userIds]);

    const friendIds = friendsCheck.rows.map(row => row.friend_id);

    // Get presence for friends only
    const presenceResult = await query(`
      SELECT
        p.user_id,
        u.username,
        COALESCE(p.status, 'offline') as status,
        p.last_seen,
        p.current_game_mode,
        p.current_session_id
      FROM unnest($1::uuid[]) as requested_user(user_id)
      LEFT JOIN player_presence p ON p.user_id = requested_user.user_id
      LEFT JOIN users u ON u.id = requested_user.user_id
      WHERE requested_user.user_id = ANY($2)
    `, [userIds, friendIds]);

    const presenceMap = {};
    presenceResult.rows.forEach(row => {
      presenceMap[row.user_id] = {
        user_id: row.user_id,
        username: row.username,
        status: row.status,
        last_seen: row.last_seen,
        current_game_mode: row.current_game_mode,
        current_session_id: row.current_session_id
      };
    });

    res.json({
      presence: presenceMap,
      requested_count: userIds.length,
      returned_count: Object.keys(presenceMap).length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Bulk presence query error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to query presence data'
      }
    });
  }
};

/**
 * Clean up stale presence data (admin function)
 */
const cleanupStalePresence = async (req, res) => {
  try {
    // Mark users as offline if they haven't been seen in 10 minutes
    // and aren't in an active session
    const result = await query(`
      UPDATE player_presence
      SET status = 'offline', last_seen = NOW()
      WHERE status IN ('online', 'away', 'in_game', 'in_menu')
        AND last_seen < NOW() - INTERVAL '10 minutes'
        AND (current_session_id IS NULL OR current_session_id NOT IN (
          SELECT id FROM game_sessions WHERE status IN ('waiting', 'active')
        ))
    `);

    const updatedCount = result.rowCount;

    winston.info(`Cleaned up ${updatedCount} stale presence records`);

    res.json({
      status: 'cleanup_completed',
      records_updated: updatedCount,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Cleanup stale presence error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to cleanup presence data'
      }
    });
  }
};

module.exports = {
  updatePresence,
  getFriendPresence,
  getOnlineFriends,
  getMyPresence,
  bulkPresenceQuery,
  cleanupStalePresence,
  updatePresenceValidation
};
