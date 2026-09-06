import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type TokenPayload } from '../auth/jwt.js';

export interface AuthenticatedUser {
  id: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Express middleware to require a valid Bearer JWT token in Authorization header.
 * Attaches the authenticated user identity { id, email } to req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parts = authHeader.trim().split(' ');
  const scheme = parts[0];
  const token = parts[1];

  if (parts.length !== 2 || !scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload: TokenPayload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
}
