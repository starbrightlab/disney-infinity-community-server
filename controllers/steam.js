const { query } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

/**
 * Steam integration controller for Steamworks API coordination
 */

/**
 * Register Steam ID for a user
 */
const registerSteamIdValidation = [
  body('steamId')
    .isLength({ min: 17, max: 17 })
    .matches(/^\d+$/)
    .withMessage('Steam ID must be 17 digits'),
  body('steamUsername')
    .optional()
    .isLength({ min: 1, max: 50 })
    .withMessage('Steam username must be 1-50 characters')
];

const registerSteamId = async (req, res) => {
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
    const { steamId, steamUsername } = req.body;

    // Check if Steam ID is already registered to another user
    const existingUser = await query(
      'SELECT id FROM users WHERE id != $1 AND profile_data->>\'steam_id\' = $2',
      [userId, steamId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Steam ID already registered to another user'
        }
      });
    }

    // Update user's profile with Steam information
    const steamData = {
      steam_id: steamId,
      steam_username: steamUsername,
      steam_registered_at: new Date().toISOString()
    };

    await query(
      'UPDATE users SET profile_data = profile_data || $1 WHERE id = $2',
      [JSON.stringify(steamData), userId]
    );

    winston.info(`Steam ID registered for user ${userId}: ${steamId}`);

    res.json({
      status: 'steam_id_registered',
      steam_id: steamId,
      steam_username: steamUsername,
      registered_at: steamData.steam_registered_at
    });

  } catch (err) {
    winston.error('Register Steam ID error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to register Steam ID'
      }
    });
  }
};

/**
 * Get Steam lobby information for a session
 */
const getSteamLobby = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Verify user is in the session
    const sessionCheck = await query(`
      SELECT s.id, s.steam_lobby_id, s.game_mode, s.status
      FROM game_sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE s.id = $1 AND sp.user_id = $2
    `, [sessionId, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'User is not in this session'
        }
      });
    }

    const session = sessionCheck.rows[0];

    if (!session.steam_lobby_id) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'No Steam lobby associated with this session'
        }
      });
    }

    // Get Steam IDs for all players in the session
    const playersResult = await query(`
      SELECT
        sp.user_id,
        u.profile_data->>'steam_id' as steam_id,
        u.username
      FROM session_players sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.session_id = $1
    `, [sessionId]);

    const steamPlayers = playersResult.rows
      .filter(player => player.steam_id)
      .map(player => ({
        user_id: player.user_id,
        steam_id: player.steam_id,
        username: player.username
      }));

    res.json({
      session_id: sessionId,
      steam_lobby_id: session.steam_lobby_id,
      game_mode: session.game_mode,
      status: session.status,
      steam_players: steamPlayers,
      lobby_data: {
        type: 'public', // or 'friends', 'private'
        max_members: 4,
        joinable: session.status === 'waiting'
      }
    });

  } catch (err) {
    winston.error('Get Steam lobby error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get Steam lobby information'
      }
    });
  }
};

/**
 * Create Steam lobby for a session (host only)
 */
const createSteamLobbyValidation = [
  body('lobbyType')
    .optional()
    .isIn(['public', 'friends', 'private'])
    .withMessage('Invalid lobby type'),
  body('maxMembers')
    .optional()
    .isInt({ min: 2, max: 4 })
    .withMessage('Max members must be 2-4')
];

const createSteamLobby = async (req, res) => {
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

    const { sessionId } = req.params;
    const userId = req.user.id;
    const { lobbyType = 'public', maxMembers = 4 } = req.body;

    // Verify user is the host of the session
    const sessionResult = await query(`
      SELECT id, host_user_id, status, steam_lobby_id
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
          message: 'Only session host can create Steam lobby'
        }
      });
    }

    if (session.steam_lobby_id) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Steam lobby already exists for this session'
        }
      });
    }

    // Generate a mock Steam lobby ID (in real implementation, this would come from Steam API)
    const steamLobbyId = `steam_lobby_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Update session with Steam lobby information
    await query(`
      UPDATE game_sessions
      SET steam_lobby_id = $1, session_data = session_data || $2
      WHERE id = $3
    `, [
      steamLobbyId,
      JSON.stringify({
        steamLobbyType: lobbyType,
        steamMaxMembers: maxMembers
      }),
      sessionId
    ]);

    winston.info(`Steam lobby created for session ${sessionId}: ${steamLobbyId}`);

    res.json({
      session_id: sessionId,
      steam_lobby_id: steamLobbyId,
      lobby_type: lobbyType,
      max_members: maxMembers,
      created: true
    });

  } catch (err) {
    winston.error('Create Steam lobby error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to create Steam lobby'
      }
    });
  }
};

/**
 * Update Steam lobby metadata
 */
const updateSteamLobbyValidation = [
  body('metadata')
    .isObject()
    .withMessage('Metadata must be an object'),
  body('metadata.gameMode')
    .optional()
    .isIn(['toybox', 'adventure', 'versus', 'cooperative'])
    .withMessage('Invalid game mode'),
  body('metadata.playerCount')
    .optional()
    .isInt({ min: 1, max: 4 })
    .withMessage('Player count must be 1-4'),
  body('metadata.status')
    .optional()
    .isIn(['waiting', 'starting', 'in_progress'])
    .withMessage('Invalid status')
];

