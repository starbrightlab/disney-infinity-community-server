const express = require('express');
const router = express.Router();
const { register, login, refresh } = require('../controllers/auth');
const { authenticateToken } = require('../middleware/auth');

/**
 * Disney ID (DID) v3 API Compatibility Routes
 * 
 * The Wii U (and possibly other platforms) expect Disney ID authentication
 * at /coregames/did/v3/ endpoints. These routes map to our modern auth system.
 * 
 * Original Disney endpoints we're replicating:
 * - POST /coregames/did/v3/register - Create new Disney ID
 * - POST /coregames/did/v3/login - Authenticate with Disney ID
 * - POST /coregames/did/v3/refresh - Refresh authentication token
 */

/**
 * POST /coregames/did/v3/register
 * Create a new Disney ID account
 * 
 * Maps to our /api/v1/auth/register endpoint
 */
router.post('/register', async (req, res) => {
  console.log('📱 DID v3: Registration request from game client');
  
  // The game might send different field names than our modern API expects
  // Transform if needed, otherwise pass through to our auth controller
  
  try {
    // Call our existing register controller
    await register(req, res);
  } catch (error) {
    console.error('❌ DID v3: Registration failed:', error);
    res.status(500).json({
      error: 'REGISTRATION_FAILED',
      message: 'Could not create Disney ID'
    });
  }
});

/**
 * POST /coregames/did/v3/login
 * Authenticate with Disney ID credentials
 * 
 * Maps to our /api/v1/auth/login endpoint
 */
router.post('/login', async (req, res) => {
  console.log('📱 DID v3: Login request from game client');
  
  try {
    // Call our existing login controller
    await login(req, res);
  } catch (error) {
    console.error('❌ DID v3: Login failed:', error);
    res.status(401).json({
      error: 'AUTHENTICATION_FAILED',
      message: 'Invalid Disney ID credentials'
    });
  }
});

/**
 * POST /coregames/did/v3/refresh
 * Refresh authentication token
 * 
 * Maps to our /api/v1/auth/refresh endpoint
 */
router.post('/refresh', async (req, res) => {
  console.log('📱 DID v3: Token refresh request from game client');
  
  try {
    // Call our existing refresh controller
    await refresh(req, res);
  } catch (error) {
    console.error('❌ DID v3: Token refresh failed:', error);
    res.status(401).json({
      error: 'REFRESH_FAILED',
      message: 'Could not refresh authentication token'
    });
  }
});

/**
 * GET /coregames/did/v3/profile
 * Get current user's Disney ID profile
 * 
 * Requires authentication token
 */
router.get('/profile', authenticateToken, async (req, res) => {
  console.log('📱 DID v3: Profile request from game client');
  
  try {
    const { supabase } = require('../config/database');
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, profile_data, created_at')
      .eq('id', req.user.id)
      .single();
    
    if (error) throw error;
    
    res.json({
      did: user.id,
      username: user.username,
      email: user.email,
      profile: user.profile_data,
      created_at: user.created_at
    });
  } catch (error) {
    console.error('❌ DID v3: Profile fetch failed:', error);
    res.status(500).json({
      error: 'PROFILE_FETCH_FAILED',
      message: 'Could not retrieve Disney ID profile'
    });
  }
});

/**
 * POST /coregames/did/v3/validate
 * Validate authentication token (stub for game client)
 */
router.post('/validate', authenticateToken, (req, res) => {
  console.log('📱 DID v3: Token validation request');
  
  // If authenticateToken middleware passed, token is valid
  res.json({
    valid: true,
    did: req.user.id,
    username: req.user.username
  });
});

module.exports = router;
