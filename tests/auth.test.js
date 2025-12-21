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

describe('Authentication API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      // Mock database responses
      query
        .mockResolvedValueOnce({ rows: [] }) // Check existing user
        .mockResolvedValueOnce({ // Insert new user
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            username: 'testuser',
            email: 'test@example.com',
            created_at: '2024-01-01T00:00:00Z'
          }]
        });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('username', 'testuser');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refresh_token');
    });

    it('should reject registration with existing username', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] }); // Existing user found

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'existinguser',
          email: 'test@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.details).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login user successfully', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        username: 'testuser',
        email: 'test@example.com',
        password_hash: '$2b$10$mock.hash',
        is_active: true
      };

      query
        .mockResolvedValueOnce({ rows: [mockUser] }) // Find user
        .mockResolvedValueOnce({ rows: [] }); // Update last login

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testuser',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body.user.username).toBe('testuser');
    });

    it('should reject invalid credentials', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // User not found

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent',
          password: 'wrongpass'
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/auth/profile', () => {
    it('should return user profile with authentication', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        username: 'testuser',
        email: 'test@example.com',
        profile_data: { display_name: 'Test User' },
        created_at: '2024-01-01T00:00:00Z',
        last_login: '2024-01-02T00:00:00Z',
        toyboxes_created: '5',
        toyboxes_downloaded: '10',
        total_downloads: '25'
      };

      query.mockResolvedValueOnce({ rows: [mockUser] });

      const token = 'mock.jwt.token';

      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('username', 'testuser');
      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats.toyboxes_created).toBe(5);
    });

    it('should reject without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});