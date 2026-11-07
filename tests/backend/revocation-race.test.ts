import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { isolatedDatabase } from "./isolation.js";

test(
  "in-flight send revalidates a session revoked after its initial authentication",
  { timeout: 15_000 },
  async () => {
    const database = await isolatedDatabase();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const intercepted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let armed = false;
    const pool = new Proxy(database.pool, {
      get(target, key) {
        if (key === "query")
          return async (...args: any[]) => {
            const result = await (target.query as any)(...args);
            if (
              armed &&
              typeof args[0] === "string" &&
              args[0].includes("SELECT u.*,s.csrf,s.token_hash") &&
              !args[0].includes("FOR SHARE")
            ) {
              armed = false;
              reached();
              await paused;
            }
            return result;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const password = randomUUID(),
      email = `${randomUUID()}@example.test`;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    let pending: Promise<any> | undefined;
    try {
      await seed(database.pool, { adminEmail: email, adminPassword: password });
      app = await buildApp({
        pool,
        config: configFromEnv({
          ...process.env,
          MOCK_ENABLED: "false",
          PROVIDER_MODE: "disabled",
          PUBLIC_ORIGIN: "http://localhost:3100",
        }),
      });
      const login = async (email: string, password: string) => {
        const r = await app!.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email, password },
        });
        assert.equal(r.statusCode, 200);
        return {
          user: r.json().user,
          headers: {
            cookie: r.headers["set-cookie"]!.toString().split(";")[0],
            origin: "http://localhost:3100",
            "x-csrf-token": r.json().csrfToken,
          },
        };
      };
      const admin = await login(email, password);
      const agentEmail = `${randomUUID()}@example.test`,
        agentPassword = randomUUID();
      const created = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: admin.headers,
        payload: {
          name: "Synthetic agent",
          email: agentEmail,
          password: agentPassword,
          role: "agent",
        },
      });
      assert.equal(created.statusCode, 200);
      const agent = await login(agentEmail, agentPassword);
      const c = (
        await database.pool.query(
          "INSERT INTO conversations(contact_id,contact_name,assignee_id) VALUES($1,'Synthetic',$2) RETURNING id",
          [randomUUID(), agent.user.id],
        )
      ).rows[0];
      armed = true;
      pending = app
        .inject({
          method: "POST",
          url: `/api/conversations/${c.id}/messages`,
          headers: { ...agent.headers, "idempotency-key": randomUUID() },
          payload: { text: "must never enqueue" },
        })
        .then((r) => r);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          intercepted,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Authentication interception timed out")),
              4_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const disabled = await app.inject({
        method: "PATCH",
        url: `/api/users/${agent.user.id}`,
        headers: admin.headers,
        payload: { active: false },
      });
      assert.equal(disabled.statusCode, 200);
      release();
      assert.equal((await pending).statusCode, 401);
      assert.equal(
        (
          await database.pool.query(
            "SELECT count(*)::int n FROM messages WHERE conversation_id=$1",
            [c.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await database.pool.query("SELECT count(*)::int n FROM outbox"))
          .rows[0].n,
        0,
      );
    } finally {
      release();
      await pending?.catch(() => {});
      await app?.close();
      await database.close();
    }
  },
);
