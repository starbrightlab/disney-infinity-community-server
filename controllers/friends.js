const { supabase } = require('../config/database');
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
    const { data: targetUser, error: targetUserError } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', targetUserId)
      .single();

    if (targetUserError || !targetUser) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Target user not found'
        }
      });
    }

    // Check if users are already friends
    const { data: existingFriendship } = await supabase
      .from('friends')
      .select('id')
      .or(`and(user_id.eq.${senderId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${senderId})`)
      .eq('friendship_status', 'active');

    if (existingFriendship && existingFriendship.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Users are already friends'
        }
      });
    }

    // Check for existing pending request (either direction)
    const { data: existingRequest } = await supabase
      .from('friend_requests')
      .select('id, sender_id')
      .or(`and(sender_id.eq.${senderId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${senderId})`)
      .eq('status', 'pending');

    if (existingRequest && existingRequest.length > 0) {
      const request = existingRequest[0];
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
    const { data: friendRequest, error: insertError } = await supabase
      .from('friend_requests')
      .insert([{
        sender_id: senderId,
        receiver_id: targetUserId,
        message: message || null
      }])
      .select('id, created_at')
      .single();

    if (insertError) {
      winston.error('Failed to create friend request:', insertError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to send friend request'
        }
      });
    }

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
    const { data: friendRequest, error: requestError } = await supabase
      .from('friend_requests')
      .select(`
        id, sender_id, receiver_id, status,
        users!friend_requests_sender_id_fkey(username)
      `)
      .eq('id', requestId)
      .eq('receiver_id', userId)
      .single();

    if (requestError || !friendRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Friend request not found'
        }
      });
    }

    // Fix the field name from the join
    friendRequest.sender_username = friendRequest.users?.username;

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
    const { data: declinedRequest, error: updateError } = await supabase
      .from('friend_requests')
      .update({
        status: 'declined',
        updated_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .eq('receiver_id', userId)
      .eq('status', 'pending')
      .select('id, sender_id')
      .single();

    if (updateError || !declinedRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Pending friend request not found'
        }
      });
    }

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
    const { data: friendshipCheck } = await supabase
      .from('friends')
      .select('id')
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq('friendship_status', 'active');

    if (!friendshipCheck || friendshipCheck.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Friendship not found'
        }
      });
    }

    // Remove bidirectional friendship
    const { error: removeError } = await supabase
      .from('friends')
      .update({
        friendship_status: 'removed',
        last_interaction: new Date().toISOString()
      })
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq('friendship_status', 'active');

    if (removeError) {
      winston.error('Failed to remove friendship:', removeError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to remove friend'
        }
      });
    }

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

    const { data: pendingRequests, error: requestsError } = await supabase
      .from('friend_requests')
      .select(`
        id,
        sender_id,
        message,
        created_at,
        users!friend_requests_sender_id_fkey(username)
      `)
      .eq('receiver_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (requestsError) {
      winston.error('Failed to get pending requests:', requestsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get pending requests'
        }
      });
    }

    // Transform the data to match expected format
    const formattedRequests = requests.map(request => ({
      id: request.id,
      sender: {
        id: request.sender_id,
        username: request.sender_username
      },
      message: request.message,
      created_at: request.created_at
    }));

    res.json({
      pending_requests: formattedRequests,
      count: formattedRequests.length
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

    const { data: sentRequestsData, error: sentError } = await supabase
      .from('friend_requests')
      .select(`
        id,
        receiver_id,
        message,
        created_at,
        status,
        users!friend_requests_receiver_id_fkey(username)
      `)
      .eq('sender_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (sentError) {
      winston.error('Failed to get sent requests:', sentError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get sent requests'
        }
      });
    }

    const sentRequests = sentRequestsData.map(request => ({
      id: request.id,
      receiver: {
        id: request.receiver_id,
        username: request.users?.username
      },
      message: request.message,
      created_at: request.created_at,
      status: request.status
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

    // First get all friend relationships
    const { data: friendRelationships, error: friendsError } = await supabase
      .from('friends')
      .select(`
        user_id,
        friend_id,
        added_at,
        last_interaction
      `)
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('friendship_status', 'active');

    if (friendsError) {
      winston.error('Failed to get friend relationships:', friendsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get friends'
        }
      });
    }

    // Extract friend IDs (excluding current user)
    const friendIds = friendRelationships.map(rel =>
      rel.user_id === userId ? rel.friend_id : rel.user_id
    );

    if (friendIds.length === 0) {
      return res.json({
        friends: [],
        total: 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    }

    // Get friend details and presence
    const { data: friendsData, error: detailsError } = await supabase
      .from('users')
      .select(`
        id,
        username,
        player_presence (
          status,
          last_seen,
          current_game_mode,
          current_session_id
        )
      `)
      .in('id', friendIds)
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (detailsError) {
      winston.error('Failed to get friend details:', detailsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get friend details'
        }
      });
    }

    // Combine data and filter by online status if needed
    const friends = friendsData
      .map(friend => {
        const relationship = friendRelationships.find(rel =>
          rel.user_id === friend.id || rel.friend_id === friend.id
        );
        const presence = friend.player_presence?.[0] || { status: 'offline' };

        return {
          user_id: friend.id,
          username: friend.username,
          status: presence.status || 'offline',
          last_seen: presence.last_seen,
          current_game_mode: presence.current_game_mode,
          current_session_id: presence.current_session_id,
          friendship: {
            added_at: relationship.added_at,
            last_interaction: relationship.last_interaction
          }
        };
      })
      .filter(friend => includeOffline || friend.status !== 'offline')
      .sort((a, b) => {
        // Sort by status priority, then username
        const statusOrder = { online: 1, in_game: 2, away: 3, offline: 4 };
        const aOrder = statusOrder[a.status] || 4;
        const bOrder = statusOrder[b.status] || 4;

        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.username.localeCompare(b.username);
      });

    // Get total count
    const { count: totalFriends, error: countError } = await supabase
      .from('friends')
      .select('*', { count: 'exact', head: true })
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('friendship_status', 'active');

    if (countError) {
      winston.error('Failed to count friends:', countError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to count friends'
        }
      });
    }

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

    // Get online friends
    const { data: friendRelationships, error: friendsError } = await supabase
      .from('friends')
      .select('user_id, friend_id, added_at')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('friendship_status', 'active');

    if (friendsError) {
      winston.error('Failed to get friend relationships:', friendsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get online friends'
        }
      });
    }

    const friendIds = friendRelationships.map(rel =>
      rel.user_id === userId ? rel.friend_id : rel.user_id
    );

    if (friendIds.length === 0) {
      return res.json({
        online_friends: [],
        count: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Get online friends with presence info
    const { data: onlineFriendsData, error: onlineError } = await supabase
      .from('users')
      .select(`
        id,
        username,
        player_presence!inner (
          status,
          last_seen,
          current_game_mode,
          current_session_id
        )
      `)
      .in('id', friendIds)
      .in('player_presence.status', ['online', 'in_game'])
      .order('username');

    if (onlineError) {
      winston.error('Failed to get online friends:', onlineError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get online friends'
        }
      });
    }

    const onlineFriends = onlineFriendsData.map(friend => {
      const relationship = friendRelationships.find(rel =>
        rel.user_id === friend.id || rel.friend_id === friend.id
      );
      const presence = friend.player_presence[0];

      return {
        user_id: friend.id,
        username: friend.username,
        status: presence.status,
        last_seen: presence.last_seen,
        current_game_mode: presence.current_game_mode,
        current_session_id: presence.current_session_id,
        friendship_added_at: relationship.added_at
      };
    });

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
    const { data: friendshipCheck, error: friendError } = await supabase
      .from('friends')
      .select('id')
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq('friendship_status', 'active');

    if (friendError || !friendshipCheck || friendshipCheck.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users are not friends'
        }
      });
    }

    // Verify session exists and user is host
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, game_mode, status, max_players, current_players')
      .eq('id', sessionId)
      .eq('host_user_id', userId)
      .in('status', ['waiting', 'active'])
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found or you are not the host'
        }
      });
    }

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
    const { data: friendInSession, error: playerError } = await supabase
      .from('session_players')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', friendId);

    if (playerError) {
      winston.error('Failed to check if friend in session:', playerError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to check session'
        }
      });
    }

    if (friendInSession && friendInSession.length > 0) {
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