const updateSteamLobby = async (req, res) => {
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

    const { sessionId } = req.params;
    const userId = req.user.id;
    const { metadata } = req.body;

    // Verify user is the host of the session
    const sessionResult = await query(`
      SELECT id, host_user_id, steam_lobby_id
      FROM game_sessions
      WHERE id = $1 AND host_user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only session host can update Steam lobby'
        }
      });
    }

    const session = sessionResult.rows[0];

    if (!session.steam_lobby_id) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'No Steam lobby associated with this session'
        }
      });
    }

    // Update session data with Steam metadata
    await query(`
      UPDATE game_sessions
      SET session_data = session_data || $1
      WHERE id = $2
    `, [JSON.stringify({ steamMetadata: metadata }), sessionId]);

    winston.debug(`Steam lobby metadata updated for session ${sessionId}`);

    res.json({
      session_id: sessionId,
      steam_lobby_id: session.steam_lobby_id,
      metadata: metadata,
      updated: true
    });

  } catch (err) {
    winston.error('Update Steam lobby error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update Steam lobby'
      }
    });
  }
};

/**
 * Get Steam friends list integration
 */
const getSteamFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's Steam ID
    const userResult = await query(
      'SELECT profile_data FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const profileData = userResult.rows[0].profile_data || {};
    const userSteamId = profileData.steam_id;

    if (!userSteamId) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'User has not registered a Steam ID'
        }
      });
    }

    // Find other users who are Steam friends (in a real implementation,
    // this would query Steam API for friends list and match against our users)
    // For now, return users who have Steam IDs and are in the same sessions

    const friendsResult = await query(`
      SELECT DISTINCT
        u.id,
        u.username,
        u.profile_data->>'steam_id' as steam_id,
        u.profile_data->>'steam_username' as steam_username,
        CASE WHEN f.id IS NOT NULL THEN true ELSE false END as is_friend
      FROM users u
      LEFT JOIN friends f ON (
        (f.user_id = $1 AND f.friend_id = u.id) OR
        (f.friend_id = $1 AND f.user_id = u.id)
      ) AND f.friendship_status = 'active'
      WHERE u.id != $1
        AND u.profile_data->>'steam_id' IS NOT NULL
      ORDER BY u.username
    `, [userId]);

    const steamFriends = friendsResult.rows.map(friend => ({
      user_id: friend.id,
      username: friend.username,
      steam_id: friend.steam_id,
      steam_username: friend.steam_username,
      is_friend: friend.is_friend,
      online_status: 'unknown' // In real implementation, would check Steam API
    }));

    res.json({
      user_steam_id: userSteamId,
      steam_friends: steamFriends,
      total_friends: steamFriends.length
    });

  } catch (err) {
    winston.error('Get Steam friends error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get Steam friends'
      }
    });
  }
};

/**
 * Report Steam overlay status
 */
const reportSteamOverlayValidation = [
  body('overlayActive')
    .isBoolean()
    .withMessage('overlayActive must be boolean'),
  body('overlayVersion')
    .optional()
    .isLength({ min: 1, max: 20 })
    .withMessage('Overlay version must be 1-20 characters'),
  body('compatibilityIssues')
    .optional()
    .isArray()
    .withMessage('Compatibility issues must be an array')
];

const reportSteamOverlay = async (req, res) => {
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
    const { overlayActive, overlayVersion, compatibilityIssues = [] } = req.body;

    // Store Steam overlay information
    const overlayData = {
      overlay_active: overlayActive,
      overlay_version: overlayVersion,
      compatibility_issues: compatibilityIssues,
      reported_at: new Date().toISOString()
    };

    // Update user's Steam status
    await query(`
      UPDATE users
      SET profile_data = profile_data || $1
      WHERE id = $2
    `, [JSON.stringify({ steam_overlay: overlayData }), userId]);

    winston.debug(`Steam overlay status reported for user ${userId}: active=${overlayActive}`);

    res.json({
      status: 'overlay_status_recorded',
      overlay_active: overlayActive,
      overlay_version: overlayVersion,
      compatibility_issues: compatibilityIssues,
      recorded: true
    });

  } catch (err) {
    winston.error('Report Steam overlay error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to report Steam overlay status'
      }
    });
  }
};

/**
 * Get Steam achievements/progress (placeholder for future implementation)
 */
const getSteamAchievements = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's achievement progress from database
    // This is a placeholder - in real implementation would sync with Steam
    const achievementsResult = await query(`
      SELECT
        achievement_id,
        achievement_name,
        unlocked,
        unlocked_at,
        progress
      FROM user_achievements
      WHERE user_id = $1
      ORDER BY unlocked_at DESC NULLS LAST
    `, [userId]);

    // For now, return mock achievements
    const mockAchievements = [
      {
        id: 'first_win',
        name: 'First Victory',
        description: 'Win your first multiplayer game',
        unlocked: true,
        unlocked_at: '2024-01-15T10:30:00Z',
        icon: 'achievement_first_win.png'
      },
      {
        id: 'toybox_master',
        name: 'Toybox Master',
        description: 'Create 10 toyboxes',
        unlocked: false,
        progress: 7,
        max_progress: 10,
        icon: 'achievement_toybox_master.png'
      }
    ];

    res.json({
      user_id: userId,
      achievements: mockAchievements,
      total_achievements: mockAchievements.length,
      unlocked_count: mockAchievements.filter(a => a.unlocked).length
    });

  } catch (err) {
    winston.error('Get Steam achievements error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get Steam achievements'
      }
    });
  }
};

module.exports = {
  registerSteamId,
  getSteamLobby,
  createSteamLobby,
  updateSteamLobby,
  getSteamFriends,
  reportSteamOverlay,
  getSteamAchievements,
  registerSteamIdValidation,
  createSteamLobbyValidation,
  updateSteamLobbyValidation,
  reportSteamOverlayValidation
};
