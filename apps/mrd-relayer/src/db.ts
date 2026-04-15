import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mrd_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id VARCHAR(255) NOT NULL,
      kind VARCHAR(50) NOT NULL,
      payload JSONB NOT NULL,
      status VARCHAR(50) NOT NULL,
      tx_hash VARCHAR(66),
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}
