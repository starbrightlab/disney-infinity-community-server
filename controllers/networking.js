const { supabase } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

/**
 * Networking controller for NAT traversal and P2P connections
 */

/**
 * Get STUN/TURN server configuration
 */
const getIceServers = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;

    // Default public STUN servers (Google's and others)
    const stunServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];

    // TURN servers (these would typically be configured per deployment)
    const turnServers = [];

    // Check if user has a session with TURN credentials
    let turnCredentials = null;
    if (userId) {
      const { data: sessionData, error: sessionError } = await supabase
        .from('session_players')
        .select(`
          game_sessions!inner (
            session_data
          )
        `)
        .eq('user_id', userId)
        .in('game_sessions.status', ['waiting', 'active'])
        .order('game_sessions.created_at', { ascending: false })
        .limit(1)
        .single();

      if (!sessionError && sessionData) {
        const sessionInfo = sessionData.game_sessions?.session_data || {};
        turnCredentials = sessionInfo.turnCredentials;
      }
    }

    // If we have TURN credentials for the user's session, include them
    if (turnCredentials) {
      turnServers.push({
        urls: turnCredentials.urls || ['turn:turn.example.com:3478'],
        username: turnCredentials.username,
        credential: turnCredentials.credential
      });
    }

    const iceServers = [...stunServers, ...turnServers];

    res.json({
      iceServers: iceServers,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get ICE servers error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get ICE server configuration'
      }
    });
  }
};

/**
 * Exchange ICE candidates between peers in a session
 */
const exchangeIceCandidatesValidation = [
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required'),
  body('targetUserId')
    .isUUID()
    .withMessage('Valid target user ID required'),
  body('candidate')
    .isObject()
    .withMessage('ICE candidate object required'),
  body('candidate.candidate')
    .notEmpty()
    .withMessage('Candidate string required'),
  body('candidate.sdpMid')
    .optional()
    .isString()
    .withMessage('sdpMid must be string'),
  body('candidate.sdpMLineIndex')
    .optional()
    .isInt()
    .withMessage('sdpMLineIndex must be integer')
];

const exchangeIceCandidates = async (req, res) => {
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
    const { sessionId, targetUserId, candidate } = req.body;

    // Verify both users are in the same session
    const { data: sessionPlayers, error: sessionError } = await supabase
      .from('session_players')
      .select(`
        game_sessions!inner (
          id,
          status
        )
      `)
      .eq('session_id', sessionId)
      .in('user_id', [userId, targetUserId])
      .in('game_sessions.status', ['waiting', 'active']);

    // Check that both users are in the session
    const userInSession = sessionPlayers.some(sp => sp.user_id === userId);
    const targetInSession = sessionPlayers.some(sp => sp.user_id === targetUserId);

    if (sessionError || !userInSession || !targetInSession) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users are not in the same active session'
        }
      });
    }

    // Store the ICE candidate for the target user
    // In a real implementation, this would be stored in a cache/database
    // and the target user would be notified via WebSocket
    const candidateData = {
      fromUserId: userId,
      toUserId: targetUserId,
      sessionId: sessionId,
      candidate: candidate,
      timestamp: new Date().toISOString()
    };

    // For now, we'll simulate storing this - in production you'd want:
    // 1. Store in Redis/cache with expiration
    // 2. Send WebSocket notification to target user
    // 3. Clean up old candidates periodically

    winston.debug(`ICE candidate exchanged: ${userId} -> ${targetUserId} in session ${sessionId}`);

    // In a WebSocket implementation, you'd emit to the target user's socket
    // io.to(`user_${targetUserId}`).emit('ice-candidate', candidateData);

    res.json({
      status: 'candidate_queued',
      message: 'ICE candidate queued for delivery',
      target_user_id: targetUserId,
      session_id: sessionId
    });

  } catch (err) {
    winston.error('Exchange ICE candidates error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to exchange ICE candidates'
      }
    });
  }
};

/**
 * Report NAT type detection results
 */
