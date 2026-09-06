import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPostgresPool, closePostgres } from '../src/infrastructure/postgres.js';
import { initializeDatabase } from '../src/infrastructure/init-db.js';
import { config } from '../src/config.js';
import type { Express } from 'express';
import type pg from 'pg';

import { hashPasswordSync } from '../src/auth/passwords.js';

describe('Authentication API Tests (/api/auth)', () => {
  let app: Express;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = getPostgresPool({ database: config.postgres.testDatabase });
    await initializeDatabase(config.postgres.testDatabase);
    app = createApp({ db: pool });
  });

  beforeEach(async () => {
    // Clean users except dev user 1
    await pool.query('DELETE FROM users WHERE id > 1;');
    const devHash = hashPasswordSync('password123');
    await pool.query(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES (1, 'dev@example.com', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET password_hash = $1, email = 'dev@example.com';`,
      [devHash]
    );
  });

  afterAll(async () => {
    await closePostgres(pool);
  });

  // ==========================================
  // REGISTRATION
  // ==========================================
  describe('POST /api/auth/register', () => {
    it('registers a new user successfully with valid email and password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'Alice@Example.COM',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe('alice@example.com');
      expect(res.body.user.id).toBeTypeOf('number');
      expect(res.body.user).not.toHaveProperty('password');
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('rejects registration with missing or invalid email format', async () => {
      const res1 = await request(app)
        .post('/api/auth/register')
        .send({
          password: 'password123',
        });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('Email is required');

      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'password123',
        });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('Invalid email format');
    });

    it('rejects registration with short password (< 8 characters)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'bob@example.com',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Password must be at least 8 characters');
    });

    it('rejects duplicate email registration with 409 Conflict', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'charlie@example.com',
          password: 'password123',
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'CHARLIE@example.com',
          password: 'anotherPassword123',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });
  });

  // ==========================================
  // LOGIN
  // ==========================================
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'david@example.com',
          password: 'securePassword123',
        });
    });

    it('logs in successfully with valid credentials and returns signed JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'DAVID@example.com',
          password: 'securePassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe('david@example.com');
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.length).toBeGreaterThan(20);
    });

    it('logs in default development user (dev@example.com / password123)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'dev@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(1);
      expect(res.body.user.email).toBe('dev@example.com');
      expect(res.body).toHaveProperty('token');
    });

    it('rejects login with incorrect password with generic 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'david@example.com',
          password: 'wrongPassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects login with unknown email with generic 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'securePassword123',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  // ==========================================
  // ME (/api/auth/me)
  // ==========================================
  describe('GET /api/auth/me', () => {
    let validToken: string;

    beforeEach(async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'eve@example.com',
          password: 'mypassword123',
        });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'eve@example.com',
          password: 'mypassword123',
        });

      validToken = loginRes.body.token;
    });

    it('returns authenticated user identity when valid Bearer token is provided', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('eve@example.com');
      expect(res.body.user.id).toBeTypeOf('number');
    });

    it('rejects request with missing Authorization header with 401', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('rejects request with malformed or invalid token with 401', async () => {
      const res1 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-garbage-token');

      expect(res1.status).toBe(401);
      expect(res1.body.error).toBe('Authentication required');

      const res2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Basic some-other-auth');

      expect(res2.status).toBe(401);
      expect(res2.body.error).toBe('Authentication required');
    });
  });
});
