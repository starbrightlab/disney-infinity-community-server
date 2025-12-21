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

describe('Presence API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockToken = 'mock.jwt.token.for.presence.testing';

  describe('POST /api/v1/presence/update', () => {
    it('should update user presence successfully', async () => {
      query.mockResolvedValueOnce({}); // Mock successful update

      const response = await request(app)
        .post('/api/v1/presence/update')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          status: 'online',
          currentGameMode: 'toybox'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'presence_updated');
      expect(response.body).toHaveProperty('user_id');
      expect(response.body.presence.status).toBe('online');
      expect(response.body.presence.current_game_mode).toBe('toybox');
    });

    it('should validate presence status', async () => {
      const response = await request(app)
        .post('/api/v1/presence/update')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          status: 'invalid_status',
          currentGameMode: 'toybox'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/presence/update')
        .send({
          status: 'online'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/presence/me', () => {
    it('should return current user presence', async () => {
      const mockPresence = {
        status: 'online',
        last_seen: '2024-01-01T12:00:00Z',
        current_game_mode: 'adventure',
        current_session_id: 'session-123',
        steam_status: { game: 'Disney Infinity' }
      };

      query.mockResolvedValueOnce({ rows: [mockPresence] });

      const response = await request(app)
        .get('/api/v1/presence/me')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'online');
      expect(response.body).toHaveProperty('current_game_mode', 'adventure');
      expect(response.body).toHaveProperty('steam_status');
    });

    it('should return default presence when no data exists', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/v1/presence/me')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'offline');
      expect(response.body.last_seen).toBeNull();
    });
  });

  describe('GET /api/v1/presence/friends', () => {
    it('should return friends presence list', async () => {
      const mockFriends = [
        {
          friend_id: 'friend-1',
          username: 'friend1',
          status: 'online',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'toybox',
          friendship_added_at: '2024-01-01T00:00:00Z'
        },
        {
          friend_id: 'friend-2',
          username: 'friend2',
          status: 'offline',
          last_seen: '2024-01-01T10:00:00Z',
          current_game_mode: null,
          friendship_added_at: '2024-01-01T00:00:00Z'
        }
      ];

      const mockCount = { total: '2' };

      query
        .mockResolvedValueOnce({ rows: mockFriends })
        .mockResolvedValueOnce({ rows: [mockCount] });

      const response = await request(app)
        .get('/api/v1/presence/friends')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('friends');
      expect(response.body.friends).toHaveLength(2);
      expect(response.body).toHaveProperty('total_friends', 2);
      expect(response.body).toHaveProperty('online_count', 1);
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should support offline inclusion filter', async () => {
      const mockFriends = [
        {
          friend_id: 'friend-1',
          username: 'friend1',
          status: 'online',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'toybox',
          friendship_added_at: '2024-01-01T00:00:00Z'
        }
      ];

      query
        .mockResolvedValueOnce({ rows: mockFriends })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const response = await request(app)
        .get('/api/v1/presence/friends?includeOffline=false')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.friends).toHaveLength(1);
      expect(response.body.friends[0].status).toBe('online');
    });
  });

  describe('GET /api/v1/presence/friends/online', () => {
    it('should return only online friends', async () => {
      const mockOnlineFriends = [
        {
          friend_id: 'friend-1',
          username: 'friend1',
          status: 'online',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'toybox',
          friendship_added_at: '2024-01-01T00:00:00Z'
        },
        {
          friend_id: 'friend-3',
          username: 'friend3',
          status: 'in_game',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'adventure',
          friendship_added_at: '2024-01-01T00:00:00Z'
        }
      ];

      query.mockResolvedValueOnce({ rows: mockOnlineFriends });

      const response = await request(app)
        .get('/api/v1/presence/friends/online')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('online_friends');
      expect(response.body.online_friends).toHaveLength(2);
      expect(response.body).toHaveProperty('count', 2);
      expect(response.body.online_friends.every(f => f.status === 'online' || f.status === 'in_game')).toBe(true);
    });
  });

  describe('POST /api/v1/presence/bulk', () => {
    it('should handle bulk presence queries', async () => {
      const mockPresenceMap = {
        'friend-1': {
          user_id: 'friend-1',
          username: 'friend1',
          status: 'online',
          last_seen: '2024-01-01T12:00:00Z'
        }
      };

      query
        .mockResolvedValueOnce({ rows: [] }) // Friends check
        .mockResolvedValueOnce({ rows: [] }); // Presence query

      const response = await request(app)
        .post('/api/v1/presence/bulk')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          userIds: ['friend-1', 'friend-2']
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('presence');
      expect(response.body).toHaveProperty('requested_count', 2);
      expect(response.body).toHaveProperty('returned_count', 0);
    });

    it('should validate userIds array', async () => {
      const response = await request(app)
        .post('/api/v1/presence/bulk')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          userIds: []
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject too many user IDs', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => `user-${i}`);

      const response = await request(app)
        .post('/api/v1/presence/bulk')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          userIds: tooManyIds
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });
  });
});
