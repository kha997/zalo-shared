// Database connectivity probe that runs inside the reviewed connector image.
//
// It uses the connector's own requireTlsDatabaseUrl gate and the image's pg
// driver, so the check exercises the code path a live command takes before it
// touches the database. It prints only the gate outcome, the negotiated TLS
// facts and the role name; never the URL, the password or any row.
import { createRequire } from "node:module";

const require = createRequire("/app/");
const gates = await import("/app/dist/connector/tools/pilot-gates.js");

let url;
try {
  url = gates.requireTlsDatabaseUrl(process.env.DATABASE_URL);
} catch {
  process.stdout.write(JSON.stringify({ gate: "denied" }) + "\n");
  process.exit(process.env.EXPECT_GATE_DENIED === "1" ? 0 : 1);
}
if (process.env.EXPECT_GATE_DENIED === "1") {
  process.stdout.write(JSON.stringify({ gate: "admitted", expected: "denied" }) + "\n");
  process.exit(1);
}

const { Client } = require("pg");
const client = new Client({ connectionString: url });
try {
  await client.connect();
  const result = await client.query(
    "select current_user as role, ssl::text as ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()",
  );
  const row = result.rows[0];
  process.stdout.write(
    JSON.stringify({
      gate: "admitted",
      role: row.role,
      ssl: row.ssl,
      version: row.version,
      cipher: row.cipher,
    }) + "\n",
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({ gate: "admitted", connected: false, code: error?.code ?? "error" }) + "\n",
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