const reportNatTypeValidation = [
  body('natType')
    .isIn(['unknown', 'open', 'full-cone', 'restricted-cone', 'port-restricted-cone', 'symmetric'])
    .withMessage('Invalid NAT type'),
  body('publicIp')
    .optional()
    .isIP()
    .withMessage('Invalid public IP address'),
  body('localIp')
    .optional()
    .isIP()
    .withMessage('Invalid local IP address'),
  body('detectionMethod')
    .optional()
    .isIn(['stun', 'turn', 'upnp', 'manual'])
    .withMessage('Invalid detection method')
];

const reportNatType = async (req, res) => {
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
    const { natType, publicIp, localIp, detectionMethod = 'stun' } = req.body;

    // Store NAT information for the user
    const natInfo = {
      natType,
      publicIp,
      localIp,
      detectionMethod,
      detectedAt: new Date().toISOString()
    };

    // Update user's network info in their active session
    const { data: sessionData, error: sessionError } = await supabase
      .from('session_players')
      .select(`
        game_sessions!inner (
          id
        )
      `)
      .eq('user_id', userId)
      .in('game_sessions.status', ['waiting', 'active'])
      .order('game_sessions.created_at', { ascending: false })
      .limit(1);

    if (!sessionError && sessionData && sessionData.length > 0) {
      const sessionId = sessionData[0].game_sessions.id;

      const { error: updateError } = await supabase
        .from('session_players')
        .update({
          network_info: natInfo
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId);

      if (updateError) {
        winston.error('Failed to update network info:', updateError);
      }

      winston.info(`NAT type reported for user ${userId}: ${natType}`);
    }

    res.json({
      status: 'nat_info_updated',
      nat_type: natType,
      detection_method: detectionMethod,
      recorded: true
    });

  } catch (err) {
    winston.error('Report NAT type error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to report NAT type'
      }
    });
  }
};

/**
 * Get network diagnostics for a session
 */
const getNetworkDiagnostics = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Verify user is in the session
    const { data: sessionCheck, error: sessionError } = await supabase
      .from('session_players')
      .select(`
        game_sessions!inner (
          id,
          status
        )
      `)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (sessionError || !sessionCheck) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'User is not in this session'
        }
      });
    }

    // Get network info for all players in the session
    const { data: networkData, error: networkError } = await supabase
      .from('session_players')
      .select(`
        user_id,
        network_info,
        users!session_players_user_id_fkey (
          username
        )
      `)
      .eq('session_id', sessionId);

    if (networkError) {
      winston.error('Failed to get network diagnostics:', networkError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network diagnostics'
        }
      });
    }

    const diagnostics = {
      session_id: sessionId,
      players: networkData.map(player => ({
        user_id: player.user_id,
        username: player.users?.username,
        network_info: player.network_info || {}
      })),
      timestamp: new Date().toISOString()
    };

    res.json(diagnostics);

  } catch (err) {
    winston.error('Get network diagnostics error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get network diagnostics'
      }
    });
  }
};

/**
 * Test connectivity between peers
 */
const testConnectivityValidation = [
  body('targetUserId')
    .isUUID()
    .withMessage('Valid target user ID required'),
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required')
];

const testConnectivity = async (req, res) => {
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
    const { targetUserId, sessionId } = req.body;

    // Verify both users are in the same session
    const { data: sessionPlayers, error: sessionError } = await supabase
      .from('session_players')
      .select('user_id')
      .eq('session_id', sessionId)
      .in('user_id', [userId, targetUserId]);

    const userInSession = sessionPlayers.some(sp => sp.user_id === userId);
    const targetInSession = sessionPlayers.some(sp => sp.user_id === targetUserId);

    if (sessionError || !userInSession || !targetInSession) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users are not in the same active session'
        }
      });
    }

    // Get network info for both users
    const { data: networkData, error: networkError } = await supabase
      .from('session_players')
      .select('user_id, network_info')
      .eq('session_id', sessionId)
      .in('user_id', [userId, targetUserId]);

    if (networkError) {
      winston.error('Failed to get network info:', networkError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network information'
        }
      });
    }

    const userNetworks = {};
    networkData.forEach(row => {
      userNetworks[row.user_id] = row.network_info || {};
    });

    // Determine connectivity prediction based on NAT types
    const userNat = userNetworks[userId]?.natType || 'unknown';
    const targetNat = userNetworks[targetUserId]?.natType || 'unknown';

    let connectivityPrediction = 'unknown';
    let confidence = 'low';

    if (userNat === 'open' || targetNat === 'open') {
      connectivityPrediction = 'likely_successful';
      confidence = 'high';
    } else if (userNat === 'symmetric' && targetNat === 'symmetric') {
      connectivityPrediction = 'unlikely_direct';
      confidence = 'medium';
    } else if (userNat === 'symmetric' || targetNat === 'symmetric') {
      connectivityPrediction = 'may_require_turn';
      confidence = 'medium';
    } else {
      connectivityPrediction = 'likely_successful';
      confidence = 'medium';
    }

    res.json({
      session_id: sessionId,
      from_user: userId,
      to_user: targetUserId,
      connectivity_prediction: connectivityPrediction,
      confidence: confidence,
      nat_types: {
        [userId]: userNat,
        [targetUserId]: targetNat
      },
      recommended_ice_servers: [
        'stun:stun.l.google.com:19302'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Test connectivity error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to test connectivity'
      }
    });
  }
};

