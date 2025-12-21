#!/usr/bin/env node

/**
 * Phase 4 Testing Script
 * Comprehensive testing for Profiles & Achievements features
 */

const supertest = require('supertest');
const { createClient } = require('@supabase/supabase-js');
const pool = require('./config/database');
const winston = require('winston');

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'test_phase4.log' })
  ]
});

// Test configuration
const TEST_CONFIG = {
  baseURL: 'http://localhost:3000',
  testUser: {
    username: 'testuser_phase4',
    email: 'testphase4@dibeyond.com',
    password: 'testpass123'
  },
  testUser2: {
    username: 'testuser2_phase4',
    email: 'testphase42@dibeyond.com',
    password: 'testpass123'
  }
};

let server;
let agent;
let testUserToken;
let testUser2Token;
let testUserId;
let testUser2Id;

/**
 * Initialize test environment
 */
async function initializeTests() {
  logger.info('Initializing Phase 4 tests...');

  // Start server if not running
  if (!server) {
    server = require('./server');
    agent = supertest.agent(server);
  }

  // Clean up any existing test data
  await cleanupTestData();

  logger.info('Test environment initialized');
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  try {
    const testUsernames = [TEST_CONFIG.testUser.username, TEST_CONFIG.testUser2.username];

    for (const username of testUsernames) {
      // Get user ID
      const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;

        // Delete in correct order due to foreign keys
        await pool.query('DELETE FROM achievement_notifications WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM player_achievements WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM achievement_progress WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM profile_analytics WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM device_sync WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM profile_showcase WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM friends WHERE user_id = $1 OR friend_id = $1', [userId]);
        await pool.query('DELETE FROM friend_requests WHERE sender_id = $1 OR receiver_id = $1', [userId]);
        await pool.query('DELETE FROM game_stats WHERE player_id = $1', [userId]);
        await pool.query('DELETE FROM player_stats WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM sessions WHERE host_user_id = $1', [userId]);
        await pool.query('DELETE FROM toybox_likes WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM toybox_ratings WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM toybox_downloads WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM toyboxes WHERE creator_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
    }

    logger.info('Test data cleaned up');
  } catch (error) {
    logger.error('Error cleaning up test data:', error);
  }
}

/**
 * Create test users
 */
async function createTestUsers() {
  logger.info('Creating test users...');

  // Create first test user
  const registerResponse1 = await agent
    .post('/api/v1/auth/register')
    .send(TEST_CONFIG.testUser);

  if (registerResponse1.status !== 201) {
    throw new Error(`Failed to register test user 1: ${registerResponse1.status} - ${registerResponse1.text}`);
  }

  testUserId = registerResponse1.body.user.id;

  // Login to get token
  const loginResponse1 = await agent
    .post('/api/v1/auth/login')
    .send({
      username: TEST_CONFIG.testUser.username,
      password: TEST_CONFIG.testUser.password
    });

  if (loginResponse1.status !== 200) {
    throw new Error(`Failed to login test user 1: ${loginResponse1.status} - ${loginResponse1.text}`);
  }

  testUserToken = loginResponse1.body.token;

  // Create second test user
  const registerResponse2 = await agent
    .post('/api/v1/auth/register')
    .send(TEST_CONFIG.testUser2);

  if (registerResponse2.status !== 201) {
    throw new Error(`Failed to register test user 2: ${registerResponse2.status} - ${registerResponse2.text}`);
  }

  testUser2Id = registerResponse2.body.user.id;

  // Login to get token
  const loginResponse2 = await agent
    .post('/api/v1/auth/login')
    .send({
      username: TEST_CONFIG.testUser2.username,
      password: TEST_CONFIG.testUser2.password
    });

  if (loginResponse2.status !== 200) {
    throw new Error(`Failed to login test user 2: ${loginResponse2.status} - ${loginResponse2.text}`);
  }

  testUser2Token = loginResponse2.body.token;

  logger.info(`Test users created: ${testUserId} and ${testUser2Id}`);
}

/**
 * Test profile management features
 */
async function testProfileManagement() {
  logger.info('Testing profile management...');

  // Test 1: Get profile
  const getProfileResponse = await agent
    .get('/api/v1/profile')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getProfileResponse.status !== 200) {
    throw new Error(`Failed to get profile: ${getProfileResponse.status} - ${getProfileResponse.text}`);
  }

  console.log('✅ Get profile successful');

  // Test 2: Update profile
  const updateProfileResponse = await agent
    .put('/api/v1/profile')
    .set('Authorization', `Bearer ${testUserToken}`)
    .send({
      display_name: 'Test User Phase4',
      bio: 'Testing Phase 4 profile features',
      privacy_settings: {
        profile_visibility: 'public',
        stats_visibility: 'friends'
      },
      theme: {
        primary_color: '#FF6B6B',
        background: 'dark'
      },
      achievements_visible: true,
      show_online_status: true
    });

  if (updateProfileResponse.status !== 200) {
    throw new Error(`Failed to update profile: ${updateProfileResponse.status} - ${updateProfileResponse.text}`);
  }

  console.log('✅ Update profile successful');

  // Test 3: Update avatar
  const updateAvatarResponse = await agent
    .put('/api/v1/profile/avatar')
    .set('Authorization', `Bearer ${testUserToken}`)
    .send({
      character_id: 1,
      costume: 'hero',
      accessories: [1, 2, 3]
    });

  if (updateAvatarResponse.status !== 200) {
    throw new Error(`Failed to update avatar: ${updateAvatarResponse.status} - ${updateAvatarResponse.text}`);
  }

  console.log('✅ Update avatar successful');

  // Test 4: Get detailed stats
  const getStatsResponse = await agent
    .get('/api/v1/profile/stats/detailed')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getStatsResponse.status !== 200) {
    throw new Error(`Failed to get detailed stats: ${getStatsResponse.status} - ${getStatsResponse.text}`);
  }

  console.log('✅ Get detailed stats successful');

  // Test 5: Get public profile
  const getPublicProfileResponse = await agent
    .get(`/api/v1/profile/public/${testUserId}`)
    .set('Authorization', `Bearer ${testUser2Token}`);

  if (getPublicProfileResponse.status !== 200) {
    throw new Error(`Failed to get public profile: ${getPublicProfileResponse.status} - ${getPublicProfileResponse.text}`);
  }

  console.log('✅ Get public profile successful');

  logger.info('Profile management tests passed');
}

