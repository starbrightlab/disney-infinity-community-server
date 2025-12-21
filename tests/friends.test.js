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

// Mock the socket notifications
jest.mock('../socket', () => ({
  sendNotificationToUser: jest.fn()
}));

describe('Friends API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockToken = 'mock.jwt.token.for.friends.testing';

  describe('POST /api/v1/friends/request', () => {
    it('should send friend request successfully', async () => {
      const mockTargetUser = {
        id: 'target-user-id',
        username: 'targetuser'
      };

      query
        .mockResolvedValueOnce({ rows: [] }) // Check existing friendship
        .mockResolvedValueOnce({ rows: [] }) // Check existing request
        .mockResolvedValueOnce({ rows: [mockTargetUser] }) // Get target user
        .mockResolvedValueOnce({ rows: [{ id: 'request-id', created_at: '2024-01-01T12:00:00Z' }] }); // Create request

      const response = await request(app)
        .post('/api/v1/friends/request')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          targetUserId: 'target-user-id',
          message: 'Let\'s be friends!'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('request_id', 'request-id');
      expect(response.body).toHaveProperty('target_user');
      expect(response.body.target_user.username).toBe('targetuser');
      expect(response.body).toHaveProperty('status', 'sent');
    });

    it('should reject friend request to self', async () => {
      const response = await request(app)
        .post('/api/v1/friends/request')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          targetUserId: 'self-user-id' // Would be decoded from token
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject duplicate friend requests', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // No existing friendship
        .mockResolvedValueOnce({ rows: [{ id: 'existing-request' }] }); // Existing request

      const response = await request(app)
        .post('/api/v1/friends/request')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          targetUserId: 'target-user-id'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/friends/request')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('POST /api/v1/friends/accept', () => {
    it('should accept friend request successfully', async () => {
      const mockRequest = {
        id: 'request-id',
        sender_id: 'sender-id',
        receiver_id: 'receiver-id',
        status: 'pending'
      };

      query
        .mockResolvedValueOnce({ rows: [mockRequest] }) // Get request
        .mockResolvedValueOnce({}) // Update request
        .mockResolvedValueOnce({}); // Create friendships

      const response = await request(app)
        .post('/api/v1/friends/accept')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          requestId: 'request-id'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('request_id', 'request-id');
      expect(response.body).toHaveProperty('friend');
      expect(response.body).toHaveProperty('friendship_created', true);
    });

    it('should reject accepting processed requests', async () => {
      query.mockResolvedValueOnce({ rows: [{ status: 'accepted' }] }); // Already processed

      const response = await request(app)
        .post('/api/v1/friends/accept')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          requestId: 'request-id'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/v1/friends/decline', () => {
    it('should decline friend request successfully', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // Update request
        .mockResolvedValueOnce({ rows: [{ id: 'request-id' }] }); // Confirm update

      const response = await request(app)
        .post('/api/v1/friends/decline')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          requestId: 'request-id'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('request_id', 'request-id');
      expect(response.body).toHaveProperty('status', 'declined');
    });
  });

  describe('DELETE /api/v1/friends/remove/:friendId', () => {
    it('should remove friend successfully', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'friendship-id' }] }) // Check friendship
        .mockResolvedValueOnce({}); // Remove friendship

      const response = await request(app)
        .delete('/api/v1/friends/remove/friend-id')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('friend_id', 'friend-id');
      expect(response.body).toHaveProperty('status', 'removed');
    });

    it('should reject removing non-friends', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // No friendship

      const response = await request(app)
        .delete('/api/v1/friends/remove/friend-id')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/friends/list', () => {
    it('should return friend list with presence', async () => {
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
        .mockResolvedValueOnce({ rows: mockFriends }) // Get friends
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }); // Get count

      const response = await request(app)
        .get('/api/v1/friends/list')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('friends');
      expect(response.body.friends).toHaveLength(1);
      expect(response.body).toHaveProperty('total_friends', 1);
      expect(response.body).toHaveProperty('online_count', 1);
      expect(response.body).toHaveProperty('pagination');
    });

    it('should support pagination', async () => {
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
        .mockResolvedValueOnce({ rows: mockFriends }) // Get friends
        .mockResolvedValueOnce({ rows: [{ total: '10' }] }); // Get count

      const response = await request(app)
        .get('/api/v1/friends/list?limit=5&offset=5')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination).toHaveProperty('limit', 5);
      expect(response.body.pagination).toHaveProperty('offset', 5);
      expect(response.body.pagination).toHaveProperty('has_more', false);
    });
  });

  describe('GET /api/v1/friends/online', () => {
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
          friend_id: 'friend-2',
          username: 'friend2',
          status: 'in_game',
          last_seen: '2024-01-01T12:00:00Z',
          current_game_mode: 'adventure',
          friendship_added_at: '2024-01-01T00:00:00Z'
        }
      ];

      query.mockResolvedValueOnce({ rows: mockOnlineFriends });

      const response = await request(app)
        .get('/api/v1/friends/online')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('online_friends');
      expect(response.body.online_friends).toHaveLength(2);
      expect(response.body).toHaveProperty('count', 2);
      expect(response.body.online_friends.every(f => f.status === 'online' || f.status === 'in_game')).toBe(true);
    });
  });

  describe('POST /api/v1/friends/invite', () => {
    it('should send game invitation successfully', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'friendship-id' }] }) // Check friendship
        .mockResolvedValueOnce({ rows: [{ // Check session
          id: 'session-id',
          game_mode: 'toybox',
          status: 'waiting',
          current_players: 1,
          max_players: 4
        }] });

      const response = await request(app)
        .post('/api/v1/friends/invite')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          friendId: 'friend-id',
          sessionId: 'session-id',
          message: 'Join my game!'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('invitation_sent', true);
      expect(response.body).toHaveProperty('friend_id', 'friend-id');
      expect(response.body).toHaveProperty('session_id', 'session-id');
    });

    it('should reject invitation to non-friends', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // No friendship

      const response = await request(app)
        .post('/api/v1/friends/invite')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          friendId: 'non-friend-id',
          sessionId: 'session-id'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject invitation to full session', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'friendship-id' }] }) // Check friendship
        .mockResolvedValueOnce({ rows: [{ // Check session (full)
          id: 'session-id',
          game_mode: 'toybox',
          status: 'waiting',
          current_players: 4,
          max_players: 4
        }] });

      const response = await request(app)
        .post('/api/v1/friends/invite')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          friendId: 'friend-id',
          sessionId: 'session-id'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });
});
