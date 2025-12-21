const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

describe('Admin Endpoints', () => {
  let adminToken;
  let moderatorToken;
  let regularToken;

  beforeEach(async () => {
    // Clean up test data
    await query('DELETE FROM toybox_ratings WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toybox_likes WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toybox_downloads WHERE user_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM toyboxes WHERE creator_id IN (SELECT id FROM users WHERE username LIKE \'test%\')');
    await query('DELETE FROM users WHERE username LIKE \'test%\'');

    // Create admin user
    const adminRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'testadmin',
        email: 'admin@test.com',
        password: 'password123'
      });

    // Manually set admin role (in real scenario this would be done differently)
    await query('UPDATE users SET is_admin = true WHERE username = $1', ['testadmin']);

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        username: 'testadmin',
        password: 'password123'
      });

    adminToken = adminLogin.body.token;

    // Create moderator user
    const modRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'testmod',
        email: 'mod@test.com',
        password: 'password123'
      });

    await query('UPDATE users SET is_moderator = true WHERE username = $1', ['testmod']);

    const modLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        username: 'testmod',
        password: 'password123'
      });

    moderatorToken = modLogin.body.token;

    // Create regular user
    const regularRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'testuser',
        email: 'user@test.com',
        password: 'password123'
      });

    const regularLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });

    regularToken = regularLogin.body.token;
  });

  describe('GET /api/v1/admin/stats', () => {
    test('should allow admin to get stats', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('users');
      expect(response.body).toHaveProperty('toyboxes');
      expect(response.body).toHaveProperty('downloads');
      expect(response.body).toHaveProperty('ratings');
    });

    test('should reject non-admin access', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${regularToken}`)
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.error).toHaveProperty('code', 'FORBIDDEN');
    });

    test('should reject without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });

  describe('PUT /api/v1/admin/toybox/{id}/status', () => {
    test('should allow moderator to approve toybox', async () => {
      // Create a toybox in review status
      const result = await query(`
        INSERT INTO toyboxes (creator_id, title, description, status, version)
        VALUES ((SELECT id FROM users WHERE username = 'testuser'), 'Test Toybox', 'Description', 1, 3)
        RETURNING id
      `);
      const toyboxId = result.rows[0].id;

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'approved' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('id', toyboxId);
      expect(response.body).toHaveProperty('status', 'approved');
    });

    test('should allow moderator to publish toybox', async () => {
      const result = await query(`
        INSERT INTO toyboxes (creator_id, title, description, status, version)
        VALUES ((SELECT id FROM users WHERE username = 'testuser'), 'Test Toybox', 'Description', 1, 3)
        RETURNING id
      `);
      const toyboxId = result.rows[0].id;

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'published' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'published');
    });

    test('should reject invalid status', async () => {
      const toyboxId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'invalid_status' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    test('should reject non-existent toybox', async () => {
      const toyboxId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'approved' })
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });

    test('should reject non-moderator access', async () => {
      const toyboxId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/status`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ status: 'approved' })
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.error).toHaveProperty('code', 'FORBIDDEN');
    });
  });

  describe('DELETE /api/v1/admin/toybox/{id}', () => {
    test('should allow admin to delete toybox', async () => {
      // Create a test toybox
      const result = await query(`
        INSERT INTO toyboxes (creator_id, title, description, status, version)
        VALUES ((SELECT id FROM users WHERE username = 'testuser'), 'Test Toybox', 'Description', 1, 3)
        RETURNING id
      `);
      const toyboxId = result.rows[0].id;

      const response = await request(app)
        .delete(`/api/v1/admin/toybox/${toyboxId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Toybox deleted successfully');
    });

    test('should reject non-admin access', async () => {
      const toyboxId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(app)
        .delete(`/api/v1/admin/toybox/${toyboxId}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.error).toHaveProperty('code', 'FORBIDDEN');
    });
  });

  describe('GET /api/v1/admin/reviews/pending', () => {
    test('should allow moderator to get pending reviews', async () => {
      const response = await request(app)
        .get('/api/v1/admin/reviews/pending')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('pending_reviews');
      expect(Array.isArray(response.body.pending_reviews)).toBe(true);
      expect(response.body).toHaveProperty('count');
    });

    test('should reject non-moderator access', async () => {
      const response = await request(app)
        .get('/api/v1/admin/reviews/pending')
        .set('Authorization', `Bearer ${regularToken}`)
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.error).toHaveProperty('code', 'FORBIDDEN');
    });
  });

  describe('PUT /api/v1/admin/toybox/{id}/feature', () => {
    test('should allow moderator to feature toybox', async () => {
      // Create a published toybox
      const result = await query(`
        INSERT INTO toyboxes (creator_id, title, description, status, version, featured)
        VALUES ((SELECT id FROM users WHERE username = 'testuser'), 'Test Toybox', 'Description', 3, 3, false)
        RETURNING id
      `);
      const toyboxId = result.rows[0].id;

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/feature`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ featured: true })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('id', toyboxId);
      expect(response.body).toHaveProperty('featured', true);
    });

    test('should allow moderator to unfeature toybox', async () => {
      const result = await query(`
        INSERT INTO toyboxes (creator_id, title, description, status, version, featured)
        VALUES ((SELECT id FROM users WHERE username = 'testuser'), 'Test Toybox', 'Description', 3, 3, true)
        RETURNING id
      `);
      const toyboxId = result.rows[0].id;

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/feature`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ featured: false })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('featured', false);
    });

    test('should reject invalid featured value', async () => {
      const toyboxId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(app)
        .put(`/api/v1/admin/toybox/${toyboxId}/feature`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ featured: 'invalid' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });
  });
});
