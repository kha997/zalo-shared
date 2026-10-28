import { createPool, seed } from "./db.js";
const pool = createPool(
  (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)!,
);
try {
  await seed(pool, {
    adminEmail: process.env.ADMIN_EMAIL || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    adminName: process.env.ADMIN_NAME,
    demo: process.env.DEMO_SEED === "true",
  });
} finally {
  await pool.end();
}