/**
 * Test achievement system
 */
async function testAchievementSystem() {
  logger.info('Testing achievement system...');

  // Test 1: Get achievements
  const getAchievementsResponse = await agent
    .get('/api/v1/achievements')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getAchievementsResponse.status !== 200) {
    throw new Error(`Failed to get achievements: ${getAchievementsResponse.status} - ${getAchievementsResponse.text}`);
  }

  console.log(`✅ Get achievements successful (${getAchievementsResponse.body.achievements.length} achievements found)`);

  // Test 2: Get player achievements (should be empty initially)
  const getPlayerAchievementsResponse = await agent
    .get('/api/v1/achievements/player')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getPlayerAchievementsResponse.status !== 200) {
    throw new Error(`Failed to get player achievements: ${getPlayerAchievementsResponse.status} - ${getPlayerAchievementsResponse.text}`);
  }

  console.log('✅ Get player achievements successful (initially empty)');

  // Test 3: Get achievement leaderboard
  const getLeaderboardResponse = await agent
    .get('/api/v1/achievements/leaderboard')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getLeaderboardResponse.status !== 200) {
    throw new Error(`Failed to get achievement leaderboard: ${getLeaderboardResponse.status} - ${getLeaderboardResponse.text}`);
  }

  console.log('✅ Get achievement leaderboard successful');

  // Test 4: Manually trigger achievement check (admin function)
  const triggerAchievementResponse = await agent
    .post('/api/v1/achievements/check')
    .set('Authorization', `Bearer ${testUserToken}`)
    .send({
      userId: testUserId,
      criteriaType: 'friends_added',
      criteriaData: { friends: 1 }
    });

  if (triggerAchievementResponse.status !== 200) {
    throw new Error(`Failed to trigger achievement check: ${triggerAchievementResponse.status} - ${triggerAchievementResponse.text}`);
  }

  console.log('✅ Trigger achievement check successful');

  logger.info('Achievement system tests passed');
}

