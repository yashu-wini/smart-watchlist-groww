import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPostgresPool, closePostgres } from '../src/infrastructure/postgres.js';
import { initializeDatabase } from '../src/infrastructure/init-db.js';
import { signToken } from '../src/auth/jwt.js';
import { hashPasswordSync } from '../src/auth/passwords.js';
import { config } from '../src/config.js';
import type { Express } from 'express';
import type pg from 'pg';

describe('User Isolation & Watchlist Ownership Enforcement Tests', () => {
  let app: Express;
  let pool: pg.Pool;

  let userA: { id: number; email: string; token: string };
  let userB: { id: number; email: string; token: string };
  let stockTcsId: number;
  let stockInfyId: number;

  beforeAll(async () => {
    pool = getPostgresPool({ database: config.postgres.testDatabase });
    await initializeDatabase(config.postgres.testDatabase);
    app = createApp({ db: pool });

    const tcsRes = await pool.query("SELECT id FROM stocks WHERE symbol = 'TCS';");
    stockTcsId = Number(tcsRes.rows[0].id);

    const infyRes = await pool.query("SELECT id FROM stocks WHERE symbol = 'INFY';");
    stockInfyId = Number(infyRes.rows[0].id);
  });

  beforeEach(async () => {
    // Truncate tables for fresh state
    await pool.query('DELETE FROM watchlist_check_state;');
    await pool.query('DELETE FROM watchlist_stocks;');
    await pool.query('DELETE FROM watchlists;');
    await pool.query('DELETE FROM users WHERE id > 1;');

    // Create User A
    const passwordHash = hashPasswordSync('password123');
    const resA = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ('usera@example.com', $1) RETURNING id, email;`,
      [passwordHash]
    );
    userA = {
      id: Number(resA.rows[0].id),
      email: resA.rows[0].email,
      token: signToken({ id: Number(resA.rows[0].id), email: resA.rows[0].email }),
    };

    // Create User B
    const resB = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ('userb@example.com', $1) RETURNING id, email;`,
      [passwordHash]
    );
    userB = {
      id: Number(resB.rows[0].id),
      email: resB.rows[0].email,
      token: signToken({ id: Number(resB.rows[0].id), email: resB.rows[0].email }),
    };
  });

  afterAll(async () => {
    await closePostgres(pool);
  });

  it('User A creates and owns Watchlist A, User A can access it successfully', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Portfolio" });

    expect(createRes.status).toBe(201);
    const watchlistId = createRes.body.id;

    // User A accesses own watchlist
    const getRes = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("User A's Portfolio");
  });

  it('User B cannot view User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Secret Watchlist" });

    const watchlistId = createRes.body.id;

    const res = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Watchlist not found');
  });

  it('User B cannot delete User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Protected Watchlist" });

    const watchlistId = createRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(deleteRes.status).toBe(404);
    expect(deleteRes.body.error).toBe('Watchlist not found');

    // Verify User A's watchlist still exists
    const checkRes = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${userA.token}`);
    expect(checkRes.status).toBe(200);
  });

  it('User B cannot add a stock to User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Tech Stocks" });

    const watchlistId = createRes.body.id;

    const addRes = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ stockId: stockTcsId });

    expect(addRes.status).toBe(404);
    expect(addRes.body.error).toBe('Watchlist not found');
  });

  it('User B cannot remove a stock from User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Tech Stocks" });

    const watchlistId = createRes.body.id;

    // User A adds TCS
    await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ stockId: stockTcsId });

    // User B attempts to remove TCS
    const removeRes = await request(app)
      .delete(`/api/watchlists/${watchlistId}/stocks/${stockTcsId}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(removeRes.status).toBe(404);
    expect(removeRes.body.error).toBe('Watchlist not found');

    // Verify stock is still in User A's watchlist
    const getRes = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${userA.token}`);
    expect(getRes.body.stocks.length).toBe(1);
    expect(getRes.body.stocks[0].symbol).toBe('TCS');
  });

  it('User B cannot trigger a checkpoint on User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Checkpoint Watchlist" });

    const watchlistId = createRes.body.id;

    const checkRes = await request(app)
      .post(`/api/watchlists/${watchlistId}/check`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(checkRes.status).toBe(404);
    expect(checkRes.body.error).toBe('Watchlist not found');
  });

  it('User B cannot retrieve intelligence for User A’s watchlist (returns 404 Watchlist not found)', async () => {
    const createRes = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "User A's Intelligence Watchlist" });

    const watchlistId = createRes.body.id;

    const intelRes = await request(app)
      .get(`/api/watchlists/${watchlistId}/intelligence`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(intelRes.status).toBe(404);
    expect(intelRes.body.error).toBe('Watchlist not found');
  });

  it('Each user sees only their own watchlists via GET /api/watchlists', async () => {
    // User A creates 2 watchlists
    await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "Watchlist A1" });

    await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: "Watchlist A2" });

    // User B creates 1 watchlist
    await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ name: "Watchlist B1" });

    // User A lists watchlists
    const resA = await request(app)
      .get('/api/watchlists')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(resA.status).toBe(200);
    expect(resA.body.watchlists.length).toBe(2);
    expect(resA.body.watchlists.map((w: any) => w.name)).toEqual(['Watchlist A1', 'Watchlist A2']);

    // User B lists watchlists
    const resB = await request(app)
      .get('/api/watchlists')
      .set('Authorization', `Bearer ${userB.token}`);

    expect(resB.status).toBe(200);
    expect(resB.body.watchlists.length).toBe(1);
    expect(resB.body.watchlists[0].name).toBe('Watchlist B1');
  });
});
