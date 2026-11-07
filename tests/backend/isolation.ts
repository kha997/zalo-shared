import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../../server/db.js";
export async function isolatedDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "TEST_DATABASE_URL must reference a disposable PostgreSQL test database",
    );
  const schema = "backend_" + randomUUID().replaceAll("-", "");
  const owner = createPool(url);
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(url, { options: `-c search_path=${schema},public` });
  await migrate(pool);
  return {
    pool,
    async close() {
      await pool.end();
      await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      await owner.end();
    },
  };
}
