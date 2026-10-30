import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { isolatedDatabase } from "./isolation.js";

test("pending uploads have a concurrency-safe per-user quota", async () => {
  const db = await isolatedDatabase();
  const password = randomUUID();
  await seed(db.pool, {
    adminEmail: "resource@example.test",
    adminPassword: password,
  });
  const app = await buildApp({ pool: db.pool, config: configFromEnv({}) });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "resource@example.test", password },
    });
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
      origin: "http://127.0.0.1:3100",
      "x-csrf-token": login.json().csrfToken,
    };
    const responses = await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/attachments",
          headers,
          payload: {
            name: `synthetic-${i}.txt`,
            mime: "text/plain",
            dataBase64: Buffer.from("synthetic").toString("base64"),
          },
        }),
      ),
    );
    assert.equal(responses.filter((r) => r.statusCode === 200).length, 20);
    assert.equal(responses.filter((r) => r.statusCode === 429).length, 1);
    assert.equal(
      (await db.pool.query("SELECT count(*)::int n FROM attachments")).rows[0]
        .n,
      20,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("protected metrics include request duration and pending age without personal labels", async () => {
  const db = await isolatedDatabase();
  const token = randomUUID();
  const app = await buildApp({
    pool: db.pool,
    config: configFromEnv({ METRICS_TOKEN: token }),
  });
  try {
    assert.equal((await app.inject("/metrics")).statusCode, 401);
    await app.inject("/health/live");
    const metrics = await app.inject({
      url: "/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /zs_http_requests_total [1-9]/);
    assert.match(metrics.body, /zs_http_duration_seconds_sum [0-9]/);
    assert.match(metrics.body, /zs_outbox_oldest_pending_seconds [0-9]/);
    assert.ok(!metrics.body.includes(token));
  } finally {
    await app.close();
    await db.close();
  }
});

test("advertised maximum attachment passes the full authenticated upload and private download routes", async () => {
  const db = await isolatedDatabase();
  const password = randomUUID();
  await seed(db.pool, {
    adminEmail: "large@example.test",
    adminPassword: password,
  });
  const app = await buildApp({ pool: db.pool, config: configFromEnv({}) });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "large@example.test", password },
    });
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
      origin: "http://127.0.0.1:3100",
      "x-csrf-token": login.json().csrfToken,
    };
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const upload = await app.inject({
      method: "POST",
      url: "/api/attachments",
      headers,
      payload: {
        name: "synthetic-max.txt",
        mime: "text/plain",
        dataBase64: bytes.toString("base64"),
      },
    });
    assert.equal(upload.statusCode, 200);
    const download = await app.inject({ url: upload.json().url, headers });
    assert.equal(download.statusCode, 200);
    assert.equal(download.rawPayload.length, bytes.length);
    const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
    assert.equal(hash(download.rawPayload), hash(bytes));
  } finally {
    await app.close();
    await db.close();
  }
});
