// Claims, checks, activates and releases connector ownership against the
// disposable clone database. Prints only booleans and enum states; never an
// account id, owner id or epoch value.
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const { Pool } = require("pg");
const gates = await import("/app/dist/connector/tools/pilot-gates.js");
const ownership = await import("/app/dist/connector/server/connector-ownership.js");

const mode = process.env.MODE ?? "once";
const holdMs = Number(process.env.HOLD_MS ?? 4000);
let url;
try {
  url = gates.requireTlsDatabaseUrl(process.env.DATABASE_URL);
} catch {
  process.stdout.write(`${JSON.stringify({ gate: "denied" })}\n`);
  process.exit(2);
}
const pool = new Pool({ connectionString: url, max: 2 });
const report = { gate: "admitted", mode };
let revoked = 0;
try {
  const handle = await ownership.acquireConnectorOwnership(pool, {
    ownerLabel: "synthetic-dryrun",
    onRevoked: () => {
      revoked += 1;
    },
  });
  report.acquired = true;
  report.admitted = handle.admitted;
  report.epochNumeric = /^(0|[1-9][0-9]{0,18})$/.test(handle.token.epoch);
  await handle.assertCurrent();
  await handle.markActive();
  report.active = true;
  if (mode === "hold") {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }
  await handle.close();
  report.closed = true;
} catch {
  report.acquired = false;
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(3);
}
const state = await pool.query(
  "SELECT o.phase, p.status, p.reconciliation_required FROM connector_ownership o JOIN provider_state p USING (account_id)",
);
report.after = state.rows[0];
report.revoked = revoked;
await pool.end();
process.stdout.write(`${JSON.stringify(report)}\n`);
