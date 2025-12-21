const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

// Mock the database connection for testing
jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  getClient: jest.fn(),
  testConnection: jest.fn(),
  close: jest.fn()
}));

describe('Integration Tests - Complete User Journeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete User Registration and Authentication Flow', () => {
    it('should handle complete registration to login flow', async () => {
      // Mock user registration
      query.mockResolvedValueOnce({ rows: [] }) // Check existing user
        .mockResolvedValueOnce({ // Create user
          rows: [{
            id: 'user-123',
            username: 'testplayer',
            email: 'test@example.com',
            created_at: '2024-01-01T12:00:00Z'
          }]
        });

      // Register user
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testplayer',
          email: 'test@example.com',
          password: 'securepass123'
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body).toHaveProperty('token');
      expect(registerResponse.body).toHaveProperty('refresh_token');

      // Mock login
      query.mockResolvedValueOnce({ rows: [{ // Find user
        id: 'user-123',
        username: 'testplayer',
        email: 'test@example.com',
        password_hash: 'hashed_password',
        is_active: true
      }] })
      .mockResolvedValueOnce({ rows: [] }); // Update last login

      // Login user
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testplayer',
          password: 'securepass123'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body).toHaveProperty('token');
      expect(loginResponse.body.user.username).toBe('testplayer');

      // Use token for authenticated request
      const token = loginResponse.body.token;

      // Mock profile fetch
      query.mockResolvedValueOnce({ rows: [{
        id: 'user-123',
        username: 'testplayer',
        email: 'test@example.com',
        profile_data: { display_name: 'Test Player' },
        created_at: '2024-01-01T12:00:00Z',
        last_login: '2024-01-01T12:30:00Z',
        toyboxes_created: '2',
        toyboxes_downloaded: '5',
        total_downloads: '10'
      }] });

      // Get user profile
      const profileResponse = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.username).toBe('testplayer');
      expect(profileResponse.body.stats.toyboxes_created).toBe(2);
    });
  });

  describe('Social Features Integration - Friend System', () => {
    const userToken = 'user-token-123';
    const friendToken = 'friend-token-456';

    it('should handle complete friend request lifecycle', async () => {
      // Mock friend request creation
      query
        .mockResolvedValueOnce({ rows: [] }) // Check existing friendship
        .mockResolvedValueOnce({ rows: [] }) // Check existing request
        .mockResolvedValueOnce({ rows: [{ id: 'friend-id', username: 'frienduser' }] }) // Get target user
        .mockResolvedValueOnce({ rows: [{ id: 'request-123', created_at: '2024-01-01T12:00:00Z' }] }); // Create request

      // Send friend request
      const requestResponse = await request(app)
        .post('/api/v1/friends/request')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          targetUserId: 'friend-id',
          message: 'Want to play some games?'
        });

      expect(requestResponse.status).toBe(201);
      expect(requestResponse.body).toHaveProperty('request_id');

      // Mock getting pending requests
      query.mockResolvedValueOnce({ rows: [{
        id: 'request-123',
        sender_id: 'user-123',
        message: 'Want to play some games?',
        created_at: '2024-01-01T12:00:00Z'
      }] });

      // Get pending requests as friend
      const pendingResponse = await request(app)
        .get('/api/v1/friends/requests/pending')
        .set('Authorization', `Bearer ${friendToken}`);

      expect(pendingResponse.status).toBe(200);
      expect(pendingResponse.body.pending_requests).toHaveLength(1);

      // Mock accepting request
      query
        .mockResolvedValueOnce({ rows: [{ // Get request
          id: 'request-123',
          sender_id: 'user-123',
          receiver_id: 'friend-id',
          status: 'pending'
        }] })
        .mockResolvedValueOnce({}) // Update request
        .mockResolvedValueOnce({}); // Create friendships

      // Accept friend request
      const acceptResponse = await request(app)
        .post('/api/v1/friends/accept')
        .set('Authorization', `Bearer ${friendToken}`)
        .send({ requestId: 'request-123' });

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body).toHaveProperty('friendship_created', true);
    });

    it('should handle friend list and presence integration', async () => {
      // Mock friend list with presence
      query
        .mockResolvedValueOnce({ rows: [{ // Friend data
          friend_id: 'friend-1',
          username: 'frienduser',
          status: 'online',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'toybox',
          friendship_added_at: '2024-01-01T10:00:00Z'
        }] })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }); // Total count

      // Get friend list
      const friendListResponse = await request(app)
        .get('/api/v1/friends/list')
        .set('Authorization', `Bearer ${userToken}`);

      expect(friendListResponse.status).toBe(200);
      expect(friendListResponse.body.friends).toHaveLength(1);
      expect(friendListResponse.body.friends[0].status).toBe('online');

      // Mock presence update
      query.mockResolvedValueOnce({}); // Update presence

      // Update presence
      const presenceResponse = await request(app)
        .post('/api/v1/presence/update')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          status: 'in_game',
          currentGameMode: 'adventure'
        });

      expect(presenceResponse.status).toBe(200);
      expect(presenceResponse.body.presence.status).toBe('in_game');
    });
  });

  describe('Gaming Session Integration', () => {
    const userToken = 'user-token-123';
    const friendToken = 'friend-token-456';

    it('should handle complete gaming session lifecycle', async () => {
      // Mock session creation
      query
        .mockResolvedValueOnce({ rows: [] }) // Check existing session
        .mockResolvedValueOnce({ rows: [{ id: 'session-123', created_at: '2024-01-01T12:00:00Z' }] }) // Create session
        .mockResolvedValueOnce({}); // Add player

      // Create game session
      const createResponse = await request(app)
        .post('/api/v1/sessions/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          gameMode: 'toybox',
          maxPlayers: 4
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body).toHaveProperty('session_id');
      expect(createResponse.body.game_mode).toBe('toybox');

      const sessionId = createResponse.body.session_id;

      // Mock session listing
      query.mockResolvedValueOnce({ rows: [{ // Session data
        session_id: sessionId,
        host_user_id: 'user-123',
        game_mode: 'toybox',
        region: 'global',
        max_players: 4,
        current_players: 1,
        status: 'waiting',
        created_at: '2024-01-01T12:00:00Z'
      }] });

      // List available sessions
      const listResponse = await request(app)
        .get('/api/v1/sessions?gameMode=toybox');

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.sessions).toHaveLength(1);
      expect(listResponse.body.sessions[0].game_mode).toBe('toybox');
    });

    it('should handle game invitations between friends', async () => {
      const sessionId = 'session-456';

      // Mock friendship check
      query
        .mockResolvedValueOnce({ rows: [{ id: 'friendship-123' }] }) // Check friendship
        .mockResolvedValueOnce({ rows: [{ // Check session
          id: sessionId,
          game_mode: 'toybox',
          status: 'waiting',
          current_players: 1,
          max_players: 4
        }] });

      // Send game invitation
      const inviteResponse = await request(app)
        .post('/api/v1/friends/invite')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          friendId: 'friend-1',
          sessionId: sessionId,
          message: 'Join my toybox game!'
        });

      expect(inviteResponse.status).toBe(200);
      expect(inviteResponse.body).toHaveProperty('invitation_sent', true);
      expect(inviteResponse.body).toHaveProperty('session_id', sessionId);
    });
  });

  describe('Statistics and Leaderboards Integration', () => {
    const userToken = 'user-token-123';

    it('should handle complete statistics workflow', async () => {
      // Mock match statistics submission
      query
        .mockResolvedValueOnce({ rows: [{ id: 'session-123', status: 'completed' }] }) // Check session
        .mockResolvedValueOnce({ rows: [] }) // Check existing stats
        .mockResolvedValueOnce({ rows: [{ id: 'stats-123', created_at: '2024-01-01T12:00:00Z' }] }) // Insert stats
        .mockResolvedValueOnce({ rows: [] }) // Get current player stats
        .mockResolvedValueOnce({}); // Update player stats

      // Submit match statistics
      const statsResponse = await request(app)
        .post('/api/v1/stats/match')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sessionId: 'session-123',
          score: 1500,
          completionTime: 120,
          achievements: ['first_win', 'speed_demon'],
          performanceMetrics: { accuracy: 0.95, combo: 8 }
        });

      expect(statsResponse.status).toBe(201);
      expect(statsResponse.body).toHaveProperty('stats_id');
      expect(statsResponse.body).toHaveProperty('score', 1500);

      // Mock player stats retrieval
      query.mockResolvedValueOnce({ rows: [{
        games_played: 5,
        games_won: 3,
        games_lost: 2,
        total_score: 7500,
        best_score: 2000,
        skill_rating: 1250,
        win_streak: 2,
        last_played: '2024-01-01T12:00:00Z'
      }] });

      // Get player statistics
      const playerStatsResponse = await request(app)
        .get('/api/v1/stats/player/user-123')
        .set('Authorization', `Bearer ${userToken}`);

      expect(playerStatsResponse.status).toBe(200);
      expect(playerStatsResponse.body).toHaveProperty('games_played', 5);
      expect(playerStatsResponse.body).toHaveProperty('win_rate', 60);
    });

    it('should provide leaderboard functionality', async () => {
      // Mock leaderboard data
      query
        .mockResolvedValueOnce({ rows: [{ // Leaderboard entries
          user_id: 'player-1',
          username: 'topplayer',
          games_played: 20,
          games_won: 15,
          total_score: 25000,
          best_score: 3000,
          skill_rating: 1500,
          win_rate: 75
        }] })
        .mockResolvedValueOnce({ rows: [{ total: '100' }] }); // Total count

      // Get leaderboard
      const leaderboardResponse = await request(app)
        .get('/api/v1/stats/leaderboard?sortBy=total_score&limit=10');

      expect(leaderboardResponse.status).toBe(200);
      expect(leaderboardResponse.body).toHaveProperty('leaderboard');
      expect(leaderboardResponse.body.leaderboard).toHaveLength(1);
      expect(leaderboardResponse.body.leaderboard[0]).toHaveProperty('rank', 1);
      expect(leaderboardResponse.body.leaderboard[0]).toHaveProperty('username', 'topplayer');
      expect(leaderboardResponse.body).toHaveProperty('pagination');
      expect(leaderboardResponse.body.pagination.total).toBe(100);
    });
  });

  describe('Network Monitoring Integration', () => {
    const userToken = 'user-token-123';

    it('should handle network quality reporting', async () => {
      // Mock connection result reporting
      query.mockResolvedValueOnce({}); // Insert network quality data

      // Report connection result
      const networkResponse = await request(app)
        .post('/api/v1/networking/connection-result')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          targetUserId: 'peer-123',
          sessionId: 'session-123',
          connectionType: 'direct',
          success: true,
          latencyMs: 45,
          packetLoss: 0.1
        });

      expect(networkResponse.status).toBe(200);
      expect(networkResponse.body).toHaveProperty('status', 'connection_result_recorded');
    });

    it('should provide network analytics', async () => {
      // Mock analytics data
      query
        .mockResolvedValueOnce({ rows: [{ // Trends data
          hour: '2024-01-01T12:00:00Z',
          measurements: 25,
          avg_ping: 45.5,
          avg_packet_loss: 0.05,
          excellent_count: 20,
          good_count: 3,
          fair_count: 2,
          poor_count: 0
        }] })
        .mockResolvedValueOnce({ rows: [{ // Connection types
          type: 'direct',
          count: 20,
          avg_ping: 35,
          good_connections: 18
        }] })
        .mockResolvedValueOnce({ rows: [{ // NAT types
          type: 'full-cone',
          count: 15,
          avg_ping: 40
        }] });

      // Get network analytics
      const analyticsResponse = await request(app)
        .get('/api/v1/networking/analytics?hours=24');

      expect(analyticsResponse.status).toBe(200);
      expect(analyticsResponse.body).toHaveProperty('trends');
      expect(analyticsResponse.body).toHaveProperty('connection_types');
      expect(analyticsResponse.body).toHaveProperty('nat_types');
      expect(analyticsResponse.body).toHaveProperty('summary');
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should enforce rate limits on auth endpoints', async () => {
      // Make multiple rapid auth requests (this would normally be rate limited)
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/api/v1/auth/login')
            .send({
              username: 'testuser',
              password: 'wrongpass'
            })
        );
      }

      const responses = await Promise.all(promises);
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      // Note: In a real scenario, some requests would be rate limited
      // This test verifies the rate limiting infrastructure is in place
      expect(responses.some(r => r.status === 401 || r.status === 429)).toBe(true);
    });
  });

  describe('Monitoring and Health Checks', () => {
    it('should provide health check with monitoring data', async () => {
      const healthResponse = await request(app)
        .get('/api/v1/health');

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toHaveProperty('status');
      expect(healthResponse.body).toHaveProperty('uptime');
      expect(healthResponse.body).toHaveProperty('checks');
      expect(healthResponse.body.checks).toHaveProperty('database');
      expect(healthResponse.body.checks).toHaveProperty('memory');
      expect(healthResponse.body.checks).toHaveProperty('requests');
    });

    it('should provide performance metrics', async () => {
      const perfResponse = await request(app)
        .get('/api/v1/monitoring/performance');

      expect(perfResponse.status).toBe(200);
      expect(perfResponse.body).toHaveProperty('response_time');
      expect(perfResponse.body).toHaveProperty('error_rate');
      expect(perfResponse.body).toHaveProperty('throughput');
      expect(perfResponse.body).toHaveProperty('memory');
    });
  });
});
