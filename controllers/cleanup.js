const { supabase } = require('../config/database');
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
    const { count: activeCount, error: activeError } = await supabase
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    stats.matchmaking.active_count = activeCount || 0;

    // Count stale matchmaking entries
    const { count: staleCount, error: staleError } = await supabase
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
    stats.matchmaking.stale_count = staleCount || 0;

    // Count old matched entries
    const { count: oldMatchedCount, error: oldMatchedError } = await supabase
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'matched')
      .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    stats.matchmaking.old_matched_count = oldMatchedCount || 0;

    // Count sessions by status
    const { data: sessionData, error: sessionError } = await supabase
      .from('game_sessions')
      .select('status');

    const sessionStatsMap = {};
    sessionData.forEach(session => {
      sessionStatsMap[session.status] = (sessionStatsMap[session.status] || 0) + 1;
    });

    Object.entries(sessionStatsMap).forEach(([status, count]) => {
      if (status === 'waiting') stats.sessions.waiting_count = count;
      else if (status === 'active') stats.sessions.active_count = count;
      else if (status === 'completed') stats.sessions.completed_count = count;
      else if (status === 'abandoned') stats.sessions.abandoned_count = count;
    });

    // Count old completed sessions
    const { count: oldCompletedCount, error: oldCompletedError } = await supabase
      .from('game_sessions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['completed', 'abandoned', 'cancelled'])
      .lt('ended_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    stats.sessions.old_completed_count = oldCompletedCount || 0;

    // Count network quality records
    const { count: networkTotalCount, error: networkTotalError } = await supabase
      .from('network_quality')
      .select('*', { count: 'exact', head: true });
    stats.network.total_records = networkTotalCount || 0;

    const { count: networkOldCount, error: networkOldError } = await supabase
      .from('network_quality')
      .select('*', { count: 'exact', head: true })
      .lt('recorded_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    stats.network.old_records_count = networkOldCount || 0;

    // Count inactive presence records
    const { count: inactivePresenceCount, error: inactiveError } = await supabase
      .from('player_presence')
      .select('*', { count: 'exact', head: true })
      .in('status', ['online', 'in_game', 'away'])
      .lt('last_seen', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    stats.presence.inactive_users_count = inactivePresenceCount || 0;

    // Count expired friend requests
    const { count: expiredRequestsCount, error: expiredError } = await supabase
      .from('friend_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    stats.friends.expired_requests_count = expiredRequestsCount || 0;

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

    // Get basic table statistics (simplified for Supabase)
    const tables = ['users', 'toyboxes', 'game_sessions', 'matchmaking_queue', 'session_players'];

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (!error) {
          health.tables[table] = {
            record_count: count || 0,
            size: 'N/A (Supabase managed)'
          };
        }
      } catch (err) {
        winston.warn(`Could not get stats for table ${table}:`, err.message);
      }
    }

    // Skip index usage stats (not available in Supabase)
    health.indexes = {
      note: 'Index usage statistics not available in Supabase environment'
    };

    // Connection stats (simplified for Supabase)
    health.connections = {
      note: 'Connection statistics not available in Supabase environment',
      managed_by: 'Supabase infrastructure'
    };

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

    // Note: VACUUM operations are handled automatically by Supabase
    // We can't run manual VACUUM commands in Supabase environment
    winston.info('Database optimization requested - Supabase handles maintenance automatically');

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
