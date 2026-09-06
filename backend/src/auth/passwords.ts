import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Hashes a plaintext password securely using bcrypt with 10 salt rounds.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Synchronous version for seeding or init utilities.
 */
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
