import { buildApp } from "./app.js";
import { createPool } from "./db.js";
import { configFromEnv } from "./config.js";
const config = configFromEnv();
const pool = createPool(process.env.DATABASE_URL!);
const app = await buildApp({ pool, config });
await app.listen({ host: config.host, port: config.port });
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
