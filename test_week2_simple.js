#!/usr/bin/env node

/**
 * Simplified Week 2 Core Functionality Test
 * Tests the essential social layer APIs without complex dependencies
 */

const http = require('http');

let app, server;
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, message = '') {
  testResults.tests.push({ name, passed, message });
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}: ${message}`);
  }
}

function makeRequest(method, path, data = null, token = null, port = 3004) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: `/api/v1${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (err) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
            parseError: err.message
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function generateTestToken(userId = '818dc3e0-13e2-4522-bff5-7e75623fa9c6') {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { userId, type: 'access' },
    'test-jwt-secret-key-for-week2-testing-1234567890',
    { expiresIn: '1h' }
  );
}

async function runSimpleTests() {
  console.log('🚀 Starting Simplified Week 2 Core Functionality Test...\n');

  try {
    // Set environment variables
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-week2-testing-1234567890';
    process.env.LOG_LEVEL = 'error';

    // Import and start server
    app = require('./server');
    const httpServer = require('http').createServer(app);
    const socketIo = require('./socket');
    socketIo.initializeSocketServer(require('socket.io')(httpServer, {
      cors: { origin: 'http://localhost:3004', credentials: true }
    }));

    server = httpServer.listen(3004, () => {
      console.log('📡 Test server started on port 3004');
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate test token
    const adminToken = await generateTestToken();

    console.log('🔐 Testing Core APIs...');

    // Test 1: Server health
    const healthResponse = await makeRequest('GET', '/health');
    logTest(
      'Server health check',
      healthResponse.statusCode === 200 && healthResponse.body?.status === 'ok',
      `Status: ${healthResponse.statusCode}`
    );

    // Test 2: Server includes Week 2 features
    const infoResponse = await makeRequest('GET', '/info');
    const featureCount = infoResponse.body?.features?.length || 0;
    logTest(
      'Server info includes Week 2 features',
      infoResponse.statusCode === 200 && featureCount >= 20,
      `Found ${featureCount} features (should be 20+)`
    );

    console.log('\n👥 Testing Presence System...');

    // Test 3: Update presence
    const presenceResponse = await makeRequest('POST', '/presence/update', {
      status: 'online',
      currentGameMode: 'toybox'
    }, adminToken);
    logTest(
      'Presence update',
      presenceResponse.statusCode === 200,
      `Status: ${presenceResponse.statusCode}`
    );

    // Test 4: Get own presence
    const ownPresenceResponse = await makeRequest('GET', '/presence/me', null, adminToken);
    logTest(
      'Get own presence',
      ownPresenceResponse.statusCode === 200 && ownPresenceResponse.body?.status,
      `Status: ${ownPresenceResponse.statusCode}`
    );

    console.log('\n👫 Testing Friend System...');

    // Test 5: Get friend list (should be empty initially)
    const friendListResponse = await makeRequest('GET', '/friends/list', null, adminToken);
    logTest(
      'Get friend list',
      friendListResponse.statusCode === 200,
      `Status: ${friendListResponse.statusCode}, Friends: ${friendListResponse.body?.friends?.length || 0}`
    );

    // Test 6: Get pending requests (should be empty)
    const pendingResponse = await makeRequest('GET', '/friends/requests/pending', null, adminToken);
    logTest(
      'Get pending friend requests',
      pendingResponse.statusCode === 200,
      `Status: ${pendingResponse.statusCode}`
    );

    console.log('\n📊 Testing Statistics System...');

    // Test 7: Get player stats (should return default values)
    const statsResponse = await makeRequest('GET', '/stats/player/818dc3e0-13e2-4522-bff5-7e75623fa9c6', null, adminToken);
    logTest(
      'Get player statistics',
      statsResponse.statusCode === 200,
      `Status: ${statsResponse.statusCode}`
    );

    // Test 8: Get leaderboard (should work even with no data)
    const leaderboardResponse = await makeRequest('GET', '/stats/leaderboard?limit=5');
    logTest(
      'Get leaderboard',
      leaderboardResponse.statusCode === 200,
      `Status: ${leaderboardResponse.statusCode}`
    );

    console.log('\n🌐 Testing Network System...');

    // Test 9: Get ICE servers
    const iceResponse = await makeRequest('GET', '/networking/ice-servers');
    logTest(
      'Get ICE servers',
      iceResponse.statusCode === 200 && iceResponse.body?.iceServers?.length > 0,
      `Status: ${iceResponse.statusCode}, Servers: ${iceResponse.body?.iceServers?.length || 0}`
    );

    // Test 10: Get network analytics
    const analyticsResponse = await makeRequest('GET', '/networking/analytics?hours=1');
    logTest(
      'Get network analytics',
      analyticsResponse.statusCode === 200,
      `Status: ${analyticsResponse.statusCode}`
    );

    // Test 11: Get network recommendations
    const recommendationsResponse = await makeRequest('GET', '/networking/recommendations', null, adminToken);
    logTest(
      'Get network recommendations',
      recommendationsResponse.statusCode === 200,
      `Status: ${recommendationsResponse.statusCode}`
    );

    console.log('\n🧹 Testing Admin Functions...');

    // Test 12: Admin cleanup stats
    const cleanupResponse = await makeRequest('GET', '/admin/cleanup/stats', null, adminToken);
    // This might return 403 for non-admin, which is expected behavior
    logTest(
      'Admin cleanup stats accessible',
      cleanupResponse.statusCode === 200 || cleanupResponse.statusCode === 403,
      `Status: ${cleanupResponse.statusCode} (${cleanupResponse.statusCode === 403 ? 'Expected for test user' : 'OK'})`
    );

    console.log(`\n📊 Week 2 Core Functionality Test Results: ${testResults.passed} passed, ${testResults.failed} failed`);

    if (testResults.failed === 0) {
      console.log('🎉 ALL Week 2 core functionality tests passed!');
      console.log('✅ Social layer APIs are working correctly');
      console.log('✅ Presence system operational');
      console.log('✅ Friend system APIs functional');
      console.log('✅ Statistics system responding');
      console.log('✅ Network monitoring active');
      console.log('✅ WebSocket server initialized');
      console.log('\n🚀 READY TO PROCEED TO WEEK 3: QUALITY ASSURANCE');
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed. Core functionality may have issues:');
      testResults.tests.filter(t => !t.passed).forEach(t => {
        console.log(`  - ${t.name}: ${t.message}`);
      });
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Test suite failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
  }
}

runSimpleTests();