/**
 * Report connection establishment result
 */
const reportConnectionResultValidation = [
  body('targetUserId')
    .isUUID()
    .withMessage('Valid target user ID required'),
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID required'),
  body('connectionType')
    .isIn(['direct', 'stun', 'turn', 'failed'])
    .withMessage('Invalid connection type'),
  body('success')
    .isBoolean()
    .withMessage('Success flag required'),
  body('latencyMs')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Latency must be non-negative integer'),
  body('packetLoss')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Packet loss must be 0-100 percent')
];

const reportConnectionResult = async (req, res) => {
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
    const { targetUserId, sessionId, connectionType, success, latencyMs, packetLoss } = req.body;

    // Store connection result in network quality table
    const { error: insertError } = await supabase
      .from('network_quality')
      .insert([{
        user_id: userId,
        session_id: sessionId,
        ping_ms: latencyMs || null,
        packet_loss_percent: packetLoss || null,
        connection_type: connectionType,
        connection_quality: success ? 'excellent' : 'poor',
        recorded_at: new Date().toISOString()
      }]);

    if (insertError) {
      winston.error('Failed to record connection result:', insertError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to record connection result'
        }
      });
    }

    winston.info(`Connection result reported: ${userId} -> ${targetUserId}, type: ${connectionType}, success: ${success}`);

    res.json({
      status: 'connection_result_recorded',
      session_id: sessionId,
      connection_type: connectionType,
      success: success,
      recorded: true
    });

  } catch (err) {
    winston.error('Report connection result error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to report connection result'
      }
    });
  }
};

/**
 * Get session network diagnostics
 */
