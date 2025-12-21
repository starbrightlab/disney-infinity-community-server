const jwt = require('jsonwebtoken');
const { query } = require('./config/database');
const winston = require('winston');

/**
 * Socket.io event handlers for real-time multiplayer features
 */

let io; // Will be set when initialized

// Connected clients map: userId -> socket
const connectedClients = new Map();

// Friend presence cache: userId -> {status, lastSeen, currentSessionId}
const friendPresenceCache = new Map();

/**
 * Authenticate socket connection with JWT
 */
function authenticateSocket(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'access') {
      return next(new Error('Invalid token type'));
    }

    socket.userId = decoded.userId;
    next();
  } catch (err) {
    winston.warn(`Socket authentication failed: ${err.message}`);
    next(new Error('Invalid token'));
  }
}

/**
 * Initialize Socket.io server
 */
function initializeSocketServer(socketIo) {
  io = socketIo;

  // Authentication middleware
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const userId = socket.userId;
    winston.info(`User ${userId} connected via WebSocket`);

    // Add to connected clients
    connectedClients.set(userId, socket);

    // Join user's personal room for direct messages
    socket.join(`user_${userId}`);

    // Handle presence updates
    socket.on('presence_update', async (data) => {
      try {
        await handlePresenceUpdate(socket, data);
      } catch (err) {
        winston.error('Presence update error:', err);
        socket.emit('error', { message: 'Presence update failed' });
      }
    });

    // Handle friend status requests
    socket.on('get_friend_presence', async () => {
      try {
        await sendFriendPresenceUpdate(socket);
      } catch (err) {
        winston.error('Friend presence error:', err);
        socket.emit('error', { message: 'Failed to get friend presence' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      winston.info(`User ${userId} disconnected from WebSocket`);
      connectedClients.delete(userId);

      // Update presence to offline
      try {
        await updatePresenceStatus(userId, 'offline');
      } catch (err) {
        winston.error('Presence offline update error:', err);
      }
    });

    // Handle friend requests
    socket.on('friend_request', async (data) => {
      try {
        await handleFriendRequest(socket, data);
      } catch (err) {
        winston.error('Friend request error:', err);
        socket.emit('error', { message: 'Friend request failed' });
      }
    });

    // Handle game invitations
    socket.on('game_invite', async (data) => {
      try {
        await handleGameInvite(socket, data);
      } catch (err) {
        winston.error('Game invite error:', err);
        socket.emit('error', { message: 'Game invitation failed' });
      }
    });

    // Handle typing indicators (for future chat features)
    socket.on('typing_start', (data) => {
      // Forward typing indicators to relevant users
      const { targetUserId } = data;
      if (targetUserId) {
        io.to(`user_${targetUserId}`).emit('user_typing', {
          userId: userId,
          isTyping: true
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { targetUserId } = data;
      if (targetUserId) {
        io.to(`user_${targetUserId}`).emit('user_typing', {
          userId: userId,
          isTyping: false
        });
      }
    });
  });
}

/**
 * Handle presence status updates
 */
async function handlePresenceUpdate(socket, data) {
  const userId = socket.userId;
  const { status, currentGameMode, currentSessionId } = data;

  // Validate status
  const validStatuses = ['online', 'offline', 'away', 'in_game', 'in_menu'];
  if (!validStatuses.includes(status)) {
    throw new Error('Invalid presence status');
  }

  // Update database
  await updatePresenceStatus(userId, status, currentGameMode, currentSessionId);

  // Update cache
  friendPresenceCache.set(userId, {
    status,
    lastSeen: new Date().toISOString(),
    currentSessionId,
    currentGameMode
  });

  // Notify friends
  await notifyFriendsOfPresenceChange(userId, {
    status,
    currentGameMode,
    currentSessionId,
    lastSeen: new Date().toISOString()
  });

  // Confirm update to client
  socket.emit('presence_updated', {
    status,
    currentGameMode,
    currentSessionId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send friend presence updates to a user
 */
async function sendFriendPresenceUpdate(socket) {
  const userId = socket.userId;

  try {
    // Get user's friends
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
        p.current_session_id
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
      ORDER BY u.username
    `, [userId]);

    const friends = friendsResult.rows.map(row => ({
      user_id: row.friend_id,
      username: row.username,
      status: row.status || 'offline',
      last_seen: row.last_seen,
      current_game_mode: row.current_game_mode,
      current_session_id: row.current_session_id
    }));

    socket.emit('friend_presence_update', {
      friends,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Send friend presence update error:', err);
    throw err;
  }
}

/**
 * Update user presence in database
 */
async function updatePresenceStatus(userId, status, currentGameMode = null, currentSessionId = null) {
  const now = new Date();

  await query(`
    INSERT INTO player_presence (
      user_id, status, current_game_mode, current_session_id, last_seen
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      current_game_mode = EXCLUDED.current_game_mode,
      current_session_id = EXCLUDED.current_session_id,
      last_seen = EXCLUDED.last_seen
  `, [userId, status, currentGameMode, currentSessionId, now]);

  winston.debug(`Presence updated for user ${userId}: ${status}`);
}

/**
 * Notify friends of presence change
 */
async function notifyFriendsOfPresenceChange(userId, presenceData) {
  try {
    // Get user's friends
    const friendsResult = await query(`
      SELECT DISTINCT
        CASE
          WHEN f.user_id = $1 THEN f.friend_id
          ELSE f.user_id
        END as friend_id
      FROM friends f
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.friendship_status = 'active'
    `, [userId]);

    // Notify each friend who is online
    friendsResult.rows.forEach(row => {
      const friendId = row.friend_id;
      const friendSocket = connectedClients.get(friendId);

      if (friendSocket) {
        friendSocket.emit('friend_presence_change', {
          user_id: userId,
          ...presenceData
        });
      }
    });

  } catch (err) {
    winston.error('Notify friends error:', err);
    // Don't throw - this shouldn't break the presence update
  }
}

/**
 * Handle friend requests
 */
async function handleFriendRequest(socket, data) {
  const userId = socket.userId;
  const { targetUserId, action, requestId } = data;

  if (action === 'send') {
    // Check if users are already friends
    const existingFriendship = await query(`
      SELECT id FROM friends
      WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        AND friendship_status = 'active'
    `, [userId, targetUserId]);

    if (existingFriendship.rows.length > 0) {
      throw new Error('Users are already friends');
    }

    // Check for existing pending request
    const existingRequest = await query(`
      SELECT id FROM friend_requests
      WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
    `, [userId, targetUserId]);

    if (existingRequest.rows.length > 0) {
      throw new Error('Friend request already sent');
    }

    // Create friend request
    const requestResult = await query(`
      INSERT INTO friend_requests (sender_id, receiver_id, message)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [userId, targetUserId, data.message || null]);

    // Notify target user if online
    const targetSocket = connectedClients.get(targetUserId);
    if (targetSocket) {
      targetSocket.emit('friend_request_received', {
        request_id: requestResult.rows[0].id,
        sender_id: userId,
        message: data.message,
        timestamp: new Date().toISOString()
      });
    }

    socket.emit('friend_request_sent', {
      request_id: requestResult.rows[0].id,
      target_user_id: targetUserId
    });

  } else if (action === 'accept' && requestId) {
    // Accept friend request
    const acceptResult = await query(`
      UPDATE friend_requests
      SET status = 'accepted', updated_at = NOW()
      WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
      RETURNING sender_id
    `, [requestId, userId]);

    if (acceptResult.rows.length === 0) {
      throw new Error('Friend request not found or already processed');
    }

    const senderId = acceptResult.rows[0].sender_id;

    // Create friendship
    await query(`
      INSERT INTO friends (user_id, friend_id)
      VALUES ($1, $2), ($2, $1)
    `, [userId, senderId]);

    // Notify sender if online
    const senderSocket = connectedClients.get(senderId);
    if (senderSocket) {
      senderSocket.emit('friend_request_accepted', {
        accepter_id: userId,
        timestamp: new Date().toISOString()
      });
    }

    socket.emit('friend_added', {
      friend_id: senderId,
      timestamp: new Date().toISOString()
    });

  } else if (action === 'decline' && requestId) {
    // Decline friend request
    await query(`
      UPDATE friend_requests
      SET status = 'declined', updated_at = NOW()
      WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
    `, [requestId, userId]);

    socket.emit('friend_request_declined', {
      request_id: requestId
    });
  }
}

/**
 * Handle game invitations
 */
async function handleGameInvite(socket, data) {
  const userId = socket.userId;
  const { friendId, sessionId } = data;

  // Verify friendship
  const friendshipCheck = await query(`
    SELECT id FROM friends
    WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
      AND friendship_status = 'active'
  `, [userId, friendId]);

  if (friendshipCheck.rows.length === 0) {
    throw new Error('Users are not friends');
  }

  // Verify session exists and user is host
  const sessionCheck = await query(`
    SELECT id, game_mode, status FROM game_sessions
    WHERE id = $1 AND host_user_id = $2 AND status IN ('waiting', 'active')
  `, [sessionId, userId]);

  if (sessionCheck.rows.length === 0) {
    throw new Error('Session not found or user is not host');
  }

  const session = sessionCheck.rows[0];

  // Notify friend if online
  const friendSocket = connectedClients.get(friendId);
  if (friendSocket) {
    friendSocket.emit('game_invitation', {
      session_id: sessionId,
      host_id: userId,
      game_mode: session.game_mode,
      status: session.status,
      timestamp: new Date().toISOString()
    });
  }

  socket.emit('game_invite_sent', {
    friend_id: friendId,
    session_id: sessionId
  });
}

/**
 * Get connected client count (for monitoring)
 */
function getConnectedClientCount() {
  return connectedClients.size;
}

/**
 * Send notification to specific user
 */
function sendNotificationToUser(userId, event, data) {
  const socket = connectedClients.get(userId);
  if (socket) {
    socket.emit(event, data);
  }
}

module.exports = {
  initializeSocketServer,
  updatePresenceStatus,
  getConnectedClientCount,
  sendNotificationToUser
};
