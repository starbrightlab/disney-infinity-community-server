const { query, transaction } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');
const { sendNotificationToUser } = require('../socket');
const achievementService = require('../services/achievementService');

/**
 * Friends controller for social connections and friend management
 */

/**
 * Send friend request validation
 */
const sendFriendRequestValidation = [
  body('targetUserId')
    .isUUID()
    .withMessage('Valid target user ID required'),
  body('message')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Message must be less than 500 characters')
];

/**
 * Accept/decline friend request validation
 */
const respondFriendRequestValidation = [
  body('requestId')
    .isUUID()
    .withMessage('Valid request ID required'),
  body('action')
    .isIn(['accept', 'decline'])
    .withMessage('Action must be accept or decline')
];

/**
 * Send friend request
 */
const sendFriendRequest = async (req, res) => {
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

    const senderId = req.user.id;
    const { targetUserId, message } = req.body;

    // Cannot send friend request to yourself
    if (senderId === targetUserId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Cannot send friend request to yourself'
        }
      });
    }

    // Check if target user exists
    const targetUserCheck = await query(
      'SELECT id, username FROM users WHERE id = $1',
      [targetUserId]
    );

    if (targetUserCheck.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Target user not found'
        }
      });
    }

    const targetUser = targetUserCheck.rows[0];

    // Check if users are already friends
    const existingFriendship = await query(`
      SELECT id FROM friends
      WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        AND friendship_status = 'active'
    `, [senderId, targetUserId]);

    if (existingFriendship.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Users are already friends'
        }
      });
    }

    // Check for existing pending request (either direction)
    const existingRequest = await query(`
      SELECT id, sender_id FROM friend_requests
      WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
        AND status = 'pending'
    `, [senderId, targetUserId]);

    if (existingRequest.rows.length > 0) {
      const request = existingRequest.rows[0];
      if (request.sender_id === senderId) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Friend request already sent'
          }
        });
      } else {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'You have a pending friend request from this user'
          }
        });
      }
    }

    // Create friend request
    const requestResult = await query(`
      INSERT INTO friend_requests (sender_id, receiver_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
    `, [senderId, targetUserId, message || null]);

    const friendRequest = requestResult.rows[0];

    // Send real-time notification to target user
    sendNotificationToUser(targetUserId, 'friend_request_received', {
      request_id: friendRequest.id,
      sender_id: senderId,
      sender_username: req.user.username,
      message: message,
      timestamp: friendRequest.created_at
    });

    winston.info(`Friend request sent: ${senderId} -> ${targetUserId}`);

    res.status(201).json({
      request_id: friendRequest.id,
      target_user: {
        id: targetUser.id,
        username: targetUser.username
      },
      message: message,
      status: 'sent',
      created_at: friendRequest.created_at
    });

  } catch (err) {
    winston.error('Send friend request error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send friend request'
      }
    });
  }
};

/**
 * Accept friend request
 */
const acceptFriendRequest = async (req, res) => {
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
    const { requestId } = req.body;

    // Get and validate friend request
    const requestResult = await query(`
      SELECT fr.id, fr.sender_id, fr.receiver_id, fr.status, u.username as sender_username
      FROM friend_requests fr
      JOIN users u ON fr.sender_id = u.id
      WHERE fr.id = $1 AND fr.receiver_id = $2
    `, [requestId, userId]);

    if (requestResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Friend request not found'
        }
      });
    }

    const friendRequest = requestResult.rows[0];

    if (friendRequest.status !== 'pending') {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Friend request has already been processed'
        }
      });
    }

    const senderId = friendRequest.sender_id;

    // Use transaction to ensure atomicity
    await transaction(async (client) => {
      // Update friend request status
      await client.query(`
        UPDATE friend_requests
        SET status = 'accepted', updated_at = NOW()
        WHERE id = $1
      `, [requestId]);

      // Create bidirectional friendship
      await client.query(`
        INSERT INTO friends (user_id, friend_id, added_at)
        VALUES ($1, $2, NOW()), ($2, $1, NOW())
      `, [userId, senderId]);
    });

    // Check for friend achievements for both users
    await achievementService.onFriendAdded(userId, {
      friend_id: senderId,
      friend_username: friendRequest.sender_username
    });

    await achievementService.onFriendAdded(senderId, {
      friend_id: userId,
      friend_username: req.user.username
    });

    // Send real-time notification to sender
    sendNotificationToUser(senderId, 'friend_request_accepted', {
      accepter_id: userId,
      accepter_username: req.user.username,
      timestamp: new Date().toISOString()
    });

    winston.info(`Friend request accepted: ${senderId} -> ${userId}`);

    res.json({
      request_id: requestId,
      friend: {
        id: senderId,
        username: friendRequest.sender_username
      },
      status: 'accepted',
      friendship_created: true
    });

  } catch (err) {
    winston.error('Accept friend request error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to accept friend request'
      }
    });
  }
};

