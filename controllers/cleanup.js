const { query } = require('../config/database');
const {
  runAllCleanup,
  manualCleanup,
  cleanupOldMatchmakingEntries,
  cleanupAbandonedSessions,
  cleanupOldCompletedSessions,
  cleanupOldNetworkData,
  updateInactiveUserPresence,
  cleanupExpiredFriendRequests
} = require('../services/cleanup');
const winston = require('winston');

/**
 * Cleanup controller for administrative maintenance operations
 */

/**
 * Get cleanup statistics
 */
const getCleanupStats = async (req, res) => {
  try {
    // Get statistics about what could be cleaned up
    const stats = {
      matchmaking: {
        active_count: 0,
        stale_count: 0,
        old_matched_count: 0
      },
      sessions: {
        waiting_count: 0,
        active_count: 0,
        abandoned_count: 0,
        old_completed_count: 0
      },
      network: {
        total_records: 0,
        old_records_count: 0
      },
      presence: {
        inactive_users_count: 0
      },
      friends: {
        expired_requests_count: 0
      },
      timestamp: new Date().toISOString()
    };

    // Count active matchmaking entries
    const matchmakingActive = await query(`
      SELECT COUNT(*) as count FROM matchmaking_queue WHERE status = 'active'
    `);
    stats.matchmaking.active_count = parseInt(matchmakingActive.rows[0].count);

    // Count stale matchmaking entries
    const matchmakingStale = await query(`
      SELECT COUNT(*) as count FROM matchmaking_queue
      WHERE status = 'active' AND created_at < NOW() - INTERVAL '30 minutes'
    `);
    stats.matchmaking.stale_count = parseInt(matchmakingStale.rows[0].count);

    // Count old matched entries
    const matchmakingOldMatched = await query(`
      SELECT COUNT(*) as count FROM matchmaking_queue
      WHERE status = 'matched' AND created_at < NOW() - INTERVAL '1 hour'
    `);
    stats.matchmaking.old_matched_count = parseInt(matchmakingOldMatched.rows[0].count);

    // Count sessions by status
    const sessionStats = await query(`
      SELECT status, COUNT(*) as count FROM game_sessions GROUP BY status
    `);

    sessionStats.rows.forEach(row => {
      if (row.status === 'waiting') stats.sessions.waiting_count = parseInt(row.count);
      else if (row.status === 'active') stats.sessions.active_count = parseInt(row.count);
      else if (row.status === 'abandoned') stats.sessions.abandoned_count = parseInt(row.count);
    });

    // Count old completed sessions
    const oldCompleted = await query(`
      SELECT COUNT(*) as count FROM game_sessions
      WHERE status IN ('completed', 'abandoned', 'cancelled')
        AND ended_at < NOW() - INTERVAL '7 days'
    `);
    stats.sessions.old_completed_count = parseInt(oldCompleted.rows[0].count);

    // Count network quality records
    const networkTotal = await query(`
      SELECT COUNT(*) as count FROM network_quality
    `);
    stats.network.total_records = parseInt(networkTotal.rows[0].count);

    const networkOld = await query(`
      SELECT COUNT(*) as count FROM network_quality
      WHERE recorded_at < NOW() - INTERVAL '30 days'
    `);
    stats.network.old_records_count = parseInt(networkOld.rows[0].count);

    // Count inactive presence records
    const inactivePresence = await query(`
      SELECT COUNT(*) as count FROM player_presence
      WHERE status IN ('online', 'in_game', 'away')
        AND last_seen < NOW() - INTERVAL '10 minutes'
    `);
    stats.presence.inactive_users_count = parseInt(inactivePresence.rows[0].count);

    // Count expired friend requests
    const expiredRequests = await query(`
      SELECT COUNT(*) as count FROM friend_requests
      WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 days'
    `);
    stats.friends.expired_requests_count = parseInt(expiredRequests.rows[0].count);

    res.json(stats);

  } catch (err) {
    winston.error('Get cleanup stats error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get cleanup statistics'
      }
    });
  }
};

/**
 * Run manual cleanup operation
 */
const runCleanup = async (req, res) => {
  try {
    winston.info(`Manual cleanup triggered by admin user: ${req.user.id}`);

    const results = await manualCleanup();

    res.json({
      status: 'cleanup_completed',
      results: results,
      triggered_by: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Run cleanup error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Cleanup operation failed'
      }
    });
  }
};

/**
 * Get database health metrics
 */
const getDatabaseHealth = async (req, res) => {
  try {
    const health = {
      tables: {},
      indexes: {},
      connections: {},
      timestamp: new Date().toISOString()
    };

    // Check table sizes
    const tableSizes = await query(`
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'toyboxes', 'game_sessions', 'matchmaking_queue', 'session_players')
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);

    tableSizes.rows.forEach(row => {
      health.tables[row.tablename] = {
        size: row.size
      };
    });

    // Check index usage
    const indexUsage = await query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan as scans
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('game_sessions', 'matchmaking_queue', 'session_players')
      ORDER BY idx_scan DESC
      LIMIT 10
    `);

    indexUsage.rows.forEach(row => {
      if (!health.indexes[row.tablename]) {
        health.indexes[row.tablename] = [];
      }
      health.indexes[row.tablename].push({
        name: row.indexname,
        scans: parseInt(row.scans)
      });
    });

    // Check connection stats
    const connectionStats = await query(`
      SELECT
        count(*) as total_connections,
        count(*) filter (where state = 'active') as active_connections,
        count(*) filter (where state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    if (connectionStats.rows.length > 0) {
      const conn = connectionStats.rows[0];
      health.connections = {
        total: parseInt(conn.total_connections),
        active: parseInt(conn.active_connections),
        idle: parseInt(conn.idle_connections)
      };
    }

    res.json(health);

  } catch (err) {
    winston.error('Get database health error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to get database health metrics'
      }
    });
  }
};

/**
 * Optimize database (VACUUM, REINDEX)
 */
const optimizeDatabase = async (req, res) => {
  try {
    winston.info(`Database optimization triggered by admin user: ${req.user.id}`);

    // Run VACUUM on main tables
    await query('VACUUM ANALYZE users');
    await query('VACUUM ANALYZE toyboxes');
    await query('VACUUM ANALYZE game_sessions');
    await query('VACUUM ANALYZE matchmaking_queue');
    await query('VACUUM ANALYZE session_players');

    winston.info('Database optimization completed');

    res.json({
      status: 'optimization_completed',
      tables_optimized: ['users', 'toyboxes', 'game_sessions', 'matchmaking_queue', 'session_players'],
      triggered_by: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    winston.error('Optimize database error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Database optimization failed'
      }
    });
  }
};

module.exports = {
  getCleanupStats,
  runCleanup,
  getDatabaseHealth,
  optimizeDatabase
};
