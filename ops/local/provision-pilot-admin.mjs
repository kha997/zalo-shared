// Provision exactly one pilot administrative identity.
//
// Bootstrap-only: the owner URL is used over verified TLS for one reviewed
// users INSERT and no migration. The runtime role deliberately cannot create
// accounts, so no standing privilege is widened by this tool. The credential
// file is created 0600 before the insert and removed if anything fails, so a
// failed run leaves neither a partial account nor an orphaned secret. A
// database that already has any account is refused: this tool never overwrites
// or replaces an identity.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audit,
  checkPassword,
  createPool,
  seed,
} from "../../dist/server/db.js";

const fail = (message) => {
  process.stderr.write(`pilot-admin: FAIL ${message}\n`);
  process.exit(1);
};

process.umask(0o077);

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const url = process.env.PILOT_ADMIN_DATABASE_URL;
const file = process.env.PILOT_ADMIN_CREDENTIAL_FILE;
const email = (process.env.PILOT_ADMIN_EMAIL || "pilot-admin@zalo-shared.invalid")
  .trim()
  .toLowerCase();
const name = process.env.PILOT_ADMIN_NAME || "Pilot Administrator";

if (!url) fail("PILOT_ADMIN_DATABASE_URL is required");
if (!file || !file.startsWith("/")) fail("PILOT_ADMIN_CREDENTIAL_FILE must be an absolute path");
if (file === repoRoot || file.startsWith(`${repoRoot}/`))
  fail("the credential file must live outside the repository");
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) fail("invalid admin email");
if (!/^[\x20-\x7e]{1,128}$/.test(name)) fail("invalid admin name");

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("PILOT_ADMIN_DATABASE_URL is not a URL");
}
if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") fail("database URL must be postgres");
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
if (!loopback && parsed.searchParams.get("sslmode") !== "verify-full")
  fail("a non-loopback database URL must use sslmode=verify-full");

const dir = dirname(file);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const dirMode = statSync(dir).mode & 0o777;
if (dirMode & 0o077) fail(`credential directory ${dirMode.toString(8)} is accessible to group or others`);
if (existsSync(file)) fail("the credential file already exists; refusing to overwrite it");

const password = randomBytes(48).toString("base64url");
const accountRef = createHash("sha256").update(email).digest("hex").slice(0, 12);
const say = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

let fd = openSync(file, "wx", 0o600);
try {
  writeSync(fd, `PILOT_ADMIN_EMAIL=${email}\nPILOT_ADMIN_PASSWORD=${password}\n`);
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
if ((statSync(file).mode & 0o777) !== 0o600) {
  unlinkSync(file);
  fail("credential file mode is not 0600");
}

const pool = createPool(url, { max: 1 });
let client;
let userId = null;
let committed = false;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("LOCK TABLE users IN EXCLUSIVE MODE");
  const existing = (await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
  if (existing !== 0) throw new Error("the database already has user accounts");

  // seed() only calls .query, so the client keeps the reviewed INSERT inside
  // this transaction and it rolls back with any later verification failure.
  await seed(client, { adminEmail: email, adminPassword: password, adminName: name });

  const rows = await client.query("SELECT id::text,email,role,active,password_hash FROM users");
  if (rows.rowCount !== 1) throw new Error("expected exactly one account after provisioning");
  const row = rows.rows[0];
  if (row.email !== email) throw new Error("provisioned email does not match");
  if (row.role !== "admin") throw new Error("provisioned role is not admin");
  if (row.active !== true) throw new Error("provisioned account is not active");
  if (!(await checkPassword(password, row.password_hash)))
    throw new Error("the stored credential does not verify");
  userId = row.id;
  await audit(client, null, "auth.admin_provisioned", userId, {
    source: "pilot-bootstrap",
    accountRef,
  });
  await client.query("COMMIT");
  committed = true;

  const final = (
    await client.query(
      `SELECT count(*)::int AS users,
              count(*) FILTER (WHERE role='admin' AND active)::int AS admins,
              count(*) FILTER (WHERE role<>'admin')::int AS others,
              (SELECT count(*)::int FROM sessions) AS sessions
       FROM users`,
    )
  ).rows[0];
  if (final.users !== 1 || final.admins !== 1 || final.others !== 0 || final.sessions !== 0)
    throw new Error(`unexpected final identity state ${JSON.stringify(final)}`);
  if (userId === null) throw new Error("no provisioned account id");

  say({
    ok: true,
    action: "pilot-admin-provisioned",
    accountRef,
    userId,
    users: final.users,
    admins: final.admins,
    otherRoles: final.others,
    sessions: final.sessions,
    role: row.role,
    active: row.active,
    credentialVerifies: true,
    credentialFile: file,
    credentialMode: (statSync(file).mode & 0o777).toString(8),
    directoryMode: dirMode.toString(8),
    migrationsRun: false,
  });
} catch (error) {
  try {
    if (client && !committed) await client.query("ROLLBACK");
  } catch {}
  let removed = false;
  if (committed && userId) {
    try {
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      removed = true;
    } catch {}
  }
  // A committed row whose cleanup failed must keep its credential, otherwise
  // no one could ever authenticate as the account that still exists.
  const keepFile = committed && !removed;
  if (!keepFile) {
    try {
      unlinkSync(file);
    } catch {}
  }
  const secrets = [password, parsed.password ? decodeURIComponent(parsed.password) : ""].filter(Boolean);
  const reason = secrets.reduce(
    (text, secret) => text.split(secret).join("[redacted]"),
    String(error?.message || error),
  );
  say({
    ok: false,
    action: "pilot-admin-provisioning-failed",
    accountRef,
    reason,
    ...(keepFile ? { credentialFileRetained: true } : {}),
  });
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
