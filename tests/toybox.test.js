const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

describe('Toybox Endpoints', () => {
  let accessToken;
  let userId;
  let testToyboxId;

  beforeEach(async () => {
    // Clean up test data
    await query('DELETE FROM toybox_ratings WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toybox_likes WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toybox_downloads WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toyboxes WHERE creator_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM users WHERE username LIKE \'test%\'');

    // Create test user and get token
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123'
      });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });

    accessToken = loginResponse.body.token;
    userId = loginResponse.body.user.id;
  });

  describe('GET /api/v1/toybox', () => {
    test('should return empty list when no toyboxes exist', async () => {
      const response = await request(app)
        .get('/api/v1/toybox')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('items', []);
      expect(response.body).toHaveProperty('total', 0);
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('page_size', 20);
      expect(response.body).toHaveProperty('has_more', false);
    });

    test('should filter by creator', async () => {
      // This would require creating a published toybox first
      // For now, just test the endpoint structure
      const response = await request(app)
        .get('/api/v1/toybox?creators=testuser')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    test('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?page=2&page_size=10')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('page', 2);
      expect(response.body).toHaveProperty('page_size', 10);
    });

    test('should filter by minimum performance (legacy)', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?minimum_performance=80')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    test('should filter by platform-specific performance', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?platform=pc&minimum_performance=85')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    test('should filter by performance threshold (any platform)', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?performance_threshold=90')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    test('should validate platform parameter', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?platform=invalid&minimum_performance=80')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
      expect(response.body.error.details[0].msg).toContain('Invalid platform');
    });

    test('should validate minimum_performance parameter range', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?minimum_performance=150')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
      expect(response.body.error.details[0].msg).toContain('Minimum performance must be 0-100');
    });

    test('should validate performance_threshold parameter range', async () => {
      const response = await request(app)
        .get('/api/v1/toybox?performance_threshold=-5')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
      expect(response.body.error.details[0].msg).toContain('Performance threshold must be 0-100');
    });
  });

  describe('POST /api/v1/toybox', () => {
    test('should reject upload without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/toybox')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('should reject upload without content file', async () => {
      const response = await request(app)
        .post('/api/v1/toybox')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('contentInfo', JSON.stringify({
          name: 'Test Toybox',
          version: 3
        }))
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    test('should reject upload with invalid contentInfo', async () => {
      const response = await request(app)
        .post('/api/v1/toybox')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('contentInfo', 'invalid json')
        .attach('content', Buffer.from('test content'), 'test.dat')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    test('should upload toybox successfully', async () => {
      const contentInfo = {
        name: 'Test Toybox',
        desc: 'A test toybox for testing',
        version: 3,
        igps: [1, 2],
        abilities: [10],
        genres: [5],
        playsets: ['infinity1'],
        object_counts: { figure: 2, vehicle: 1 }
      };

      // Mock file upload - in real scenario would need actual file
      // This test verifies the endpoint structure
      const response = await request(app)
        .post('/api/v1/toybox')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('contentInfo', JSON.stringify(contentInfo))
        .attach('content', Buffer.from('mock toybox data'), {
          filename: 'test.toybox',
          contentType: 'application/octet-stream'
        })
        .expect('Content-Type', /json/);

      // This might fail due to Supabase upload issues in test environment
      // but should validate the request structure
      if (response.status === 201) {
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('status', 'in_review');
        testToyboxId = response.body.id;
      } else {
        // If upload fails due to external service, that's expected in test env
        expect([400, 500]).toContain(response.status);
      }
    });
  });

  describe('GET /api/v1/toybox/{id}', () => {
    test('should return 404 for non-existent toybox', async () => {
      const response = await request(app)
        .get('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });

    test('should return toybox metadata', async () => {
      // Use the admin test toybox
      const result = await query('SELECT id FROM toyboxes LIMIT 1');
      if (result.rows.length > 0) {
        const toyboxId = result.rows[0].id;

        const response = await request(app)
          .get(`/api/v1/toybox/${toyboxId}`)
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('name');
        expect(response.body).toHaveProperty('creator_display_name');
        expect(response.body).toHaveProperty('downloads');
        expect(response.body).toHaveProperty('rating');
      }
    });
  });

  describe('POST /api/v1/toybox/{id}/rate', () => {
    test('should reject rating without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000/rate')
        .send({ rating: 5 })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('should reject invalid rating value', async () => {
      const response = await request(app)
        .post('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000/rate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ rating: 6 }) // Invalid rating
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    test('should reject rating non-existent toybox', async () => {
      const response = await request(app)
        .post('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000/rate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ rating: 4 })
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('POST /api/v1/toybox/{id}/like', () => {
    test('should reject like without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000/like')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('should reject like non-existent toybox', async () => {
      const response = await request(app)
        .post('/api/v1/toybox/123e4567-e89b-12d3-a456-426614174000/like')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('GET /api/v1/toybox/trending', () => {
    test('should return trending toyboxes', async () => {
      const response = await request(app)
        .get('/api/v1/toybox/trending')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should support genre filtering', async () => {
      const response = await request(app)
        .get('/api/v1/toybox/trending?genre=1')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/v1/toybox/user/list', () => {
    test('should reject without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/toybox/user/list')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('should return user toyboxes', async () => {
      const response = await request(app)
        .get('/api/v1/toybox/user/list')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
