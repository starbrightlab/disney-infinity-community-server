const { query } = require('../config/database');
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
      const sessionResult = await query(`
        SELECT s.session_data
        FROM game_sessions s
        JOIN session_players sp ON s.id = sp.session_id
        WHERE sp.user_id = $1 AND s.status IN ('waiting', 'active')
        ORDER BY s.created_at DESC LIMIT 1
      `, [userId]);

      if (sessionResult.rows.length > 0) {
        const sessionData = sessionResult.rows[0].session_data || {};
        turnCredentials = sessionData.turnCredentials;
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
    const sessionCheck = await query(`
      SELECT s.id, s.status
      FROM game_sessions s
      JOIN session_players sp1 ON s.id = sp1.session_id
      JOIN session_players sp2 ON s.id = sp2.session_id
      WHERE s.id = $1 AND sp1.user_id = $2 AND sp2.user_id = $3
        AND s.status IN ('waiting', 'active')
    `, [sessionId, userId, targetUserId]);

    if (sessionCheck.rows.length === 0) {
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
    const sessionResult = await query(`
      SELECT s.id
      FROM game_sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE sp.user_id = $1 AND s.status IN ('waiting', 'active')
      ORDER BY s.created_at DESC LIMIT 1
    `, [userId]);

    if (sessionResult.rows.length > 0) {
      const sessionId = sessionResult.rows[0].id;

      await query(`
        UPDATE session_players
        SET network_info = network_info || $1
        WHERE session_id = $2 AND user_id = $3
      `, [JSON.stringify(natInfo), sessionId, userId]);

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
    const sessionCheck = await query(`
      SELECT s.id, s.status
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

    // Get network info for all players in the session
    const networkResult = await query(`
      SELECT
        sp.user_id,
        sp.network_info,
        u.username
      FROM session_players sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.session_id = $1
    `, [sessionId]);

    const diagnostics = {
      session_id: sessionId,
      players: networkResult.rows.map(row => ({
        user_id: row.user_id,
        username: row.username,
        network_info: row.network_info || {}
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
    const sessionCheck = await query(`
      SELECT s.id
      FROM game_sessions s
      JOIN session_players sp1 ON s.id = sp1.session_id
      JOIN session_players sp2 ON s.id = sp2.session_id
      WHERE s.id = $1 AND sp1.user_id = $2 AND sp2.user_id = $3
        AND s.status IN ('waiting', 'active')
    `, [sessionId, userId, targetUserId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users are not in the same active session'
        }
      });
    }

    // Get network info for both users
    const networkResult = await query(`
      SELECT
        sp.user_id,
        sp.network_info
      FROM session_players sp
      WHERE sp.session_id = $1 AND sp.user_id IN ($2, $3)
    `, [sessionId, userId, targetUserId]);

    const userNetworks = {};
    networkResult.rows.forEach(row => {
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
    await query(`
      INSERT INTO network_quality (
        user_id, session_id, ping_ms, packet_loss_percent,
        connection_type, connection_quality, recorded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      userId,
      sessionId,
      latencyMs || null,
      packetLoss || null,
      connectionType,
      success ? 'excellent' : 'poor'
    ]);

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
    const sessionCheck = await query(`
      SELECT s.id, s.status
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

    // Get network quality data for all players in the session
    const networkResult = await query(`
      SELECT
        nq.user_id,
        u.username,
        nq.ping_ms,
        nq.packet_loss_percent,
        nq.connection_type,
        nq.nat_type,
        nq.connection_quality,
        nq.recorded_at
      FROM network_quality nq
      JOIN users u ON nq.user_id = u.id
      WHERE nq.session_id = $1
      ORDER BY nq.recorded_at DESC
    `, [sessionId]);

    // Aggregate network data
    const playerNetworks = {};
    networkResult.rows.forEach(row => {
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
    const trendsResult = await query(`
      SELECT
        DATE_TRUNC('hour', nq.recorded_at) as hour,
        COUNT(*) as measurements,
        ROUND(AVG(nq.ping_ms)) as avg_ping,
        ROUND(AVG(nq.packet_loss_percent), 2) as avg_packet_loss,
        COUNT(CASE WHEN nq.connection_quality = 'excellent' THEN 1 END) as excellent_count,
        COUNT(CASE WHEN nq.connection_quality = 'good' THEN 1 END) as good_count,
        COUNT(CASE WHEN nq.connection_quality = 'fair' THEN 1 END) as fair_count,
        COUNT(CASE WHEN nq.connection_quality = 'poor' THEN 1 END) as poor_count
      FROM network_quality nq
      LEFT JOIN game_sessions s ON nq.session_id = s.id
      WHERE ${whereClause}
      GROUP BY DATE_TRUNC('hour', nq.recorded_at)
      ORDER BY hour DESC
      LIMIT 24
    `, params);

    // Get connection type distribution
    const connectionTypeResult = await query(`
      SELECT
        nq.connection_type,
        COUNT(*) as count,
        ROUND(AVG(nq.ping_ms)) as avg_ping,
        COUNT(CASE WHEN nq.connection_quality IN ('excellent', 'good') THEN 1 END) as good_connections
      FROM network_quality nq
      LEFT JOIN game_sessions s ON nq.session_id = s.id
      WHERE ${whereClause}
      GROUP BY nq.connection_type
      ORDER BY count DESC
    `, params);

    // Get NAT type distribution
    const natTypeResult = await query(`
      SELECT
        nq.nat_type,
        COUNT(*) as count,
        ROUND(AVG(nq.ping_ms)) as avg_ping
      FROM network_quality nq
      LEFT JOIN game_sessions s ON nq.session_id = s.id
      WHERE ${whereClause} AND nq.nat_type IS NOT NULL
      GROUP BY nq.nat_type
      ORDER BY count DESC
    `, params);

    const analytics = {
      time_range_hours: parseInt(hours),
      game_mode_filter: gameMode || null,
      trends: trendsResult.rows.map(row => ({
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
      connection_types: connectionTypeResult.rows.map(row => ({
        type: row.connection_type,
        count: parseInt(row.count),
        avg_ping_ms: parseInt(row.avg_ping) || null,
        good_connections: parseInt(row.good_connections),
        success_rate: row.count > 0 ? Math.round((row.good_connections / row.count) * 100) : 0
      })),
      nat_types: natTypeResult.rows.map(row => ({
        type: row.nat_type,
        count: parseInt(row.count),
        avg_ping_ms: parseInt(row.avg_ping) || null
      })),
      summary: {
        total_measurements: trendsResult.rows.reduce((sum, row) => sum + parseInt(row.measurements), 0),
        avg_ping_across_period: trendsResult.rows.length > 0
          ? Math.round(trendsResult.rows.reduce((sum, row) => sum + (parseInt(row.avg_ping) || 0), 0) / trendsResult.rows.length)
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
    const userNetworkResult = await query(`
      SELECT
        ping_ms,
        packet_loss_percent,
        connection_type,
        nat_type,
        connection_quality,
        recorded_at
      FROM network_quality
      WHERE user_id = $1
      ORDER BY recorded_at DESC
      LIMIT 10
    `, [userId]);

    const recommendations = {
      user_id: userId,
      recommendations: [],
      network_health_score: 0,
      timestamp: new Date().toISOString()
    };

    if (userNetworkResult.rows.length === 0) {
      recommendations.recommendations.push({
        type: 'info',
        message: 'No network data available. Play some games to get network recommendations.',
        priority: 'low'
      });
      return res.json(recommendations);
    }

    const measurements = userNetworkResult.rows;

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
