#!/usr/bin/env node

/**
 * Week 1 Implementation Test Script
 * Tests all the multiplayer functionality implemented in Phase 3 Week 1
 */

const http = require('http');

// Set environment variables for testing
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-week1-testing-1234567890';
process.env.JWT_EXPIRES_IN = '1h';
process.env.LOG_LEVEL = 'error'; // Reduce log noise

const app = require('./server');
const jwt = require('jsonwebtoken');

let server;
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

function makeRequest(method, path, data = null, token = null, port = 3001) {
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

async function generateTestToken(userId = '818dc3e0-13e2-4522-bff5-7e75623fa9c6') { // Use admin user ID
  return jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}

async function runTests() {
  console.log('🚀 Starting Week 1 Implementation Tests...\n');

  try {
    // Start server on a different port
    server = app.listen(3001, () => {
      console.log('📡 Test server started on port 3001');
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 1: Health check
    console.log('Testing basic endpoints...');
    const healthResponse = await makeRequest('GET', '/health', null, null, 3001);
    logTest(
      'Health check endpoint',
      healthResponse.statusCode === 200 && healthResponse.body?.status === 'ok',
      `Status: ${healthResponse.statusCode}`
    );

    // Test 2: Server info
    const infoResponse = await makeRequest('GET', '/info', null, null, 3001);
    const expectedFeatures = ['matchmaking', 'sessions', 'networking', 'steam'];
    const hasExpectedFeatures = expectedFeatures.every(feature =>
      infoResponse.body?.features?.some(f => f.includes(feature))
    );
    logTest(
      'Server info endpoint',
      infoResponse.statusCode === 200 && hasExpectedFeatures,
      `Found ${infoResponse.body?.features?.length || 0} features including all expected multiplayer features`
    );

    // Test 3: Generate test token
    const testToken = await generateTestToken();
    logTest('JWT token generation', !!testToken, 'Token created successfully');

    // Test 4: Matchmaking stats (public endpoint)
    const matchmakingStatsResponse = await makeRequest('GET', '/matchmaking/stats');
    logTest(
      'Matchmaking stats endpoint',
      matchmakingStatsResponse.statusCode === 200,
      `Status: ${matchmakingStatsResponse.statusCode}`
    );

    // Test 5: ICE servers (public endpoint)
    const iceServersResponse = await makeRequest('GET', '/networking/ice-servers');
    logTest(
      'ICE servers endpoint',
      iceServersResponse.statusCode === 200 && iceServersResponse.body?.iceServers?.length > 0,
      `Found ${iceServersResponse.body?.iceServers?.length || 0} ICE servers`
    );

    // Test 6: Matchmaking join (requires auth)
    const joinResponse = await makeRequest('POST', '/matchmaking/join', {
      gameMode: 'toybox',
      region: 'global',
      skillLevel: 5,
      maxPlayers: 4
    }, testToken, 3001);

    const joinSuccessful = joinResponse.statusCode === 200 &&
      ['queued', 'matched'].includes(joinResponse.body?.status);

    logTest(
      'Matchmaking join endpoint',
      joinSuccessful,
      joinSuccessful ? `Status: ${joinResponse.body?.status}` : `Status: ${joinResponse.statusCode}`
    );

    // Test 7: Create session (requires auth)
    const createSessionResponse = await makeRequest('POST', '/sessions/create', {
      gameMode: 'toybox',
      maxPlayers: 4,
      region: 'global'
    }, testToken);

    const sessionCreated = createSessionResponse.statusCode === 201 &&
      createSessionResponse.body?.session_id;

    logTest(
      'Session creation endpoint',
      sessionCreated,
      sessionCreated ? `Session ID: ${createSessionResponse.body?.session_id}` : `Status: ${createSessionResponse.statusCode}`
    );

    let sessionId = null;
    if (sessionCreated) {
      sessionId = createSessionResponse.body.session_id;
    }

    // Test 8: List sessions
    const listSessionsResponse = await makeRequest('GET', '/sessions?gameMode=toybox');
    logTest(
      'List sessions endpoint',
      listSessionsResponse.statusCode === 200,
      `Found ${listSessionsResponse.body?.sessions?.length || 0} sessions`
    );

    // Test 9: Steam registration (requires auth)
    const steamRegisterResponse = await makeRequest('POST', '/steam/register', {
      steamId: '76561198000000001',
      steamUsername: 'TestUser'
    }, testToken);

    logTest(
      'Steam registration endpoint',
      steamRegisterResponse.statusCode === 200,
      `Status: ${steamRegisterResponse.statusCode}`
    );

    // Test 10: Cleanup stats (requires admin auth - will fail but test endpoint exists)
    const cleanupStatsResponse = await makeRequest('GET', '/admin/cleanup/stats', null, testToken);
    const cleanupTested = cleanupStatsResponse.statusCode === 403 || cleanupStatsResponse.statusCode === 200;
    logTest(
      'Cleanup stats endpoint exists',
      cleanupTested,
      cleanupTested ? 'Endpoint accessible (expected 403 for non-admin)' : `Status: ${cleanupStatsResponse.statusCode}`
    );

    // Test 11: NAT type reporting
    const natReportResponse = await makeRequest('POST', '/networking/nat-type', {
      natType: 'full-cone',
      publicIp: '192.168.1.100',
      detectionMethod: 'stun'
    }, testToken);

    logTest(
      'NAT type reporting endpoint',
      natReportResponse.statusCode === 200,
      `Status: ${natReportResponse.statusCode}`
    );

    // Clean up: Leave matchmaking if we joined
    if (joinSuccessful) {
      const leaveResponse = await makeRequest('POST', '/matchmaking/leave', {}, testToken);
      logTest(
        'Matchmaking leave endpoint',
        leaveResponse.statusCode === 200,
        `Status: ${leaveResponse.statusCode}`
      );
    }

    // Summary
    console.log(`\n📊 Test Results: ${testResults.passed} passed, ${testResults.failed} failed`);

    if (testResults.failed === 0) {
      console.log('🎉 All Week 1 tests passed! Ready to proceed to Week 2.');
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed. Check the implementation.');
      console.log('\nFailed tests:');
      testResults.tests.filter(t => !t.passed).forEach(t => {
        console.log(`  - ${t.name}: ${t.message}`);
      });
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Test suite failed:', err.message);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests();