/**
 * Decline friend request
 */
const declineFriendRequest = async (req, res) => {
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
    const { requestId } = req.body;

    // Update friend request status
    const updateResult = await query(`
      UPDATE friend_requests
      SET status = 'declined', updated_at = NOW()
      WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
      RETURNING id, sender_id
    `, [requestId, userId]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Pending friend request not found'
        }
      });
    }

    const declinedRequest = updateResult.rows[0];

    // Send real-time notification to sender
    sendNotificationToUser(declinedRequest.sender_id, 'friend_request_declined', {
      decliner_id: userId,
      decliner_username: req.user.username,
      request_id: requestId,
      timestamp: new Date().toISOString()
    });

    winston.info(`Friend request declined: ${declinedRequest.sender_id} request to ${userId}`);

    res.json({
      request_id: requestId,
      status: 'declined'
    });

  } catch (err) {
    winston.error('Decline friend request error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to decline friend request'
      }
    });
  }
};

/**
 * Remove friend
 */
const removeFriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.params;

    // Check if friendship exists
    const friendshipCheck = await query(`
      SELECT id FROM friends
      WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        AND friendship_status = 'active'
    `, [userId, friendId]);

    if (friendshipCheck.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Friendship not found'
        }
      });
    }

    // Remove bidirectional friendship
    const removeResult = await query(`
      UPDATE friends
      SET friendship_status = 'removed', last_interaction = NOW()
      WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        AND friendship_status = 'active'
    `, [userId, friendId]);

    // Send real-time notification to removed friend
    sendNotificationToUser(friendId, 'friend_removed', {
      remover_id: userId,
      remover_username: req.user.username,
      timestamp: new Date().toISOString()
    });

    winston.info(`Friend removed: ${userId} removed ${friendId}`);

    res.json({
      friend_id: friendId,
      status: 'removed'
    });

  } catch (err) {
    winston.error('Remove friend error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to remove friend'
      }
    });
  }
};

/**
 * Get pending friend requests (received)
 */
const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requestsResult = await query(`
      SELECT
        fr.id,
        fr.sender_id,
        u.username as sender_username,
        fr.message,
        fr.created_at
      FROM friend_requests fr
      JOIN users u ON fr.sender_id = u.id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [userId]);

    const pendingRequests = requestsResult.rows.map(row => ({
      id: row.id,
      sender: {
        id: row.sender_id,
        username: row.sender_username
      },
      message: row.message,
      created_at: row.created_at
    }));

    res.json({
      pending_requests: pendingRequests,
      count: pendingRequests.length
    });

  } catch (err) {
    winston.error('Get pending requests error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get pending requests'
      }
    });
  }
};

/**
 * Get sent friend requests
 */
const getSentRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requestsResult = await query(`
      SELECT
        fr.id,
        fr.receiver_id,
        u.username as receiver_username,
        fr.message,
        fr.created_at,
        fr.status
      FROM friend_requests fr
      JOIN users u ON fr.receiver_id = u.id
      WHERE fr.sender_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [userId]);

    const sentRequests = requestsResult.rows.map(row => ({
      id: row.id,
      receiver: {
        id: row.receiver_id,
        username: row.receiver_username
      },
      message: row.message,
      created_at: row.created_at,
      status: row.status
    }));

    res.json({
      sent_requests: sentRequests,
      count: sentRequests.length
    });

  } catch (err) {
    winston.error('Get sent requests error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get sent requests'
      }
    });
  }
};