const getSessionNetworkDiagnostics = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Verify user is in the session
    const { data: sessionCheck, error: sessionError } = await supabase
      .from('session_players')
      .select(`
        game_sessions!inner (
          id,
          status
        )
      `)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (sessionError || !sessionCheck) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'User is not in this session'
        }
      });
    }

    // Get network quality data for all players in the session
    const { data: networkData, error: networkError } = await supabase
      .from('network_quality')
      .select(`
        user_id,
        ping_ms,
        packet_loss_percent,
        connection_type,
        nat_type,
        connection_quality,
        recorded_at,
        users!network_quality_user_id_fkey (
          username
        )
      `)
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: false });

    if (networkError) {
      winston.error('Failed to get network diagnostics:', networkError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network diagnostics'
        }
      });
    }

    // Aggregate network data
    const playerNetworks = {};
    networkData.forEach(row => {
      if (!playerNetworks[row.user_id]) {
        playerNetworks[row.user_id] = {
          user_id: row.user_id,
          username: row.username,
          measurements: []
        };
      }

      playerNetworks[row.user_id].measurements.push({
        ping_ms: row.ping_ms,
        packet_loss_percent: row.packet_loss_percent,
        connection_type: row.connection_type,
        nat_type: row.nat_type,
        connection_quality: row.connection_quality,
        recorded_at: row.recorded_at
      });
    });

    // Calculate session network health
    const allMeasurements = networkResult.rows;
    const avgPing = allMeasurements.length > 0
      ? Math.round(allMeasurements.reduce((sum, m) => sum + (m.ping_ms || 0), 0) / allMeasurements.length)
      : null;

    const avgPacketLoss = allMeasurements.length > 0
      ? Math.round(allMeasurements.reduce((sum, m) => sum + (m.packet_loss_percent || 0), 0) / allMeasurements.length * 100) / 100
      : null;

    const connectionTypes = {};
    allMeasurements.forEach(m => {
      connectionTypes[m.connection_type] = (connectionTypes[m.connection_type] || 0) + 1;
    });

    // Determine overall session network quality
    let overallQuality = 'unknown';
    if (allMeasurements.length > 0) {
      const excellentCount = allMeasurements.filter(m => m.connection_quality === 'excellent').length;
      const goodCount = allMeasurements.filter(m => m.connection_quality === 'good').length;
      const fairCount = allMeasurements.filter(m => m.connection_quality === 'fair').length;

      const qualityScore = (excellentCount * 3 + goodCount * 2 + fairCount * 1) / allMeasurements.length;
      if (qualityScore >= 2.5) overallQuality = 'excellent';
      else if (qualityScore >= 1.5) overallQuality = 'good';
      else if (qualityScore >= 1) overallQuality = 'fair';
      else overallQuality = 'poor';
    }

    res.json({
      session_id: sessionId,
      overall_quality: overallQuality,
      average_ping_ms: avgPing,
      average_packet_loss_percent: avgPacketLoss,
      connection_type_distribution: connectionTypes,
      player_networks: Object.values(playerNetworks),
      total_measurements: allMeasurements.length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Get session network diagnostics error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get network diagnostics'
      }
    });
  }
};

/**
 * Get network analytics and trends
 */
