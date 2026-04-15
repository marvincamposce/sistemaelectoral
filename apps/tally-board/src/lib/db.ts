import { Pool } from "pg";
import { getEnv } from "./env";

const globalForDb = global as unknown as { pool: Pool };

export const pool =
  globalForDb.pool ||
  new Pool({
    connectionString: getEnv().DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;
