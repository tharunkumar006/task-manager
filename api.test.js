/**
 * tests/api.test.js
 * Run with: npm test
 */

process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';
process.env.DB_PATH    = './test_taskmanager.db';
process.env.PORT       = '3001';

const request = require('supertest');
const { app }  = require('../src/server');

let token, taskId;

// Clean up test DB after all tests
afterAll(() => {
  try { require('fs').unlinkSync('./test_taskmanager.db'); } catch {}
});

// ── AUTH ──────────────────────────────────────────────────────────────────
describe('Auth', () => {
  it('registers a new user', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test User', email: 'test@test.com', password: 'test1234'
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    token = res.body.token;
  });

  it('rejects duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test User', email: 'test@test.com', password: 'test1234'
    });
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'test@test.com', password: 'test1234'
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'test@test.com', password: 'wrongpassword'
    });
    expect(res.status).toBe(401);
  });

  it('returns current user with valid token', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@test.com');
  });
});

// ── TASKS ─────────────────────────────────────────────────────────────────
describe('Tasks', () => {
  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('creates a task', async () => {
    const res = await request(app).post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test task', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Test task');
    taskId = res.body.data.id;
  });

  it('lists tasks', async () => {
    const res = await request(app).get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('gets a single task', async () => {
    const res = await request(app).get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(taskId);
  });

  it('updates task status', async () => {
    const res = await request(app).patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inprogress' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('inprogress');
  });

  it('gets stats', async () => {
    const res = await request(app).get('/api/tasks/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.total).toBe('number');
  });

  it('deletes a task', async () => {
    const res = await request(app).delete(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for deleted task', async () => {
    const res = await request(app).get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
