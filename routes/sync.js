/**
 * Sync Routes
 * API endpoints for cross-device synchronization
 */

const express = require('express');
const router = express.Router();
const {
  syncDevice,
  getSyncStatus,
  removeDevice,
  getSyncConflicts,
  resolveSyncConflicts,
  forceFullSync
} = require('../controllers/sync');

// Device synchronization
router.post('/', syncDevice);
router.get('/status', getSyncStatus);
router.delete('/device/:device_id', removeDevice);

// Conflict resolution
router.get('/conflicts', getSyncConflicts);
router.post('/conflicts/resolve', resolveSyncConflicts);

// Advanced sync operations
router.post('/force', forceFullSync);

module.exports = router;
