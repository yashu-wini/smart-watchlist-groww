import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPostgresPool, closePostgres } from './postgres.js';
import { config } from '../config.js';

import { hashPasswordSync } from '../auth/passwords.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initializeDatabase(dbName?: string): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const targetDb = dbName ?? config.postgres.database;

  console.log(`[Database Init] Reading schema from: ${schemaPath}`);
  const schemaSql = await fs.readFile(schemaPath, 'utf-8');

  console.log(`[Database Init] Initializing database: "${targetDb}" on ${config.postgres.host}:${config.postgres.port}...`);
  const pool = getPostgresPool(dbName ? { database: dbName } : undefined);

  try {
    // 1. Execute DDL
    await pool.query(schemaSql);

    // 2. Safe idempotent migrations for existing users table
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    `);

    // 3. Seed/update default development User 1 with safe credentials
    const defaultDevHash = hashPasswordSync('password123');
    await pool.query(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES (1, 'dev@example.com', $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET email = COALESCE(users.email, 'dev@example.com'),
           password_hash = COALESCE(users.password_hash, $1);`,
      [defaultDevHash]
    );

    // 4. Seed initial stock catalog
    await pool.query(`
      INSERT INTO stocks (symbol, company_name, exchange)
      VALUES 
        ('TCS', 'Tata Consultancy Services', 'NSE'),
        ('INFY', 'Infosys', 'NSE'),
        ('RELIANCE', 'Reliance Industries', 'NSE'),
        ('HDFCBANK', 'HDFC Bank', 'NSE'),
        ('ICICIBANK', 'ICICI Bank', 'NSE'),
        ('SBIN', 'State Bank of India', 'NSE'),
        ('TATAMOTORS', 'Tata Motors', 'NSE'),
        ('WIPRO', 'Wipro', 'NSE')
      ON CONFLICT (symbol, exchange) DO NOTHING;
    `);
    console.log(`[Database Init] Successfully initialized schema in "${targetDb}".`);
  } catch (error) {
    console.error('[Database Init] Failed to initialize database schema:', error instanceof Error ? error.message : error);
    throw error;
  } finally {
    await closePostgres(pool);
  }
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
