/**
 * Postgres connection (Neon in production, any Postgres 13+ locally).
 * The schema in server/schema.sql is applied on start, so a new database needs no manual setup.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

export type Db = pg.Pool;

/**
 * Accepts a Neon connection string exactly as copied from the Neon dashboard.
 * node-postgres does not understand `channel_binding`, so it is dropped; TLS stays on.
 */
export function normaliseDatabaseUrl(raw: string): { connectionString: string; ssl: boolean } {
  const url = new URL(raw.trim());
  url.searchParams.delete('channel_binding');
  const sslmode = url.searchParams.get('sslmode');
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const ssl = sslmode ? sslmode !== 'disable' : !isLocal;
  // The pool gets its TLS settings from the `ssl` option below, not from the URL
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl };
}

export function createDb(databaseUrl: string | undefined): Db | null {
  if (!databaseUrl) return null;
  const { connectionString, ssl } = normaliseDatabaseUrl(databaseUrl);
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    max: 5, // Neon's free plan allows plenty, but a small server needs no more
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000 // Neon's free database sleeps when idle and takes a moment to wake
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}

/** Creates or updates tables, views and seed rows. Safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const client = await db.connect();
  try {
    // One server at a time, in case two instances start together
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
}
