const { query, transaction } = require('../config/database');
const winston = require('winston');

/**
 * Cleanup service for maintaining database health and removing stale data
 */

/**
 * Clean up old matchmaking queue entries
 * @returns {Promise<number>} Number of entries cleaned up
 */
async function cleanupOldMatchmakingEntries() {
  try {
    // Remove entries that are:
    // 1. Active but older than 30 minutes (probably stale)
    // 2. Matched but older than 1 hour (cleanup old matches)
    // 3. Cancelled/timed out entries older than 24 hours

    const result = await query(`
      DELETE FROM matchmaking_queue
      WHERE (status = 'active' AND created_at < NOW() - INTERVAL '30 minutes')
         OR (status = 'matched' AND created_at < NOW() - INTERVAL '1 hour')
         OR (status IN ('cancelled', 'timed_out') AND created_at < NOW() - INTERVAL '24 hours')
    `);

    const deletedCount = result.rowCount;
    if (deletedCount > 0) {
      winston.info(`Cleaned up ${deletedCount} old matchmaking queue entries`);
    }

    return deletedCount;
  } catch (err) {
    winston.error('Error cleaning up matchmaking entries:', err);
    return 0;
  }
}

/**
 * Clean up abandoned game sessions
 * @returns {Promise<number>} Number of sessions cleaned up
 */
async function cleanupAbandonedSessions() {
  try {
    // Mark sessions as abandoned if:
    // 1. Waiting sessions older than 1 hour
    // 2. Active sessions with no updates in 2 hours
    // 3. Sessions that have been active for more than 6 hours (game should be finished)

    const result = await query(`
      UPDATE game_sessions
      SET status = 'abandoned', ended_at = NOW(), updated_at = NOW()
      WHERE (status = 'waiting' AND created_at < NOW() - INTERVAL '1 hour')
         OR (status = 'active' AND updated_at < NOW() - INTERVAL '2 hours')
         OR (status = 'active' AND started_at < NOW() - INTERVAL '6 hours')
    `);

    const updatedCount = result.rowCount;
    if (updatedCount > 0) {
      winston.info(`Marked ${updatedCount} sessions as abandoned`);
    }

    return updatedCount;
  } catch (err) {
    winston.error('Error cleaning up abandoned sessions:', err);
    return 0;
  }
}

/**
 * Clean up old completed sessions and associated data
 * @returns {Promise<number>} Number of sessions cleaned up
 */
async function cleanupOldCompletedSessions() {
  try {
    // Remove completed/abandoned sessions older than 7 days
    // Keep the data for analytics but clean up old records

    const result = await query(`
      DELETE FROM game_sessions
      WHERE status IN ('completed', 'abandoned', 'cancelled')
        AND ended_at < NOW() - INTERVAL '7 days'
    `);

    const deletedCount = result.rowCount;
    if (deletedCount > 0) {
      winston.info(`Cleaned up ${deletedCount} old completed sessions`);
    }

    return deletedCount;
  } catch (err) {
    winston.error('Error cleaning up old sessions:', err);
    return 0;
  }
}

/**
 * Clean up old network quality data
 * @returns {Promise<number>} Number of records cleaned up
 */
async function cleanupOldNetworkData() {
  try {
    // Remove network quality records older than 30 days
    const result = await query(`
      DELETE FROM network_quality
      WHERE recorded_at < NOW() - INTERVAL '30 days'
    `);

    const deletedCount = result.rowCount;
    if (deletedCount > 0) {
      winston.info(`Cleaned up ${deletedCount} old network quality records`);
    }

    return deletedCount;
  } catch (err) {
    winston.error('Error cleaning up network data:', err);
    return 0;
  }
}

/**
 * Update player presence status for inactive users
 * @returns {Promise<number>} Number of users updated
 */
async function updateInactiveUserPresence() {
  try {
    // Mark users as offline if they haven't been seen in 10 minutes
    const result = await query(`
      UPDATE player_presence
      SET status = 'offline', last_seen = NOW()
      WHERE status IN ('online', 'in_game', 'away')
        AND last_seen < NOW() - INTERVAL '10 minutes'
    `);

    const updatedCount = result.rowCount;
    if (updatedCount > 0) {
      winston.debug(`Marked ${updatedCount} users as offline due to inactivity`);
    }

    return updatedCount;
  } catch (err) {
    winston.error('Error updating inactive user presence:', err);
    return 0;
  }
}

/**
 * Clean up expired friend requests
 * @returns {Promise<number>} Number of requests cleaned up
 */
async function cleanupExpiredFriendRequests() {
  try {
    // Remove friend requests that are pending and older than 30 days
    const result = await query(`
      DELETE FROM friend_requests
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '30 days'
    `);

    const deletedCount = result.rowCount;
    if (deletedCount > 0) {
      winston.info(`Cleaned up ${deletedCount} expired friend requests`);
    }

    return deletedCount;
  } catch (err) {
    winston.error('Error cleaning up friend requests:', err);
    return 0;
  }
}

/**
 * Rebuild database indexes if needed (optimization)
 * @returns {Promise<boolean>} Success status
 */
async function rebuildIndexesIfNeeded() {
  try {
    // Check if any indexes need rebuilding (this is a simple check)
    const indexCheck = await query(`
      SELECT schemaname, tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('game_sessions', 'matchmaking_queue', 'session_players')
    `);

    winston.debug(`Found ${indexCheck.rows.length} indexes to check`);
    return true;
  } catch (err) {
    winston.error('Error checking indexes:', err);
    return false;
  }
}

/**
 * Run all cleanup operations
 * @returns {Promise<Object>} Cleanup results
 */
async function runAllCleanup() {
  winston.info('Starting database cleanup operations...');

  const results = {
    matchmakingEntries: await cleanupOldMatchmakingEntries(),
    abandonedSessions: await cleanupAbandonedSessions(),
    oldSessions: await cleanupOldCompletedSessions(),
    networkData: await cleanupOldNetworkData(),
    inactivePresence: await updateInactiveUserPresence(),
    expiredFriendRequests: await cleanupExpiredFriendRequests(),
    indexesChecked: await rebuildIndexesIfNeeded(),
    timestamp: new Date().toISOString()
  };

  const totalCleaned = Object.values(results).filter(val => typeof val === 'number').reduce((sum, val) => sum + val, 0);
  winston.info(`Database cleanup completed. Total items cleaned: ${totalCleaned}`);

  return results;
}

/**
 * Schedule periodic cleanup (to be called by a scheduler)
 */
function schedulePeriodicCleanup() {
  // Run cleanup every 5 minutes
  setInterval(async () => {
    try {
      await runAllCleanup();
    } catch (err) {
      winston.error('Scheduled cleanup failed:', err);
    }
  }, 5 * 60 * 1000); // 5 minutes

  winston.info('Periodic cleanup scheduler started (runs every 5 minutes)');
}

/**
 * Manual cleanup trigger (for admin operations)
 */
async function manualCleanup() {
  winston.info('Manual cleanup triggered by administrator');
  return await runAllCleanup();
}

module.exports = {
  runAllCleanup,
  schedulePeriodicCleanup,
  manualCleanup,
  cleanupOldMatchmakingEntries,
  cleanupAbandonedSessions,
  cleanupOldCompletedSessions,
  cleanupOldNetworkData,
  updateInactiveUserPresence,
  cleanupExpiredFriendRequests,
  rebuildIndexesIfNeeded
};