const getNetworkAnalytics = async (req, res) => {
  try {
    const { hours = 24, gameMode } = req.query;

    let whereClause = `nq.recorded_at >= NOW() - INTERVAL '${parseInt(hours)} hours'`;
    let params = [];
    let paramIndex = 1;

    if (gameMode) {
      whereClause += ` AND s.game_mode = $${paramIndex}`;
      params.push(gameMode);
      paramIndex++;
    }

    // Get network quality trends
    let trendsQuery = supabase
      .from('network_quality')
      .select(`
        recorded_at,
        ping_ms,
        packet_loss_percent,
        connection_quality,
        game_sessions (
          game_mode
        )
      `)
      .gte('recorded_at', new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString())
      .order('recorded_at', { ascending: false })
      .limit(1000); // Get more data for aggregation

    if (gameMode) {
      trendsQuery = trendsQuery.eq('game_sessions.game_mode', gameMode);
    }

    const { data: trendsData, error: trendsError } = await trendsQuery;

    if (trendsError) {
      winston.error('Failed to get network trends:', trendsError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network analytics'
        }
      });
    }

    // Aggregate trends by hour
    const trendsMap = {};
    trendsData.forEach(record => {
      const hour = new Date(record.recorded_at).getHours();
      if (!trendsMap[hour]) {
        trendsMap[hour] = {
          hour,
          measurements: 0,
          ping_sum: 0,
          packet_loss_sum: 0,
          excellent_count: 0,
          good_count: 0,
          fair_count: 0,
          poor_count: 0
        };
      }
      trendsMap[hour].measurements++;
      if (record.ping_ms) trendsMap[hour].ping_sum += record.ping_ms;
      if (record.packet_loss_percent) trendsMap[hour].packet_loss_sum += record.packet_loss_percent;

      switch (record.connection_quality) {
        case 'excellent': trendsMap[hour].excellent_count++; break;
        case 'good': trendsMap[hour].good_count++; break;
        case 'fair': trendsMap[hour].fair_count++; break;
        case 'poor': trendsMap[hour].poor_count++; break;
      }
    });

    const trendsResult = Object.values(trendsMap)
      .map(trend => ({
        hour: trend.hour,
        measurements: trend.measurements,
        avg_ping: Math.round(trend.ping_sum / trend.measurements) || 0,
        avg_packet_loss: Math.round((trend.packet_loss_sum / trend.measurements) * 100) / 100 || 0,
        excellent_count: trend.excellent_count,
        good_count: trend.good_count,
        fair_count: trend.fair_count,
        poor_count: trend.poor_count
      }))
      .sort((a, b) => b.hour - a.hour)
      .slice(0, 24);

    // Get connection type distribution
    const { data: connectionTypeData, error: connTypeError } = await supabase
      .from('network_quality')
      .select(`
        connection_type,
        ping_ms,
        connection_quality,
        game_sessions (
          game_mode
        )
      `)
      .gte('recorded_at', new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString())
      .not('connection_type', 'is', null);

    if (connTypeError) {
      winston.error('Failed to get connection types:', connTypeError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network analytics'
        }
      });
    }

    // Aggregate connection types (filter by game mode if specified)
    const filteredConnData = gameMode ?
      connectionTypeData.filter(d => d.game_sessions?.game_mode === gameMode) :
      connectionTypeData;

    const connectionTypeMap = {};
    filteredConnData.forEach(record => {
      const type = record.connection_type;
      if (!connectionTypeMap[type]) {
        connectionTypeMap[type] = {
          connection_type: type,
          count: 0,
          ping_sum: 0,
          good_connections: 0
        };
      }
      connectionTypeMap[type].count++;
      if (record.ping_ms) connectionTypeMap[type].ping_sum += record.ping_ms;
      if (['excellent', 'good'].includes(record.connection_quality)) {
        connectionTypeMap[type].good_connections++;
      }
    });

    const connectionTypeResult = Object.values(connectionTypeMap)
      .map(item => ({
        connection_type: item.connection_type,
        count: item.count,
        avg_ping: Math.round(item.ping_sum / item.count) || 0,
        good_connections: item.good_connections
      }))
      .sort((a, b) => b.count - a.count);

    // Get NAT type distribution
    const { data: natTypeData, error: natTypeError } = await supabase
      .from('network_quality')
      .select(`
        nat_type,
        ping_ms,
        game_sessions (
          game_mode
        )
      `)
      .gte('recorded_at', new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString())
      .not('nat_type', 'is', null);

    if (natTypeError) {
      winston.error('Failed to get NAT types:', natTypeError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network analytics'
        }
      });
    }

    // Aggregate NAT types (filter by game mode if specified)
    const filteredNatData = gameMode ?
      natTypeData.filter(d => d.game_sessions?.game_mode === gameMode) :
      natTypeData;

    const natTypeMap = {};
    filteredNatData.forEach(record => {
      const type = record.nat_type;
      if (!natTypeMap[type]) {
        natTypeMap[type] = {
          nat_type: type,
          count: 0,
          ping_sum: 0
        };
      }
      natTypeMap[type].count++;
      if (record.ping_ms) natTypeMap[type].ping_sum += record.ping_ms;
    });

    const natTypeResult = Object.values(natTypeMap)
      .map(item => ({
        nat_type: item.nat_type,
        count: item.count,
        avg_ping: Math.round(item.ping_sum / item.count) || 0
      }))
      .sort((a, b) => b.count - a.count);

    const analytics = {
      time_range_hours: parseInt(hours),
      game_mode_filter: gameMode || null,
      trends: trendsResult.map(row => ({
        hour: row.hour,
        measurements: parseInt(row.measurements),
        avg_ping_ms: parseInt(row.avg_ping) || null,
        avg_packet_loss_percent: parseFloat(row.avg_packet_loss) || null,
        quality_distribution: {
          excellent: parseInt(row.excellent_count),
          good: parseInt(row.good_count),
          fair: parseInt(row.fair_count),
          poor: parseInt(row.poor_count)
        }
      })),
      connection_types: connectionTypeResult.map(row => ({
        type: row.connection_type,
        count: parseInt(row.count),
        avg_ping_ms: parseInt(row.avg_ping) || null,
        good_connections: parseInt(row.good_connections),
        success_rate: row.count > 0 ? Math.round((row.good_connections / row.count) * 100) : 0
      })),
      nat_types: natTypeResult.map(row => ({
        type: row.nat_type,
        count: parseInt(row.count),
        avg_ping_ms: parseInt(row.avg_ping) || null
      })),
      summary: {
        total_measurements: trendsResult.reduce((sum, row) => sum + parseInt(row.measurements), 0),
        avg_ping_across_period: trendsResult.length > 0
          ? Math.round(trendsResult.reduce((sum, row) => sum + (parseInt(row.avg_ping) || 0), 0) / trendsResult.length)
          : null
      },
      timestamp: new Date().toISOString()
    };

    res.json(analytics);

  } catch (err) {
    winston.error('Get network analytics error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get network analytics'
      }
    });
  }
};

