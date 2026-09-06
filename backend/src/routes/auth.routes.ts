import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // 1. POST /api/auth/register
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Password is required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Check if duplicate
      const existing = await db.query('SELECT id FROM users WHERE email = $1;', [normalizedEmail]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await hashPassword(password);

      const result = await db.query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email;`,
        [normalizedEmail, passwordHash]
      );

      const row = result.rows[0];
      return res.status(201).json({
        user: {
          id: Number(row.id),
          email: row.email,
        },
      });
    } catch (error: any) {
      if (error && (error.code === '23505' || String(error.message).includes('unique'))) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      console.error('[Auth API] Error during registration:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // 2. POST /api/auth/login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};

      if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const result = await db.query(
        'SELECT id, email, password_hash FROM users WHERE email = $1;',
        [normalizedEmail]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];
      const isPasswordValid = await verifyPassword(password, user.password_hash);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken({
        id: Number(user.id),
        email: user.email,
      });

      return res.status(200).json({
        user: {
          id: Number(user.id),
          email: user.email,
        },
        token,
      });
    } catch (error) {
      console.error('[Auth API] Error during login:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // 3. GET /api/auth/me
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const result = await db.query(
        'SELECT id, email FROM users WHERE id = $1;',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const user = result.rows[0];
      return res.status(200).json({
        user: {
          id: Number(user.id),
          email: user.email,
        },
      });
    } catch (error) {
      console.error('[Auth API] Error during /me:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}

export const authRouter = createAuthRouter();
