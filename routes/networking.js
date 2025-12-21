const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/networking');
const { authenticateToken } = require('../middleware/auth');

/**
 * Networking routes for NAT traversal and P2P connections
 */

// Get ICE server configuration (STUN/TURN servers)
router.get('/ice-servers', getIceServers);

// Exchange ICE candidates between peers (requires authentication)
router.post('/ice-candidates', authenticateToken, exchangeIceCandidatesValidation, exchangeIceCandidates);

// Report NAT type detection results (requires authentication)
router.post('/nat-type', authenticateToken, reportNatTypeValidation, reportNatType);

// Get network diagnostics for a session (requires authentication)
router.get('/diagnostics/:sessionId', authenticateToken, getNetworkDiagnostics);

// Test connectivity prediction between peers (requires authentication)
router.post('/connectivity-test', authenticateToken, testConnectivityValidation, testConnectivity);

// Report connection establishment results (requires authentication)
router.post('/connection-result', authenticateToken, reportConnectionResultValidation, reportConnectionResult);

// Get session network diagnostics (requires authentication)
router.get('/diagnostics/session/:sessionId', authenticateToken, getSessionNetworkDiagnostics);

// Get network analytics and trends (public)
router.get('/analytics', getNetworkAnalytics);

// Get network recommendations for authenticated user (requires authentication)
router.get('/recommendations', authenticateToken, getNetworkRecommendations);

module.exports = router;