/**
 * Get network recommendations for a user
 */
const getNetworkRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's recent network data
    const { data: userNetworkData, error: networkError } = await supabase
      .from('network_quality')
      .select(`
        ping_ms,
        packet_loss_percent,
        connection_type,
        nat_type,
        connection_quality,
        recorded_at
      `)
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(10);

    if (networkError) {
      winston.error('Failed to get user network data:', networkError);
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to get network recommendations'
        }
      });
    }

    const recommendations = {
      user_id: userId,
      recommendations: [],
      network_health_score: 0,
      timestamp: new Date().toISOString()
    };

    if (!userNetworkData || userNetworkData.length === 0) {
      recommendations.recommendations.push({
        type: 'info',
        message: 'No network data available. Play some games to get network recommendations.',
        priority: 'low'
      });
      return res.json(recommendations);
    }

    const measurements = userNetworkData;

    // Analyze ping
    const avgPing = measurements.reduce((sum, m) => sum + (m.ping_ms || 0), 0) / measurements.length;
    if (avgPing > 150) {
      recommendations.recommendations.push({
        type: 'warning',
        message: `High ping detected (${Math.round(avgPing)}ms average). Consider using a wired connection or closer server.`,
        priority: 'high'
      });
    } else if (avgPing > 100) {
      recommendations.recommendations.push({
        type: 'info',
        message: `Moderate ping (${Math.round(avgPing)}ms average). A wired connection may improve performance.`,
        priority: 'medium'
      });
    }

    // Analyze packet loss
    const avgPacketLoss = measurements.reduce((sum, m) => sum + (m.packet_loss_percent || 0), 0) / measurements.length;
    if (avgPacketLoss > 5) {
      recommendations.recommendations.push({
        type: 'warning',
        message: `High packet loss detected (${avgPacketLoss.toFixed(1)}% average). Check your network connection.`,
        priority: 'high'
      });
    }

    // Analyze connection types
    const connectionTypes = {};
    measurements.forEach(m => {
      connectionTypes[m.connection_type] = (connectionTypes[m.connection_type] || 0) + 1;
    });

    const mostCommonType = Object.entries(connectionTypes).sort((a, b) => b[1] - a[1])[0];
    if (mostCommonType && mostCommonType[0] === 'turn') {
      recommendations.recommendations.push({
        type: 'info',
        message: 'Frequently using TURN relay. This indicates NAT traversal issues. Consider port forwarding.',
        priority: 'medium'
      });
    }

    // Calculate network health score (0-100)
    let healthScore = 100;
    if (avgPing > 50) healthScore -= Math.min(30, (avgPing - 50) / 2);
    if (avgPacketLoss > 1) healthScore -= Math.min(40, avgPacketLoss * 4);
    if (mostCommonType && mostCommonType[0] === 'failed') healthScore -= 30;

    recommendations.network_health_score = Math.max(0, Math.round(healthScore));

    // Add positive feedback for good connections
    if (recommendations.recommendations.length === 0) {
      recommendations.recommendations.push({
        type: 'success',
        message: 'Your network connection looks good! Enjoy smooth multiplayer gaming.',
        priority: 'low'
      });
    }

    res.json(recommendations);

  } catch (err) {
    winston.error('Get network recommendations error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get network recommendations'
      }
    });
  }
};

module.exports = {
  getIceServers,
  exchangeIceCandidates,
  reportNatType,
  getNetworkDiagnostics,
  testConnectivity,
  reportConnectionResult,
  getSessionNetworkDiagnostics,
  getNetworkAnalytics,
  getNetworkRecommendations,
  exchangeIceCandidatesValidation,
  reportNatTypeValidation,
  testConnectivityValidation,
  reportConnectionResultValidation
};