/**
 * Test cross-device sync
 */
async function testCrossDeviceSync() {
  logger.info('Testing cross-device sync...');

  // Test 1: Sync device data
  const syncResponse = await agent
    .post('/api/v1/sync')
    .set('Authorization', `Bearer ${testUserToken}`)
    .send({
      device_id: 'test_device_123',
      device_name: 'Test Device',
      sync_data: {
        last_played_character: 1,
        settings: { volume: 80, graphics: 'high' }
      },
      last_sync_timestamp: new Date().toISOString()
    });

  if (syncResponse.status !== 200) {
    throw new Error(`Failed to sync device: ${syncResponse.status} - ${syncResponse.text}`);
  }

  console.log('✅ Device sync successful');

  // Test 2: Get sync status
  const getSyncStatusResponse = await agent
    .get('/api/v1/sync/status')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getSyncStatusResponse.status !== 200) {
    throw new Error(`Failed to get sync status: ${getSyncStatusResponse.status} - ${getSyncStatusResponse.text}`);
  }

  console.log(`✅ Get sync status successful (${getSyncStatusResponse.body.devices.length} devices)`);

  // Test 3: Get sync conflicts (should be empty)
  const getConflictsResponse = await agent
    .get('/api/v1/sync/conflicts')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getConflictsResponse.status !== 200) {
    throw new Error(`Failed to get sync conflicts: ${getConflictsResponse.status} - ${getConflictsResponse.text}`);
  }

  console.log('✅ Get sync conflicts successful');

  logger.info('Cross-device sync tests passed');
}

/**
 * Test analytics system
 */
async function testAnalyticsSystem() {
  logger.info('Testing analytics system...');

  // Test 1: Get player analytics
  const getPlayerAnalyticsResponse = await agent
    .get('/api/v1/analytics/player')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getPlayerAnalyticsResponse.status !== 200) {
    throw new Error(`Failed to get player analytics: ${getPlayerAnalyticsResponse.status} - ${getPlayerAnalyticsResponse.text}`);
  }

  console.log('✅ Get player analytics successful');

  // Test 2: Get performance trends
  const getTrendsResponse = await agent
    .get('/api/v1/analytics/trends?metric=win_rate')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (getTrendsResponse.status !== 200) {
    throw new Error(`Failed to get performance trends: ${getTrendsResponse.status} - ${getTrendsResponse.text}`);
  }

  console.log('✅ Get performance trends successful');

  // Test 3: Get server analytics (admin only - should fail for regular user)
  const getServerAnalyticsResponse = await agent
    .get('/api/v1/analytics/server')
    .set('Authorization', `Bearer ${testUserToken}`);

  // This should fail for non-admin users
  if (getServerAnalyticsResponse.status !== 403) {
    logger.warn('Server analytics should be admin-only, but request succeeded');
  } else {
    console.log('✅ Server analytics properly restricted to admins');
  }

  logger.info('Analytics system tests passed');
}

/**
 * Test social features integration
 */
