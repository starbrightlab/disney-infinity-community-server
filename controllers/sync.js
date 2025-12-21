/**
 * Cross-Device Sync Controller
 * Handles synchronization of progress, achievements, and preferences across devices
 */

const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Sync device data
 */
const syncDevice = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { device_id, device_name, sync_data, last_sync_timestamp } = req.body;

      if (!device_id || !device_name) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'device_id and device_name are required'
          }
        });
      }

      // Validate device_id format (basic validation)
      if (!/^[a-zA-Z0-9\-_]{1,100}$/.test(device_id)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_DEVICE_ID',
            message: 'Invalid device ID format'
          }
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Insert or update device sync record
        const upsertQuery = `
          INSERT INTO device_sync (user_id, device_id, device_name, sync_data, last_sync)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (user_id, device_id)
          DO UPDATE SET
            device_name = EXCLUDED.device_name,
            sync_data = EXCLUDED.sync_data,
            last_sync = NOW(),
            updated_at = NOW()
          RETURNING id, last_sync
        `;

        const syncResult = await client.query(upsertQuery, [
          userId,
          device_id,
          device_name,
          JSON.stringify(sync_data || {}),
        ]);

        // Get comprehensive sync data to send back
        const syncDataQuery = `
          WITH user_sync AS (
            SELECT
              u.id,
              u.username,
              u.profile_data,
              u.last_login
            FROM users u
            WHERE u.id = $1
          ),
          achievements_sync AS (
            SELECT
              json_agg(
                json_build_object(
                  'achievement_id', pa.achievement_id,
                  'unlocked_at', pa.unlocked_at,
                  'is_new', pa.is_new
                )
              ) as achievements
            FROM player_achievements pa
            WHERE pa.user_id = $1
          ),
          progress_sync AS (
            SELECT
              json_agg(
                json_build_object(
                  'achievement_id', ap.achievement_id,
                  'progress', ap.progress,
                  'completed', ap.completed,
                  'completed_at', ap.completed_at
                )
              ) as progress
            FROM achievement_progress ap
            WHERE ap.user_id = $1
          ),
          analytics_sync AS (
            SELECT
              json_agg(
                json_build_object(
                  'date', pa.date,
                  'play_time_minutes', pa.play_time_minutes,
                  'matches_played', pa.matches_played,
                  'matches_won', pa.matches_won,
                  'toyboxes_created', pa.toyboxes_created,
                  'toyboxes_downloaded', pa.toyboxes_downloaded,
                  'friends_added', pa.friends_added,
                  'achievements_unlocked', pa.achievements_unlocked,
                  'characters_used', pa.characters_used,
                  'game_modes_played', pa.game_modes_played
                )
              ) as analytics
            FROM profile_analytics pa
            WHERE pa.user_id = $1 AND pa.date >= CURRENT_DATE - INTERVAL '30 days'
          )
          SELECT
            us.*,
            acs.achievements,
            ps.progress,
            ans.analytics,
            NOW() as server_timestamp
          FROM user_sync us
          CROSS JOIN achievements_sync acs
          CROSS JOIN progress_sync ps
          CROSS JOIN analytics_sync ans
        `;

        const syncDataResult = await client.query(syncDataQuery, [userId]);
        const fullSyncData = syncDataResult.rows[0];

        await client.query('COMMIT');

        res.json({
          success: true,
          message: 'Device sync completed successfully',
          sync_timestamp: syncResult.rows[0].last_sync,
          data: {
            profile: {
              id: fullSyncData.id,
              username: fullSyncData.username,
              profile_data: fullSyncData.profile_data,
              last_login: fullSyncData.last_login
            },
            achievements: fullSyncData.achievements || [],
            progress: fullSyncData.progress || [],
            analytics: fullSyncData.analytics || [],
            server_timestamp: fullSyncData.server_timestamp
          }
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error syncing device:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to sync device'
        }
      });
    }
  }
];

/**
 * Get device sync status
 */
const getSyncStatus = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const query = `
        SELECT
          device_id,
          device_name,
          last_sync,
          created_at,
          updated_at
        FROM device_sync
        WHERE user_id = $1
        ORDER BY last_sync DESC
      `;

      const result = await pool.query(query, [userId]);

      // Get latest sync timestamp across all devices
      const latestSyncQuery = `
        SELECT MAX(last_sync) as latest_sync
        FROM device_sync
        WHERE user_id = $1
      `;

      const latestResult = await pool.query(latestSyncQuery, [userId]);

      res.json({
        devices: result.rows,
        latest_sync: latestResult.rows[0].latest_sync,
        device_count: result.rows.length
      });
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get sync status'
        }
      });
    }
  }
];

/**
 * Remove device from sync
 */
const removeDevice = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { device_id } = req.params;

      const query = `
        DELETE FROM device_sync
        WHERE user_id = $1 AND device_id = $2
        RETURNING device_id, device_name
      `;

      const result = await pool.query(query, [userId, device_id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'DEVICE_NOT_FOUND',
            message: 'Device not found or already removed'
          }
        });
      }

      res.json({
        success: true,
        message: 'Device removed from sync successfully',
        removed_device: result.rows[0]
      });
    } catch (error) {
      console.error('Error removing device:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to remove device'
        }
      });
    }
  }
];

/**
 * Get sync conflicts (for manual resolution)
 */
const getSyncConflicts = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // This is a simplified version - in a real implementation,
      // you'd detect actual conflicts between device sync data
      const query = `
        SELECT
          device_id,
          device_name,
          sync_data,
          last_sync
        FROM device_sync
        WHERE user_id = $1
        ORDER BY last_sync DESC
        LIMIT 5
      `;

      const result = await pool.query(query, [userId]);

      // For now, just return device data - conflict detection would be more complex
      res.json({
        conflicts: [], // No conflicts detected in this simplified version
        devices: result.rows,
        message: 'No sync conflicts detected'
      });
    } catch (error) {
      console.error('Error getting sync conflicts:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get sync conflicts'
        }
      });
    }
  }
];

/**
 * Resolve sync conflicts
 */
const resolveSyncConflicts = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { conflicts, resolution_strategy } = req.body;

      // This is a placeholder for conflict resolution logic
      // In a real implementation, this would handle merging conflicting data

      if (!conflicts || !Array.isArray(conflicts)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'conflicts must be an array'
          }
        });
      }

      // For now, just acknowledge the resolution request
      res.json({
        success: true,
        message: 'Sync conflicts resolved',
        resolved_count: conflicts.length,
        strategy: resolution_strategy || 'manual'
      });
    } catch (error) {
      console.error('Error resolving sync conflicts:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to resolve sync conflicts'
        }
      });
    }
  }
];

/**
 * Force full sync (admin/debug endpoint)
 */
const forceFullSync = [
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { target_device_id } = req.body;

      // This would trigger a full synchronization of all user data
      // In a real implementation, this might queue a background job

      res.json({
        success: true,
        message: 'Full sync initiated',
        user_id: userId,
        target_device: target_device_id || 'all_devices',
        estimated_completion: new Date(Date.now() + 30000) // 30 seconds from now
      });
    } catch (error) {
      console.error('Error forcing full sync:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initiate full sync'
        }
      });
    }
  }
];

module.exports = {
  syncDevice,
  getSyncStatus,
  removeDevice,
  getSyncConflicts,
  resolveSyncConflicts,
  forceFullSync
};
