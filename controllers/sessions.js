const { supabase } = require('../config/database');
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
    let existingSession = null;
    try {
      console.log('🔍 Checking existing sessions for user:', hostUserId);
      const { data: existingSessionPlayers, error: sessionError } = await supabase
        .from('session_players')
        .select('session_id')
        .eq('user_id', hostUserId);

      console.log('📊 Session players query result:', {
        hasData: !!existingSessionPlayers,
        dataLength: existingSessionPlayers?.length,
        hasError: !!sessionError,
        error: sessionError?.message
      });

      if (sessionError) {
        // If table doesn't exist or other error, just proceed (user can't be in a session that doesn't exist)
        console.log('⚠️ Session players query failed, proceeding anyway:', sessionError.message);
        winston.warn('Could not check existing sessions, proceeding anyway:', sessionError.message);
      } else if (existingSessionPlayers && existingSessionPlayers.length > 0) {
        // If user is in sessions, check if any are active
        console.log('🎮 User is in sessions, checking active ones:', existingSessionPlayers.length);
        const sessionIds = existingSessionPlayers.map(sp => sp.session_id);
        const { data: activeSessions, error: activeError } = await supabase
          .from('game_sessions')
          .select('id, status')
          .in('id', sessionIds)
          .in('status', ['waiting', 'active'])
          .order('created_at', { ascending: false })
          .limit(1);

        console.log('🎯 Active sessions query result:', {
          hasData: !!activeSessions,
          dataLength: activeSessions?.length,
          hasError: !!activeError,
          error: activeError?.message
        });

        if (activeError) {
          console.log('💥 Failed to check active sessions:', activeError);
          winston.error('Failed to check active sessions:', activeError);
          return res.status(500).json({
            error: {
              code: 'SERVER_ERROR',
              message: 'Failed to check active sessions'
            }
          });
        }

        existingSession = activeSessions && activeSessions.length > 0 ? activeSessions[0] : null;
        console.log('✅ Existing session check complete:', !!existingSession);
      } else {
        console.log('ℹ️ User not in any sessions');
      }
    } catch (err) {
      // If any unexpected error, just log and continue
      console.log('💥 Unexpected error checking sessions:', err.message);
      winston.warn('Error checking existing sessions, proceeding anyway:', err.message);
    }

    if (existingSession) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is already in an active session',
          session_id: existingSession.id
        }
      });
    }

    // Create the session
    const { data: session, error: insertError } = await supabase
      .from('game_sessions')
      .insert([{
        host_user_id: hostUserId,
        game_mode: gameMode,
        region: region,
        max_players: maxPlayers,
        current_players: 1,
        player_ids: [hostUserId],
        status: 'waiting',
        session_data: {
          ...sessionData,
          isPrivate,
          password: isPrivate && password ? password : null
        }
      }])
      .select('id, created_at')
      .single();

    if (insertError) {
      winston.error('Failed to create session:', insertError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to create session'
        }
      });
    }

    // Add host as first player
    const { error: playerError } = await supabase
      .from('session_players')
      .insert([{
        session_id: session.id,
        user_id: hostUserId,
        player_status: 'ready',
        joined_at: new Date().toISOString()
      }]);

    if (playerError) {
      winston.error('Failed to add host as player:', playerError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to add host to session'
        }
      });
    }

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
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, host_user_id, game_mode, region, max_players, current_players, player_ids, status, session_data')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

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
    let otherActiveSession = null;
    try {
      const { data: userSessionPlayers, error: userSessionError } = await supabase
        .from('session_players')
        .select('session_id')
        .eq('user_id', userId)
        .neq('session_id', sessionId);

      if (userSessionError) {
        winston.warn('Could not check user existing sessions, proceeding anyway:', userSessionError.message);
      } else if (userSessionPlayers && userSessionPlayers.length > 0) {
        // Check if any of these sessions are active
        const otherSessionIds = userSessionPlayers.map(sp => sp.session_id);
        const { data: activeOtherSessions, error: activeError } = await supabase
          .from('game_sessions')
          .select('id, status')
          .in('id', otherSessionIds)
          .in('status', ['waiting', 'active'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (activeError) {
          winston.error('Failed to check active other sessions:', activeError);
          return res.status(500).json({
            error: {
              code: 'SERVER_ERROR',
              message: 'Failed to check user sessions'
            }
          });
        }

        otherActiveSession = activeOtherSessions && activeOtherSessions.length > 0 ? activeOtherSessions[0] : null;
      }
    } catch (err) {
      winston.warn('Error checking user other sessions, proceeding anyway:', err.message);
    }

    if (otherActiveSession) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'User is already in another session',
          current_session_id: otherActiveSession.id
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

    // Update session
    const sessionUpdateData = {
      player_ids: newPlayerIds,
      current_players: newPlayerCount,
      updated_at: new Date().toISOString()
    };

    // If session is now full, start it
    if (newPlayerCount >= session.max_players) {
      sessionUpdateData.status = 'active';
      sessionUpdateData.started_at = new Date().toISOString();
    }

    const { error: updateSessionError } = await supabase
      .from('game_sessions')
      .update(sessionUpdateData)
      .eq('id', sessionId);

    if (updateSessionError) {
      winston.error('Failed to update session for join:', updateSessionError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update session'
        }
      });
    }

    // Add player record
    const { error: addPlayerError } = await supabase
      .from('session_players')
      .insert([{
        session_id: sessionId,
        user_id: userId,
        player_status: 'joined',
        joined_at: new Date().toISOString()
      }]);

    if (addPlayerError) {
      winston.error('Failed to add player to session:', addPlayerError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to add player to session'
        }
      });
    }

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
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, host_user_id, player_ids, current_players, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

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

    // Update session
    if (newPlayerCount === 0) {
      // Last player leaving, end the session
      const { error: endSessionError } = await supabase
        .from('game_sessions')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (endSessionError) {
        winston.error('Failed to end session:', endSessionError);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Failed to end session'
          }
        });
      }
    } else {
      // Update session player list
      const updateData = {
        player_ids: newPlayerIds,
        current_players: newPlayerCount,
        updated_at: new Date().toISOString()
      };

      // If host is leaving, assign new host
      if (session.host_user_id === userId && newPlayerCount > 0) {
        updateData.host_user_id = newPlayerIds[0];
      }

      const { error: updateSessionError } = await supabase
        .from('game_sessions')
        .update(updateData)
        .eq('id', sessionId);

      if (updateSessionError) {
        winston.error('Failed to update session:', updateSessionError);
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Failed to update session'
          }
        });
      }
    }

    // Update player status
    const { error: updatePlayerError } = await supabase
      .from('session_players')
      .update({
        player_status: 'left',
        disconnected_at: new Date().toISOString()
      })
      .eq('session_id', sessionId)
      .eq('user_id', userId);

    if (updatePlayerError) {
      winston.error('Failed to update player status:', updatePlayerError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update player status'
        }
      });
    }

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

    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select(`
        id, host_user_id, game_mode, region, max_players,
        current_players, player_ids, status, session_data,
        created_at, started_at, ended_at
      `)
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    // Get host user details
    const { data: hostUser, error: hostError } = await supabase
      .from('users')
      .select('username')
      .eq('id', session.host_user_id)
      .single();

    session.host_username = hostUser?.username;

    // Get player details
    const { data: playersData, error: playersError } = await supabase
      .from('session_players')
      .select(`
        user_id,
        player_status,
        joined_at,
        disconnected_at
      `)
      .eq('session_id', sessionId)
      .order('joined_at', { ascending: true });

    // Get user details for players
    const userIds = playersData?.map(p => p.user_id) || [];
    let userDetails = {};
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username, profile_data')
        .in('id', userIds);

      if (!usersError && usersData) {
        userDetails = usersData.reduce((acc, user) => {
          acc[user.id] = user;
          return acc;
        }, {});
      }
    }

    if (playersError) {
      winston.error('Failed to get player details:', playersError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get player details'
        }
      });
    }

    const players = playersData.map(player => {
      const userDetail = userDetails[player.user_id] || {};
      return {
        user_id: player.user_id,
        username: userDetail.username,
        status: player.player_status,
        joined_at: player.joined_at,
        disconnected_at: player.disconnected_at,
        profile_data: userDetail.profile_data
      };
    });

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

    // Build Supabase query
    let query = supabase
      .from('game_sessions')
      .select(`
        id, host_user_id, game_mode, region, max_players,
        current_players, status, created_at, session_data
      `)
      .eq('status', status)
      .order('created_at', { ascending: false });

    // Apply filters
    if (gameMode) {
      query = query.eq('game_mode', gameMode);
    }

    if (region && region !== 'global') {
      query = query.eq('region', region);
    }

    // Exclude private sessions (simplified for now)
    // TODO: Fix private session filtering
    // query = query.not('session_data->>isPrivate', 'is', true);

    const { data: sessionsData, error: sessionsError } = await query
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (sessionsError) {
      winston.error('Failed to list sessions:', sessionsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to list sessions'
        }
      });
    }

    const sessions = sessionsData.map(session => ({
      session_id: session.id,
      host: {
        user_id: session.host_user_id
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
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('host_user_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found'
        }
      });
    }

    session.current_status = session.status;

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

    const { error: updateError } = await supabase
      .from('game_sessions')
      .update({
        status: updateData.status,
        updated_at: updateData.updated_at,
        started_at: updateData.started_at || null,
        ended_at: updateData.ended_at || null,
        session_data: sessionData || {}
      })
      .eq('id', sessionId);

    if (updateError) {
      winston.error('Failed to update session status:', updateError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to update session status'
        }
      });
    }

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
