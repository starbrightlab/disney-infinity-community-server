const request = require('supertest');
const app = require('../server');

describe('Health Check', () => {
  test('GET /api/v1/health returns server status', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('timestamp');
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
});





