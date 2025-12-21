const { supabase } = require('../config/database');
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

    // Get user's friends
    const { data: friendRelationships, error: friendsError } = await supabase
      .from('friends')
      .select('user_id, friend_id')
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

    const friendIds = friendRelationships.map(rel =>
      rel.user_id === userId ? rel.friend_id : rel.user_id
    );

    if (friendIds.length === 0) {
      return res.json({
        friends: [],
        timestamp: new Date().toISOString()
      });
    }

    // Get friends with presence information
    const { data: friendsData, error: presenceError } = await supabase
      .from('users')
      .select(`
        id,
        username,
        player_presence (
          status,
          last_seen,
          current_game_mode,
          current_session_id,
          steam_status
        )
      `)
      .in('id', friendIds);

    if (presenceError) {
      winston.error('Failed to get friend presence:', presenceError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get friend presence'
        }
      });
    }

    const friends = friendsData
      .map(friend => ({
        user_id: friend.id,
        username: friend.username,
        status: friend.player_presence?.[0]?.status || 'offline',
        last_seen: friend.player_presence?.[0]?.last_seen,
        current_game_mode: friend.player_presence?.[0]?.current_game_mode,
        current_session_id: friend.player_presence?.[0]?.current_session_id,
        steam_status: friend.player_presence?.[0]?.steam_status
      }))
      .filter(friend => includeOffline || friend.status !== 'offline')
      .sort((a, b) => {
        // Sort by status priority, then username
        const statusOrder = { online: 1, in_game: 2, away: 3, offline: 4 };
        const aOrder = statusOrder[a.status] || 4;
        const bOrder = statusOrder[b.status] || 4;

        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.username.localeCompare(b.username);
      });

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

    // Get user's friends
    const { data: friendRelationships, error: friendsError } = await supabase
      .from('friends')
      .select('user_id, friend_id')
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

    // Get online friends only
    const { data: onlineFriendsData, error: onlineError } = await supabase
      .from('users')
      .select(`
        id,
        username,
        player_presence!inner (
          status,
          last_seen,
          current_game_mode,
          current_session_id,
          steam_status
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

    const onlineFriends = onlineFriendsData.map(friend => ({
      user_id: friend.id,
      username: friend.username,
      status: friend.player_presence[0].status,
      last_seen: friend.player_presence[0].last_seen,
      current_game_mode: friend.player_presence[0].current_game_mode,
      current_session_id: friend.player_presence[0].current_session_id,
      steam_status: friend.player_presence[0].steam_status
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

    const { data: presence, error: presenceError } = await supabase
      .from('player_presence')
      .select('status, last_seen, current_game_mode, current_session_id, steam_status')
      .eq('user_id', userId)
      .single();

    if (presenceError || !presence) {
      return res.json({
        status: 'offline',
        last_seen: null,
        current_game_mode: null,
        current_session_id: null,
        steam_status: {}
      });
    }

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

    // Check if requested users are friends (privacy control)
    const { data: friendRelationships, error: friendsError } = await supabase
      .from('friends')
      .select('user_id, friend_id')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('friendship_status', 'active');

    if (friendsError) {
      winston.error('Failed to check friend relationships:', friendsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to check friend relationships'
        }
      });
    }

    // Filter requested userIds to only friends
    const friendIds = friendRelationships
      .map(rel => rel.user_id === userId ? rel.friend_id : rel.user_id)
      .filter(friendId => userIds.includes(friendId));

    if (friendIds.length === 0) {
      return res.json({
        users: [],
        requested_count: userIds.length,
        accessible_count: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Get presence for friends only
    const { data: presenceData, error: presenceError } = await supabase
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
      .in('id', friendIds);

    if (presenceError) {
      winston.error('Failed to get bulk presence:', presenceError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get presence data'
        }
      });
    }

    const presenceMap = {};
    presenceData.forEach(user => {
      presenceMap[user.id] = {
        user_id: user.id,
        username: user.username,
        status: user.player_presence?.[0]?.status || 'offline',
        last_seen: user.player_presence?.[0]?.last_seen,
        current_game_mode: user.player_presence?.[0]?.current_game_mode,
        current_session_id: user.player_presence?.[0]?.current_session_id
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
    // Get active session IDs first
    const { data: activeSessions, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id')
      .in('status', ['waiting', 'active']);

    if (sessionError) {
      winston.error('Failed to get active sessions for cleanup:', sessionError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get active sessions'
        }
      });
    }

    const activeSessionIds = activeSessions.map(session => session.id);

    // Mark users as offline if they haven't been seen in 10 minutes
    // and aren't in an active session
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    let updateQuery = supabase
      .from('player_presence')
      .update({
        status: 'offline',
        last_seen: new Date().toISOString()
      })
      .in('status', ['online', 'away', 'in_game', 'in_menu'])
      .lt('last_seen', tenMinutesAgo);

    // Add condition for active sessions
    if (activeSessionIds.length > 0) {
      updateQuery = updateQuery.or(`current_session_id.is.null,current_session_id.not.in.(${activeSessionIds.join(',')})`);
    } else {
      updateQuery = updateQuery.is('current_session_id', null);
    }

    const { data: updatedRecords, error: updateError } = await updateQuery.select('id');

    if (updateError) {
      winston.error('Failed to cleanup stale presence:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to cleanup stale presence'
        }
      });
    }

    const updatedCount = updatedRecords ? updatedRecords.length : 0;

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
