import pg from "pg";
import { providerSchema } from "./provider-schema.js";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
export const ACCOUNT = "00000000-0000-4000-8000-000000000001";
export const createPool = (databaseUrl: string, options: pg.PoolConfig = {}) =>
  new pg.Pool({ connectionString: databaseUrl, max: 15, ...options });
const scrypt = promisify(scryptCb);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function checkPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export async function migrate(
  pool: pg.Pool,
  options: { appRole?: string } = {},
) {
  await pool.query(`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL DEFAULT '${ACCOUNT}',name text NOT NULL,email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('admin','supervisor','agent')),active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,csrf text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_seen timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL DEFAULT '${ACCOUNT}',contact_id text NOT NULL,contact_name text NOT NULL,status text NOT NULL DEFAULT 'open',assignee_id uuid REFERENCES users,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,contact_id));
CREATE TABLE IF NOT EXISTS messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,direction text NOT NULL,text text NOT NULL,actor_id uuid REFERENCES users,status text NOT NULL,provider_id text,request_key text,payload_hash text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(conversation_id,direction,provider_id),UNIQUE(conversation_id,actor_id,request_key));
CREATE TABLE IF NOT EXISTS attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL DEFAULT '${ACCOUNT}',owner_id uuid REFERENCES users,name text NOT NULL,mime text NOT NULL,data bytea NOT NULL,message_id uuid REFERENCES messages ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS read_cursors(user_id uuid REFERENCES users ON DELETE CASCADE,conversation_id uuid REFERENCES conversations ON DELETE CASCADE,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,conversation_id));
CREATE TABLE IF NOT EXISTS outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid UNIQUE REFERENCES messages ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS delivery_parts(message_id uuid REFERENCES messages ON DELETE CASCADE,part integer NOT NULL,status text NOT NULL DEFAULT 'pending',provider_id text,PRIMARY KEY(message_id,part));
ALTER TABLE delivery_parts ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES attachments(id) CHECK(part<>0 OR attachment_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_parts_attachment ON delivery_parts(message_id,attachment_id);
CREATE TABLE IF NOT EXISTS provider_state(account_id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'disconnected',last_event_at timestamptz);
INSERT INTO provider_state(account_id) VALUES('${ACCOUNT}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS provider_ledger(message_id uuid NOT NULL,part integer NOT NULL,provider_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(message_id,part));
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,account_id uuid NOT NULL DEFAULT '${ACCOUNT}',actor_id uuid,actor_name text,action text NOT NULL,target_id text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Audit is append-only'; END$$;
DROP TRIGGER IF EXISTS audit_immutable ON audit;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
`);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS messages_timeline ON messages(conversation_id,created_at DESC,id DESC)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(account_id,updated_at DESC,id)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS outbox_dispatch ON outbox(status,created_at,id)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS attachment_messages ON attachments(message_id,created_at,id)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS session_users ON sessions(user_id)",
  );
  await pool.query(providerSchema);
  if (options.appRole) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.appRole))
      throw new Error("Invalid APP_DATABASE_ROLE");
    const role = '"' + options.appRole + '"';
    const schema = (await pool.query("SELECT current_schema() AS name")).rows[0]
      .name;
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Unsupported schema");
    await pool.query(
      `GRANT USAGE ON SCHEMA "${schema}" TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${role}; REVOKE UPDATE,DELETE,TRUNCATE ON "${schema}".audit FROM ${role}; REVOKE CREATE ON SCHEMA "${schema}" FROM ${role}`,
    );
  }
}
export async function seed(
  pool: pg.Pool,
  options: {
    adminEmail: string;
    adminPassword: string;
    adminName?: string;
    demo?: boolean;
  },
) {
  if (!options.adminEmail || options.adminPassword.length < 12)
    throw new Error(
      "Explicit email and password of at least 12 characters required",
    );
  await pool.query(
    "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING",
    [
      options.adminName || "Administrator",
      options.adminEmail.toLowerCase(),
      await hashPassword(options.adminPassword),
      "admin",
    ],
  );
  if (options.demo)
    await pool.query(
      "INSERT INTO conversations(contact_id,contact_name) VALUES('synthetic-demo','Khách hàng mẫu') ON CONFLICT DO NOTHING",
    );
}
export async function audit(
  db: pg.Pool | pg.PoolClient,
  user: any,
  action: string,
  targetId: string | null,
  metadata: object = {},
) {
  await db.query(
    "INSERT INTO audit(actor_id,actor_name,action,target_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [user?.id || null, user?.name || null, action, targetId, metadata],
  );
}
