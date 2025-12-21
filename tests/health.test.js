const request = require('supertest');
const app = require('../server');
const monitoring = require('../services/monitoring');

describe('Health Check', () => {
  test('GET /api/v1/health returns dynamic server status', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(['healthy', 'warning', 'critical']).toContain(response.body.status);
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('version', '1.0.0');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('checks');

    // Check health checks structure
    expect(response.body.checks).toHaveProperty('database');
    expect(response.body.checks).toHaveProperty('memory');
    expect(response.body.checks).toHaveProperty('requests');
    expect(response.body.checks).toHaveProperty('websocket');

    // Database check should have proper structure
    expect(response.body.checks.database).toHaveProperty('status');
    expect(['ok', 'error']).toContain(response.body.checks.database.status);
    expect(response.body.checks.database).toHaveProperty('response_time');
    expect(typeof response.body.checks.database.response_time).toBe('number');
  });

  test('GET /api/v1/health returns critical status on database failure', async () => {
    // Mock database failure scenario
    const monitoring = require('../services/monitoring');

    // Temporarily modify monitoring to simulate database failure
    const originalGetHealthStatus = monitoring.getHealthStatus;
    monitoring.getHealthStatus = async () => ({
      status: 'critical',
      message: 'Database connection failed',
      timestamp: Date.now(),
      uptime: 1000,
      checks: {
        database: { status: 'error', response_time: 0, query_count: 0, error_count: 1, message: 'Connection failed' },
        memory: { status: 'ok', current_mb: 100, peak_mb: 120, average_mb: 110 },
        requests: { status: 'ok', total: 10, error_rate: 0, average_response_time: 50 },
        websocket: { status: 'ok', active_connections: 5, total_messages: 20, errors: 0 }
      }
    });

    const response = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(503); // Critical status should return 503

    expect(response.body).toHaveProperty('status', 'critical');
    expect(response.body.message).toContain('Database connection failed');

    // Restore original function
    monitoring.getHealthStatus = originalGetHealthStatus;
  });

  test('GET /api/v1/info returns server information', async () => {
    const response = await request(app)
      .get('/api/v1/info')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toHaveProperty('name');
    expect(response.body).toHaveProperty('description');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('endpoints');
    expect(response.body).toHaveProperty('features');
  });
});

describe('API Endpoints', () => {
  test('GET /api/v1/toybox returns placeholder response', async () => {
    const response = await request(app)
      .get('/api/v1/toybox')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('total', 0);
    expect(response.body).toHaveProperty('message');
  });

  test('POST /api/v1/toybox returns not implemented', async () => {
    const response = await request(app)
      .post('/api/v1/toybox')
      .expect('Content-Type', /json/)
      .expect(501);

    expect(response.body.error).toHaveProperty('code', 'NOT_IMPLEMENTED');
  });

  test('POST /api/v1/auth/register returns not implemented', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .expect('Content-Type', /json/)
      .expect(501);

    expect(response.body.error).toHaveProperty('code', 'NOT_IMPLEMENTED');
  });

  test('Unknown endpoint returns 404', async () => {
    const response = await request(app)
      .get('/api/v1/unknown')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(response.body.error).toHaveProperty('code', 'ENDPOINT_NOT_FOUND');
  });

  test('GET /api/v1/admin/alerts returns alert summary (requires admin)', async () => {
    const response = await request(app)
      .get('/api/v1/admin/alerts')
      .expect('Content-Type', /json/)
      .expect(401); // Should require authentication

    expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  test('PUT /api/v1/admin/alerts/thresholds updates thresholds (requires admin)', async () => {
    const response = await request(app)
      .put('/api/v1/admin/alerts/thresholds')
      .send({
        thresholds: {
          error_rate_warning: 15,
          memory_warning: 600
        }
      })
      .expect('Content-Type', /json/)
      .expect(401); // Should require authentication

    expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });
});





