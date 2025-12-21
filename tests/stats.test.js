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

describe('Statistics API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockToken = 'mock.jwt.token.for.stats.testing';

  describe('POST /api/v1/stats/match', () => {
    it('should submit match statistics successfully', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'session-id', status: 'completed' }] }) // Check session
        .mockResolvedValueOnce({ rows: [] }) // Check existing stats
        .mockResolvedValueOnce({ rows: [{ id: 'stats-id', created_at: '2024-01-01T12:00:00Z' }] }) // Insert stats
        .mockResolvedValueOnce({ rows: [] }); // Get current player stats
        .mockResolvedValueOnce({}); // Update player stats

      const response = await request(app)
        .post('/api/v1/stats/match')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          sessionId: 'session-id',
          score: 1250,
          completionTime: 180,
          achievements: ['first_win', 'speed_demon'],
          performanceMetrics: { accuracy: 0.85, combo: 5 }
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('stats_id', 'stats-id');
      expect(response.body).toHaveProperty('session_id', 'session-id');
      expect(response.body).toHaveProperty('score', 1250);
      expect(response.body).toHaveProperty('completion_time', 180);
      expect(response.body).toHaveProperty('achievements_count', 2);
    });

    it('should reject duplicate statistics submission', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'session-id', status: 'completed' }] }) // Check session
        .mockResolvedValueOnce({ rows: [{ id: 'existing-stats' }] }); // Existing stats found

      const response = await request(app)
        .post('/api/v1/stats/match')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          sessionId: 'session-id',
          score: 1000
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should reject submission for non-participating session', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // No session participation

      const response = await request(app)
        .post('/api/v1/stats/match')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          sessionId: 'non-participating-session',
          score: 1000
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/stats/player/:userId', () => {
    it('should return player statistics', async () => {
      const mockStats = {
        games_played: 10,
        games_won: 7,
        games_lost: 3,
        total_score: 15000,
        best_score: 2000,
        skill_rating: 1250,
        win_streak: 3,
        last_played: '2024-01-01T12:00:00Z'
      };

      query.mockResolvedValueOnce({ rows: [mockStats] });

      const response = await request(app)
        .get('/api/v1/stats/player/player-id')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user_id', 'player-id');
      expect(response.body).toHaveProperty('games_played', 10);
      expect(response.body).toHaveProperty('games_won', 7);
      expect(response.body).toHaveProperty('games_lost', 3);
      expect(response.body).toHaveProperty('total_score', 15000);
      expect(response.body).toHaveProperty('best_score', 2000);
      expect(response.body).toHaveProperty('skill_rating', 1250);
      expect(response.body).toHaveProperty('win_rate', 70);
    });

    it('should return default stats for new players', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/v1/stats/player/new-player-id')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('games_played', 0);
      expect(response.body).toHaveProperty('games_won', 0);
      expect(response.body).toHaveProperty('games_lost', 0);
      expect(response.body).toHaveProperty('total_score', 0);
      expect(response.body).toHaveProperty('win_rate', 0);
      expect(response.body).toHaveProperty('average_score', 0);
    });

    it('should reject viewing non-friend stats', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }); // No friendship
        .mockResolvedValueOnce({ rows: [{
          games_played: 5,
          games_won: 3
        }] });

      const response = await request(app)
        .get('/api/v1/stats/player/other-player-id')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/stats/leaderboard', () => {
    it('should return leaderboard sorted by total score', async () => {
      const mockLeaderboard = [
        {
          user_id: 'player-1',
          username: 'topplayer',
          games_played: 20,
          games_won: 15,
          games_lost: 5,
          total_score: 25000,
          best_score: 3000,
          skill_rating: 1500,
          win_streak: 5,
          win_rate: 75
        },
        {
          user_id: 'player-2',
          username: 'goodplayer',
          games_played: 15,
          games_won: 10,
          games_lost: 5,
          total_score: 18000,
          best_score: 2500,
          skill_rating: 1300,
          win_streak: 3,
          win_rate: 66.7
        }
      ];

      query
        .mockResolvedValueOnce({ rows: mockLeaderboard }) // Leaderboard data
        .mockResolvedValueOnce({ rows: [{ total: '50' }] }); // Total count

      const response = await request(app)
        .get('/api/v1/stats/leaderboard?sortBy=total_score&limit=10');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('leaderboard');
      expect(response.body.leaderboard).toHaveLength(2);
      expect(response.body.leaderboard[0]).toHaveProperty('rank', 1);
      expect(response.body.leaderboard[0]).toHaveProperty('username', 'topplayer');
      expect(response.body.leaderboard[0]).toHaveProperty('total_score', 25000);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('total', 50);
      expect(response.body).toHaveProperty('sort_by', 'total_score');
    });

    it('should support different sort options', async () => {
      const mockLeaderboard = [
        {
          user_id: 'player-1',
          username: 'skilled',
          games_played: 10,
          games_won: 8,
          skill_rating: 1600,
          win_rate: 80
        }
      ];

      query
        .mockResolvedValueOnce({ rows: mockLeaderboard })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const response = await request(app)
        .get('/api/v1/stats/leaderboard?sortBy=skill_rating');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('sort_by', 'skill_rating');
    });

    it('should reject invalid sort options', async () => {
      const response = await request(app)
        .get('/api/v1/stats/leaderboard?sortBy=invalid_sort');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should filter by game mode', async () => {
      const mockLeaderboard = [
        {
          user_id: 'player-1',
          username: 'toybox_master',
          total_score: 15000
        }
      ];

      query
        .mockResolvedValueOnce({ rows: mockLeaderboard })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] });

      const response = await request(app)
        .get('/api/v1/stats/leaderboard?gameMode=toybox');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('game_mode_filter', 'toybox');
    });
  });

  describe('GET /api/v1/stats/recent', () => {
    it('should return recent matches for authenticated user', async () => {
      const mockMatches = [
        {
          stats_id: 'stats-1',
          session_id: 'session-1',
          game_mode: 'toybox',
          session_status: 'completed',
          ended_at: '2024-01-01T12:00:00Z',
          score: 1500,
          completion_time: 120,
          achievements: ['speed_run'],
          submitted_at: '2024-01-01T12:05:00Z',
          opponent: 'Player2'
        }
      ];

      query.mockResolvedValueOnce({ rows: mockMatches });

      const response = await request(app)
        .get('/api/v1/stats/recent')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('recent_matches');
      expect(response.body.recent_matches).toHaveLength(1);
      expect(response.body.recent_matches[0]).toHaveProperty('session_id', 'session-1');
      expect(response.body.recent_matches[0]).toHaveProperty('score', 1500);
      expect(response.body.recent_matches[0]).toHaveProperty('achievements');
      expect(response.body).toHaveProperty('count', 1);
    });

    it('should support pagination', async () => {
      const mockMatches = [
        {
          stats_id: 'stats-1',
          session_id: 'session-1',
          score: 1000
        }
      ];

      query.mockResolvedValueOnce({ rows: mockMatches });

      const response = await request(app)
        .get('/api/v1/stats/recent?limit=5&offset=10')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination).toHaveProperty('limit', 5);
      expect(response.body.pagination).toHaveProperty('offset', 10);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/stats/recent');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
