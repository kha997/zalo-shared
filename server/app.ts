import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type pg from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ACCOUNT, audit, checkPassword, hashPassword } from "./db.js";
import type { Config } from "./config.js";
import { registerStaticAssets } from "./static.js";
import { decodeAttachmentBase64 } from "./base64.js";
import { resolve } from "node:path";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const userFields = "id,name,email,role,active";
const uuid = z.string().uuid();
const fail = (code: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode: code });
};
const user = (r: any) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  active: r.active,
});
export async function buildApp({
  pool,
  config,
}: {
  pool: pg.Pool;
  config: Config;
}) {
  const app = Fastify({ bodyLimit: 7 * 1024 * 1024, logger: false });
  let requestCount = 0,
    errorCount = 0,
    durationSum = 0;
  app.addHook("onRequest", async (req: any) => {
    req.zsStart = performance.now();
  });
  app.addHook("onResponse", async (req: any, reply) => {
    requestCount++;
    if (reply.statusCode >= 500) errorCount++;
    durationSum += (performance.now() - req.zsStart) / 1000;
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((err: any, _req, reply) => {
    const code = err instanceof z.ZodError ? 400 : err.statusCode || 500;
    reply.code(code).send({
      error: {
        code: code === 500 ? "INTERNAL_ERROR" : String(code),
        message:
          code === 500
            ? "Internal server error"
            : err instanceof z.ZodError
              ? "Invalid request"
              : err.message,
      },
    });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "404", message: "Not found" } }),
  );
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.decorateRequest("staff", null);
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req: any) => {
    if (
      !req.url.startsWith("/api/") ||
      req.url.split("?")[0] === "/api/auth/login"
    )
      return;
    const token = req.cookies.zs_session;
    if (!token) fail(401, "Authentication required");
    const r = await pool.query(
      `SELECT u.*,s.csrf,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.account_id=$2 AND u.active AND s.created_at>now()-interval '24 hours' AND s.last_seen>now()-interval '2 hours'`,
      [digest(token), ACCOUNT],
    );
    if (!r.rowCount) fail(401, "Authentication required");
    req.staff = r.rows[0];
    req.session = r.rows[0];
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers.origin !== config.publicOrigin ||
        req.headers["x-csrf-token"] !== req.session.csrf)
    )
      fail(403, "CSRF validation failed");
    await pool.query(
      "UPDATE sessions SET last_seen=now() WHERE token_hash=$1",
      [digest(token)],
    );
  });
  const privileged = (req: any) => {
    if (!["admin", "supervisor"].includes(req.staff.role))
      fail(403, "Insufficient role");
  };
  const admin = (req: any) => {
    if (req.staff.role !== "admin") fail(403, "Administrator required");
  };
  async function transaction<T>(
    req: any,
    fn: (db: pg.PoolClient) => Promise<T>,
  ) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const staffChange = req.url.split("?")[0].startsWith("/api/users");
      await db.query(
        staffChange
          ? "SELECT pg_advisory_xact_lock(72001)"
          : "SELECT pg_advisory_xact_lock_shared(72001)",
      );
      if (req.session) {
        const fresh = await db.query(
          `SELECT u.*,s.csrf,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.account_id=$2 AND u.active AND s.created_at>now()-interval '24 hours' AND s.last_seen>now()-interval '2 hours' FOR SHARE OF u,s`,
          [req.session.token_hash, ACCOUNT],
        );
        if (!fresh.rowCount) fail(401, "Authentication required");
        req.staff = fresh.rows[0];
        if (staffChange || req.url.startsWith("/api/provider/mock/"))
          admin(req);
      }
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async function conversation(db: any, id: string, lock = false) {
    uuid.parse(id);
    const r = await db.query(
      `SELECT * FROM conversations WHERE id=$1 AND account_id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [id, ACCOUNT],
    );
    if (!r.rowCount) fail(404, "Conversation not found");
    return r.rows[0];
  }
  async function viewConversation(db: any, c: any, actorId: string) {
    const r = await db.query(
      `SELECT count(*)::int AS unread FROM messages m WHERE m.conversation_id=$1 AND direction='inbound' AND created_at>coalesce((SELECT read_at FROM read_cursors WHERE user_id=$2 AND conversation_id=$1),'-infinity'::timestamptz)`,
      [c.id, actorId],
    );
    const last = await db.query(
      "SELECT text FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [c.id],
    );
    return {
      id: c.id,
      contactId: c.contact_id,
      contactName: c.contact_name,
      status: c.status,
      assigneeId: c.assignee_id,
      version: c.version,
      unreadCount: r.rows[0].unread,
      lastMessage: last.rows[0]?.text || "",
      updatedAt: c.updated_at.toISOString(),
    };
  }
  async function message(db: any, id: string) {
    const r = (
      await db.query(
        `SELECT m.*,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_precise FROM messages m WHERE id=$1`,
        [id],
      )
    ).rows[0];
    const a = (
      await db.query(
        "SELECT id,name,mime,octet_length(data) AS size FROM attachments WHERE message_id=$1 ORDER BY created_at,id",
        [id],
      )
    ).rows;
    return messageView(r, a);
  }
  function messageView(r: any, a: any[]) {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      direction: r.direction,
      text: r.text,
      actorId: r.actor_id,
      status: r.status,
      providerId: r.provider_id,
      createdAt:
        r.created_at_precise ?? r.created_at.toISOString().replace("Z", "000Z"),
      attachments: a.map((x: any) => ({
        ...x,
        url: `/api/attachments/${x.id}`,
      })),
    };
  }
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: config.loginRateLimit, timeWindow: "1 minute" },
      },
    },
    async (req: any, reply) => {
      if (req.headers.origin && req.headers.origin !== config.publicOrigin)
        fail(403, "Origin rejected");
      const b = z
        .object({
          email: z.string().email().max(254),
          password: z.string().min(1).max(256),
        })
        .parse(req.body);
      const r = await pool.query(
        "SELECT * FROM users WHERE email=$1 AND account_id=$2 AND active",
        [b.email.toLowerCase(), ACCOUNT],
      );
      const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
      const valid = await checkPassword(
        b.password,
        r.rows[0]?.password_hash || dummy,
      );
      if (!r.rowCount || !valid) fail(401, "Invalid credentials");
      const token = randomBytes(32).toString("base64url"),
        csrf = randomBytes(32).toString("base64url");
      await transaction(req, async (db) => {
        const current = await db.query(
          "SELECT * FROM users WHERE id=$1 AND active AND account_id=$2 FOR SHARE",
          [r.rows[0].id, ACCOUNT],
        );
        if (!current.rowCount) fail(401, "Invalid credentials");
        r.rows[0] = current.rows[0];
        if (req.cookies.zs_session)
          await db.query("DELETE FROM sessions WHERE token_hash=$1", [
            digest(req.cookies.zs_session),
          ]);
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,$3)",
          [digest(token), r.rows[0].id, csrf],
        );
        await audit(db, r.rows[0], "auth.login", r.rows[0].id);
      });
      reply.setCookie("zs_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: config.secureCookie,
        maxAge: 86400,
      });
      return { user: user(r.rows[0]), csrfToken: csrf };
    },
  );
  app.get("/api/auth/me", async (req: any) => ({
    user: user(req.staff),
    csrfToken: req.session.csrf,
  }));
  app.post("/api/auth/logout", async (req: any, reply) => {
    await transaction(req, async (db) => {
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        req.session.token_hash,
      ]);
      await audit(db, req.staff, "auth.logout", req.staff.id);
    });
    reply.clearCookie("zs_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/users", async () => ({
    items: (
      await pool.query(
        `SELECT ${userFields} FROM users WHERE account_id=$1 ORDER BY name`,
        [ACCOUNT],
      )
    ).rows,
  }));
  app.post("/api/users", async (req: any) => {
    admin(req);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z.string().email().max(254),
        password: z.string().min(12).max(256),
        role: z.enum(["admin", "supervisor", "agent"]),
      })
      .parse(req.body);
    return transaction(req, async (db) => {
      const existing = await db.query("SELECT id FROM users WHERE email=$1", [
        b.email.toLowerCase(),
      ]);
      if (existing.rowCount) fail(409, "Email already exists");
      const r = await db.query(
        `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING ${userFields}`,
        [b.name, b.email.toLowerCase(), await hashPassword(b.password), b.role],
      );
      if (!r.rowCount) fail(409, "Email already exists");
      await audit(db, req.staff, "user.create", r.rows[0].id, { role: b.role });
      return r.rows[0];
    });
  });
  app.patch("/api/users/:id", async (req: any) => {
    admin(req);
    const id = uuid.parse(req.params.id);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        role: z.enum(["admin", "supervisor", "agent"]).optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(req, async (db) => {
      const r = await db.query(
        "SELECT * FROM users WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [id, ACCOUNT],
      );
      if (!r.rowCount) fail(404, "User not found");
      const old = r.rows[0];
      if (
        old.role === "admin" &&
        old.active &&
        (b.active === false || (b.role && b.role !== "admin"))
      ) {
        const n = await db.query(
          "SELECT count(*)::int n FROM users WHERE role='admin' AND active AND account_id=$1",
          [ACCOUNT],
        );
        if (n.rows[0].n <= 1)
          fail(409, "Cannot remove last active administrator");
      }
      const updated = await db.query(
        `UPDATE users SET name=$2,role=$3,active=$4 WHERE id=$1 RETURNING ${userFields}`,
        [id, b.name ?? old.name, b.role ?? old.role, b.active ?? old.active],
      );
      if (b.role !== undefined || b.active !== undefined)
        await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(db, req.staff, "user.update", id, b);
      return updated.rows[0];
    });
  });
  app.get("/api/conversations", async (req: any) => {
    const q = z
      .object({
        search: z.string().max(200).optional(),
        status: z.enum(["open", "resolved"]).optional(),
        assignedTo: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: uuid.optional(),
      })
      .parse(req.query);
    const vals: any[] = [ACCOUNT];
    let where = "account_id=$1";
    if (q.search) {
      vals.push(`%${q.search}%`);
      where += ` AND (contact_name ILIKE $${vals.length} OR contact_id ILIKE $${vals.length})`;
    }
    if (q.status) {
      vals.push(q.status);
      where += ` AND status=$${vals.length}`;
    }
    if (q.assignedTo === "unassigned") where += " AND assignee_id IS NULL";
    else if (q.assignedTo) {
      vals.push(
        q.assignedTo === "me" ? req.staff.id : uuid.parse(q.assignedTo),
      );
      where += ` AND assignee_id=$${vals.length}`;
    }
    if (q.before) {
      const cursor = await pool.query(
        "SELECT id FROM conversations WHERE id=$1 AND account_id=$2",
        [q.before, ACCOUNT],
      );
      if (!cursor.rowCount) fail(400, "Invalid cursor");
      vals.push(q.before);
      where += ` AND (c.updated_at,c.id)<(SELECT updated_at,id FROM conversations WHERE id=$${vals.length} AND account_id=$1)`;
    }
    vals.push(req.staff.id);
    const actorParam = "$" + vals.length;
    vals.push(q.limit + 1);
    const limitParam = "$" + vals.length;
    const r = await pool.query(
      `SELECT c.*,
 (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound' AND m.created_at>coalesce((SELECT rc.read_at FROM read_cursors rc WHERE rc.user_id=${actorParam} AND rc.conversation_id=c.id),'-infinity'::timestamptz)) AS unread,
 (SELECT m.text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message
 FROM conversations c WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ${limitParam}`,
      vals,
    );
    const page = r.rows.slice(0, q.limit);
    return {
      nextCursor: r.rows.length > q.limit ? page[page.length - 1].id : null,
      items: page.map((c) => ({
        id: c.id,
        contactId: c.contact_id,
        contactName: c.contact_name,
        status: c.status,
        assigneeId: c.assignee_id,
        version: c.version,
        unreadCount: c.unread,
        lastMessage: c.last_message || "",
        updatedAt: c.updated_at.toISOString(),
      })),
    };
  });
  app.patch("/api/conversations/:id", async (req: any) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        assigneeId: uuid.nullable().optional(),
        status: z.enum(["open", "resolved"]).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(req, async (db) => {
      const c = await conversation(db, req.params.id, true);
      if (c.version !== b.expectedVersion)
        fail(409, "Conversation version conflict");
      if (
        req.staff.role === "agent" &&
        ((c.assignee_id && c.assignee_id !== req.staff.id) ||
          (b.assigneeId !== undefined &&
            b.assigneeId !== req.staff.id &&
            b.assigneeId !== null))
      )
        fail(403, "Cannot reassign another agent");
      if (b.assigneeId) {
        const u = await db.query(
          "SELECT id FROM users WHERE id=$1 AND account_id=$2 AND active",
          [b.assigneeId, ACCOUNT],
        );
        if (!u.rowCount) fail(400, "Invalid assignee");
      }
      const r = await db.query(
        "UPDATE conversations SET assignee_id=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          c.id,
          b.assigneeId === undefined ? c.assignee_id : b.assigneeId,
          b.status ?? c.status,
        ],
      );
      await audit(db, req.staff, "conversation.update", c.id, b);
      return viewConversation(db, r.rows[0], req.staff.id);
    });
  });
  app.post("/api/conversations/:id/read", async (req: any) =>
    transaction(req, async (db) => {
      await conversation(db, req.params.id);
      await db.query(
        "INSERT INTO read_cursors(user_id,conversation_id) VALUES($1,$2) ON CONFLICT(user_id,conversation_id) DO UPDATE SET read_at=now()",
        [req.staff.id, req.params.id],
      );
      return { ok: true };
    }),
  );
  app.get("/api/conversations/:id", async (req: any) =>
    viewConversation(
      pool,
      await conversation(pool, req.params.id),
      req.staff.id,
    ),
  );
  app.get("/api/conversations/:id/messages", async (req: any) => {
    await conversation(pool, req.params.id);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        before: uuid.optional(),
      })
      .parse(req.query);
    if (q.before) {
      const cursor = await pool.query(
        "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2",
        [q.before, req.params.id],
      );
      if (!cursor.rowCount) fail(400, "Invalid cursor");
    }
    const r = await pool.query(
      `SELECT m.*,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_precise,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'mime',a.mime,'size',octet_length(a.data)) ORDER BY a.created_at,a.id) FROM attachments a WHERE a.message_id=m.id),'[]'::jsonb) AS attachment_rows
       FROM messages m WHERE conversation_id=$1 ${q.before ? "AND (created_at,id)<(SELECT created_at,id FROM messages WHERE id=$3 AND conversation_id=$1)" : ""} ORDER BY created_at DESC,id DESC LIMIT $2`,
      q.before
        ? [req.params.id, q.limit + 1, q.before]
        : [req.params.id, q.limit + 1],
    );
    const page = r.rows.slice(0, q.limit);
    return {
      nextCursor: r.rows.length > q.limit ? page[page.length - 1].id : null,
      items: page.reverse().map((m) => messageView(m, m.attachment_rows)),
    };
  });
  app.post("/api/conversations/:id/messages", async (req: any) => {
    const key = z
      .string()
      .min(1)
      .max(128)
      .parse(req.headers["idempotency-key"]);
    const b = z
      .object({
        text: z.string().max(10000),
        attachmentIds: z.array(uuid).max(5).default([]),
      })
      .strict()
      .parse(req.body);
    if (!b.text.trim() && !b.attachmentIds.length) fail(400, "Empty message");
    if (new Set(b.attachmentIds).size !== b.attachmentIds.length)
      fail(400, "Duplicate attachment");
    const hash = digest(JSON.stringify(b));
    return transaction(req, async (db) => {
      const c = await conversation(db, req.params.id, true);
      const existing = await db.query(
        "SELECT id,payload_hash FROM messages WHERE conversation_id=$1 AND actor_id=$2 AND request_key=$3",
        [c.id, req.staff.id, key],
      );
      if (existing.rowCount) {
        if (existing.rows[0].payload_hash !== hash)
          fail(409, "Idempotency key payload mismatch");
        return message(db, existing.rows[0].id);
      }
      if (req.staff.role === "agent" && c.assignee_id !== req.staff.id)
        fail(403, "Conversation must be assigned to you");
      for (const id of b.attachmentIds) {
        const a = await db.query(
          "SELECT id FROM attachments WHERE id=$1 AND account_id=$2 AND owner_id=$3 AND message_id IS NULL FOR UPDATE",
          [id, ACCOUNT, req.staff.id],
        );
        if (!a.rowCount) fail(400, "Attachment unavailable");
      }
      const r = await db.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status,request_key,payload_hash) VALUES($1,'outbound',$2,$3,'pending',$4,$5) RETURNING id",
        [c.id, b.text, req.staff.id, key, hash],
      );
      const id = r.rows[0].id;
      await db.query(
        "UPDATE attachments SET message_id=$1 WHERE id=ANY($2::uuid[])",
        [id, b.attachmentIds],
      );
      await db.query("INSERT INTO outbox(message_id) VALUES($1)", [id]);
      for (let i = 0; i < 1 + b.attachmentIds.length; i++)
        await db.query(
          "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,$2,$3)",
          [id, i, i === 0 ? null : b.attachmentIds[i - 1]],
        );
      await db.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [
        c.id,
      ]);
      await audit(db, req.staff, "message.enqueue", id, {
        attachmentCount: b.attachmentIds.length,
      });
      return message(db, id);
    });
  });
  app.post("/api/attachments", async (req: any) => {
    const b = z
      .object({
        name: z.string().min(1).max(200),
        mime: z.enum([
          "image/png",
          "image/jpeg",
          "application/pdf",
          "text/plain",
        ]),
        dataBase64: z.string().max(6990510),
      })
      .strict()
      .parse(req.body);
    const bytes =
      decodeAttachmentBase64(b.dataBase64) ??
      fail(400, "Invalid base64 or attachment size");
    const valid =
      b.mime === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : b.mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : b.mime === "application/pdf"
            ? bytes.subarray(0, 5).toString() === "%PDF-"
            : !bytes.includes(0);
    if (!valid) fail(400, "Attachment content mismatch");
    return transaction(req, async (db) => {
      // Serialize quota checks across uploads from the same actor, including other app replicas.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        req.staff.id,
      ]);
      await db.query(
        "DELETE FROM attachments WHERE owner_id=$1 AND account_id=$2 AND message_id IS NULL AND created_at<now()-interval '24 hours'",
        [req.staff.id, ACCOUNT],
      );
      const quota = (
        await db.query(
          "SELECT count(*)::int count,coalesce(sum(octet_length(data)),0)::bigint bytes FROM attachments WHERE owner_id=$1 AND account_id=$2 AND message_id IS NULL",
          [req.staff.id, ACCOUNT],
        )
      ).rows[0];
      if (
        quota.count >= 20 ||
        Number(quota.bytes) + bytes.length > 20 * 1024 * 1024
      )
        fail(429, "Pending upload quota reached");
      const r = await db.query(
        "INSERT INTO attachments(owner_id,name,mime,data) VALUES($1,$2,$3,$4) RETURNING id",
        [req.staff.id, b.name.replace(/[\r\n\/\\]/g, "_"), b.mime, bytes],
      );
      const id = r.rows[0].id;
      return {
        id,
        name: b.name,
        mime: b.mime,
        size: bytes.length,
        url: `/api/attachments/${id}`,
      };
    });
  });
  app.get("/api/attachments/:id", async (req: any, reply) => {
    const id = uuid.parse(req.params.id);
    const r = await pool.query(
      "SELECT * FROM attachments WHERE id=$1 AND account_id=$2 AND (message_id IS NOT NULL OR owner_id=$3)",
      [id, ACCOUNT, req.staff.id],
    );
    if (!r.rowCount) fail(404, "Attachment not found");
    const a = r.rows[0];
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      )
      .header("X-Content-Type-Options", "nosniff")
      .type(a.mime)
      .send(a.data);
  });
  app.get("/api/provider", async () => {
    const r = await pool.query(
      "SELECT * FROM provider_state WHERE account_id=$1",
      [ACCOUNT],
    );
    return {
      mode: config.mockEnabled ? "mock" : "disabled",
      status: config.mockEnabled ? r.rows[0].status : "disconnected",
      lastEventAt: r.rows[0].last_event_at?.toISOString() || null,
    };
  });
  app.post("/api/provider/mock/state", async (req: any) => {
    admin(req);
    if (!config.mockEnabled) fail(404, "Mock disabled");
    const b = z
      .object({ status: z.enum(["connected", "disconnected", "expired"]) })
      .strict()
      .parse(req.body);
    await transaction(req, async (db) => {
      await db.query(
        "UPDATE provider_state SET status=$1,last_event_at=now() WHERE account_id=$2",
        [b.status, ACCOUNT],
      );
      await audit(db, req.staff, "provider.state", ACCOUNT, b);
    });
    return { mode: "mock", ...b, lastEventAt: new Date().toISOString() };
  });
  app.post("/api/provider/mock/inbound", async (req: any) => {
    admin(req);
    if (!config.mockEnabled) fail(404, "Mock disabled");
    const b = z
      .object({
        contactId: z.string().min(1).max(200),
        contactName: z.string().min(1).max(200),
        providerId: z.string().min(1).max(200),
        text: z.string().max(10000),
      })
      .strict()
      .parse(req.body);
    return transaction(req, async (db) => {
      const c = (
        await db.query(
          "INSERT INTO conversations(contact_id,contact_name) VALUES($1,$2) ON CONFLICT(account_id,contact_id) DO UPDATE SET contact_name=excluded.contact_name RETURNING id",
          [b.contactId, b.contactName],
        )
      ).rows[0];
      const r = await db.query(
        "INSERT INTO messages(conversation_id,direction,text,status,provider_id) VALUES($1,'inbound',$2,'received',$3) ON CONFLICT(conversation_id,direction,provider_id) DO NOTHING RETURNING id",
        [c.id, b.text, b.providerId],
      );
      if (r.rowCount) {
        await db.query(
          "UPDATE conversations SET updated_at=now() WHERE id=$1",
          [c.id],
        );
        await audit(db, req.staff, "message.receive", r.rows[0].id);
      }
      return { ok: true, duplicate: !r.rowCount };
    });
  });
  app.get("/api/audit", async (req: any) => {
    privileged(req);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .parse(req.query.limit);
    const r = await pool.query(
      "SELECT * FROM audit WHERE account_id=$1 ORDER BY id DESC LIMIT $2",
      [ACCOUNT, limit],
    );
    return {
      items: r.rows.map((a) => ({
        id: String(a.id),
        actorId: a.actor_id,
        actorName: a.actor_name,
        action: a.action,
        targetId: a.target_id,
        metadata: a.metadata,
        createdAt: a.created_at.toISOString(),
      })),
    };
  });
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get("/metrics", async (req, reply) => {
    const expected = `Bearer ${config.metricsToken}`;
    const actual = req.headers.authorization || "";
    if (
      !config.metricsToken ||
      actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return reply
        .code(401)
        .send({ error: { code: "401", message: "Unauthorized" } });
    const r = await pool.query(
      "SELECT status,count(*)::int count FROM outbox GROUP BY status",
    );
    const oldest = (
      await pool.query(
        "SELECT coalesce(max(extract(epoch from now()-created_at)),0)::float8 age FROM outbox WHERE status='pending'",
      )
    ).rows[0].age;
    const provider = (
      await pool.query(
        "SELECT status,extract(epoch from now()-last_event_at)::float8 age FROM provider_state WHERE account_id=$1",
        [ACCOUNT],
      )
    ).rows[0];
    const lines = [
      ...r.rows.map((x) => `zs_outbox_jobs{status="${x.status}"} ${x.count}`),
      `zs_http_requests_total ${requestCount}`,
      `zs_http_errors_total ${errorCount}`,
      `zs_http_duration_seconds_sum ${durationSum}`,
      `zs_http_duration_seconds_count ${requestCount}`,
      `zs_outbox_oldest_pending_seconds ${oldest}`,
      `zs_provider_connected ${config.mockEnabled && provider.status === "connected" ? 1 : 0}`,
      `zs_provider_last_event_age_seconds ${provider.age ?? -1}`,
    ];
    return reply
      .type("text/plain; version=0.0.4")
      .send(lines.join("\n") + "\n");
  });
  await registerStaticAssets(app, resolve("dist/client"));
  return app;
}