/**
 * Get friend list with presence information
 */
const getFriendList = async (req, res) => {
  try {
    const userId = req.user.id;
    const { includeOffline = true, limit = 50, offset = 0 } = req.query;

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
        f.added_at,
        f.last_interaction
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
      LIMIT $3 OFFSET $4
    `, [userId, includeOffline, parseInt(limit), parseInt(offset)]);

    const friends = friendsResult.rows.map(row => ({
      user_id: row.friend_id,
      username: row.username,
      status: row.status,
      last_seen: row.last_seen,
      current_game_mode: row.current_game_mode,
      current_session_id: row.current_session_id,
      friendship: {
        added_at: row.added_at,
        last_interaction: row.last_interaction
      }
    }));

    // Get total count
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM friends f
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.friendship_status = 'active'
    `, [userId]);

    const totalFriends = parseInt(countResult.rows[0].total);

    res.json({
      friends,
      pagination: {
        total: totalFriends,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (parseInt(offset) + friends.length) < totalFriends
      },
      online_count: friends.filter(f => f.status === 'online' || f.status === 'in_game').length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get friend list error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get friend list'
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
        f.added_at
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
      friendship_added_at: row.added_at
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
 * Send game invitation to friend
 */
const inviteFriendToGameValidation = [
  body('friendId')
    .isUUID()
    .withMessage('Valid friend ID required'),
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required'),
  body('message')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Message must be less than 200 characters')
];

const inviteFriendToGame = async (req, res) => {
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
    const { friendId, sessionId, message } = req.body;

    // Verify friendship
    const friendshipCheck = await query(`
      SELECT id FROM friends
      WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        AND friendship_status = 'active'
    `, [userId, friendId]);

    if (friendshipCheck.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users are not friends'
        }
      });
    }

    // Verify session exists and user is host
    const sessionCheck = await query(`
      SELECT id, game_mode, status, max_players, current_players
      FROM game_sessions
      WHERE id = $1 AND host_user_id = $2 AND status IN ('waiting', 'active')
    `, [sessionId, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found or you are not the host'
        }
      });
    }

    const session = sessionCheck.rows[0];

    // Check if session has room
    if (session.current_players >= session.max_players) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Session is full'
        }
      });
    }

    // Check if friend is already in the session
    const friendInSession = await query(`
      SELECT id FROM session_players
      WHERE session_id = $1 AND user_id = $2
    `, [sessionId, friendId]);

    if (friendInSession.rows.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Friend is already in this session'
        }
      });
    }

    // Send real-time invitation
    sendNotificationToUser(friendId, 'game_invitation', {
      session_id: sessionId,
      host_id: userId,
      host_username: req.user.username,
      game_mode: session.game_mode,
      session_status: session.status,
      current_players: session.current_players,
      max_players: session.max_players,
      message: message,
      timestamp: new Date().toISOString()
    });

    winston.info(`Game invitation sent: ${userId} invited ${friendId} to session ${sessionId}`);

    res.json({
      invitation_sent: true,
      friend_id: friendId,
      session_id: sessionId,
      game_mode: session.game_mode,
      message: message,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Invite friend to game error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send game invitation'
      }
    });
  }
};

/**
 * Block/unblock user (future enhancement)
 */
const blockUser = async (req, res) => {
  // Placeholder for future blocking functionality
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'User blocking not yet implemented'
    }
  });
};

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getPendingRequests,
  getSentRequests,
  getFriendList,
  getOnlineFriends,
  inviteFriendToGame,
  blockUser,
  sendFriendRequestValidation,
  respondFriendRequestValidation,
  inviteFriendToGameValidation
};
