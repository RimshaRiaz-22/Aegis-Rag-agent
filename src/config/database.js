import pg from 'pg';
import pgvector from 'pgvector/pg';
import { config } from './env.js';

const { Pool, types } = pg;

export const pool = new Pool(config.database);

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', err);
});

/**
 * Health check ping and vector type registration
 */
export async function testDatabaseConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW() as current_time, current_database() as db;');

    // Register vector type parser globally for all clients
    try {
      const typeRes = await client.query(
        "SELECT typname, oid FROM pg_type WHERE typname IN ('vector', 'halfvec', 'sparsevec');"
      );
      for (const row of typeRes.rows) {
        types.setTypeParser(row.oid, (val) => pgvector.fromSql(val));
      }
    } catch (e) {
      // Vector extension not yet installed during initial migration
    }

    return {
      success: true,
      database: res.rows[0].db,
      timestamp: res.rows[0].current_time,
    };
  } finally {
    client.release();
  }
}
