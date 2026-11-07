import { createPool, migrate } from "./db.js";
const pool = createPool(
  (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)!,
);
try {
  await migrate(pool, { appRole: process.env.APP_DATABASE_ROLE });
} finally {
  await pool.end();
}
