import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { configFromEnv } from "../../server/config.js";
import { seed } from "../../server/db.js";
import { isolatedDatabase } from "./isolation.js";

test("conversation keyset pages expose older contacts without a silent result cap", async () => {
  const db = await isolatedDatabase();
  const password = randomUUID();
  await seed(db.pool, {
    adminEmail: "pages@example.test",
    adminPassword: password,
  });
  await db.pool.query(
    "INSERT INTO conversations(contact_id,contact_name) SELECT 'page-'||n,'Synthetic '||n FROM generate_series(1,5) n",
  );
  const app = await buildApp({ pool: db.pool, config: configFromEnv({}) });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "pages@example.test", password },
    });
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    const ids = new Set<string>();
    let before: string | null = null;
    for (let page = 0; page < 3; page++) {
      const r: {
        statusCode: number;
        json: () => { items: { id: string }[]; nextCursor: string | null };
      } = await app.inject({
        url: "/api/conversations?limit=2" + (before ? "&before=" + before : ""),
        headers,
      });
      assert.equal(r.statusCode, 200);
      const data = r.json();
      assert.equal(data.items.length, page === 2 ? 1 : 2);
      for (const c of data.items) {
        assert.ok(!ids.has(c.id));
        ids.add(c.id);
      }
      before = data.nextCursor;
    }
    assert.equal(ids.size, 5);
    assert.equal(before, null);
  } finally {
    await app.close();
    await db.close();
  }
});