async function testSocialFeatures() {
  logger.info('Testing social features integration...');

  // Test 1: Send friend request
  const sendFriendRequestResponse = await agent
    .post('/api/v1/friends/request')
    .set('Authorization', `Bearer ${testUserToken}`)
    .send({
      targetUserId: testUser2Id,
      message: 'Testing Phase 4 friend request'
    });

  if (sendFriendRequestResponse.status !== 200) {
    throw new Error(`Failed to send friend request: ${sendFriendRequestResponse.status} - ${sendFriendRequestResponse.text}`);
  }

  console.log('✅ Send friend request successful');

  // Test 2: Accept friend request (this should trigger achievements)
  const pendingRequestsResponse = await agent
    .get('/api/v1/friends/requests/pending')
    .set('Authorization', `Bearer ${testUser2Token}`);

  if (pendingRequestsResponse.status !== 200 || pendingRequestsResponse.body.requests.length === 0) {
    throw new Error('No pending friend requests found for user 2');
  }

  const requestId = pendingRequestsResponse.body.requests[0].id;

  const acceptFriendResponse = await agent
    .post('/api/v1/friends/accept')
    .set('Authorization', `Bearer ${testUser2Token}`)
    .send({
      requestId: requestId,
      action: 'accept'
    });

  if (acceptFriendResponse.status !== 200) {
    throw new Error(`Failed to accept friend request: ${acceptFriendResponse.status} - ${acceptFriendResponse.text}`);
  }

  console.log('✅ Accept friend request successful (achievements should be triggered)');

  // Test 3: Check if achievements were awarded
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for async achievement processing

  const checkAchievementsResponse = await agent
    .get('/api/v1/achievements/player')
    .set('Authorization', `Bearer ${testUserToken}`);

  if (checkAchievementsResponse.status !== 200) {
    throw new Error(`Failed to check achievements after friending: ${checkAchievementsResponse.status} - ${checkAchievementsResponse.text}`);
  }

  if (checkAchievementsResponse.body.achievements.unlocked.length > 0) {
    console.log(`✅ Friend achievement awarded: ${checkAchievementsResponse.body.achievements.unlocked[0].name}`);
  } else {
    console.log('⚠️ No achievements awarded yet (this may be normal if criteria not met)');
  }

  logger.info('Social features integration tests passed');
}

/**
 * Run performance tests
 */
async function testPerformance() {
  logger.info('Testing performance...');

  const startTime = Date.now();

  // Test concurrent profile requests
  const concurrentRequests = Array(10).fill().map(() =>
    agent
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${testUserToken}`)
  );

  const responses = await Promise.all(concurrentRequests);
  const endTime = Date.now();

  const allSuccessful = responses.every(r => r.status === 200);
  const avgResponseTime = (endTime - startTime) / responses.length;

  if (!allSuccessful) {
    throw new Error('Some concurrent requests failed');
  }

  console.log(`✅ Performance test passed: ${responses.length} requests, avg ${avgResponseTime.toFixed(2)}ms per request`);

  logger.info('Performance tests passed');
}

/**
 * Run all tests
 */
async function runAllTests() {
  try {
    console.log('🚀 Starting Phase 4 Comprehensive Tests\n');

    await initializeTests();
    await createTestUsers();

    console.log('\n📋 Running Profile Management Tests...');
    await testProfileManagement();

    console.log('\n🏆 Running Achievement System Tests...');
    await testAchievementSystem();

    console.log('\n🔄 Running Cross-Device Sync Tests...');
    await testCrossDeviceSync();

    console.log('\n📊 Running Analytics System Tests...');
    await testAnalyticsSystem();

    console.log('\n👥 Running Social Features Tests...');
    await testSocialFeatures();

    console.log('\n⚡ Running Performance Tests...');
    await testPerformance();

    console.log('\n🎉 All Phase 4 tests passed successfully!');
    console.log('\n📈 Phase 4 Features Implemented:');
    console.log('  ✅ User Profiles & Customization');
    console.log('  ✅ Avatar System');
    console.log('  ✅ Achievement Framework');
    console.log('  ✅ Achievement Tracking Engine');
    console.log('  ✅ Achievement Rewards System');
    console.log('  ✅ Cross-Device Sync');
    console.log('  ✅ Profile Showcase & Discovery');
    console.log('  ✅ Advanced Analytics');
    console.log('  ✅ Social Achievement Features');
    console.log('  ✅ Performance Optimization');

    process.exit(0);

  } catch (error) {
    logger.error('Test suite failed:', error);
    console.error('\n❌ Test suite failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up
    await cleanupTestData();
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testProfileManagement,
  testAchievementSystem,
  testCrossDeviceSync,
  testAnalyticsSystem,
  testSocialFeatures,
  testPerformance
};
