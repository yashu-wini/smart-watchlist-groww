import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export interface TokenPayload {
  id: number;
  email: string;
}

/**
 * Signs a JWT token with the authenticated user ID and email.
 */
export function signToken(payload: TokenPayload, secret: string = config.jwtSecret, expiresIn: string = '7d'): string {
  const options: SignOptions = {
    expiresIn: expiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
    },
    secret as Secret,
    options
  );
}

/**
 * Verifies and decodes a JWT token.
 * Throws an error if invalid, expired, or malformed.
 */
export function verifyToken(token: string, secret: string = config.jwtSecret): TokenPayload {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & { id?: unknown; email?: unknown };
  
  if (!decoded || typeof decoded !== 'object' || typeof decoded.id !== 'number' || typeof decoded.email !== 'string') {
    throw new Error('Invalid token payload structure');
  }

  return {
    id: decoded.id,
    email: decoded.email,
  };
}
