import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { configFromEnv } from "../../server/config.js";
import { seed } from "../../server/db.js";
import { isolatedDatabase } from "./isolation.js";

test("conversation search treats percent and underscore as literal characters", async () => {
  const db = await isolatedDatabase();
  const password = randomUUID();
  await seed(db.pool, {
    adminEmail: "search@example.test",
    adminPassword: password,
  });
  await db.pool.query(
    "INSERT INTO conversations(contact_id,contact_name) VALUES ('literal-percent','100% coverage'),('literal-underscore','under_score peer'),('plain-peer','plain synthetic')",
  );
  const app = await buildApp({ pool: db.pool, config: configFromEnv({}) });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "search@example.test", password },
    });
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    const search = async (term: string) => {
      const r: {
        statusCode: number;
        json: () => { items: { contactId: string }[] };
      } = await app.inject({
        url: `/api/conversations?limit=50&search=${encodeURIComponent(term)}`,
        headers,
      });
      assert.equal(r.statusCode, 200);
      return r.json().items.map((c) => c.contactId).sort();
    };
    assert.deepEqual(await search("%"), ["literal-percent"]);
    assert.deepEqual(await search("_"), ["literal-underscore"]);
    assert.deepEqual(await search("100%"), ["literal-percent"]);
    assert.deepEqual(await search("under_score"), ["literal-underscore"]);
    assert.deepEqual(await search("\\"), []);
  } finally {
    await app.close();
    await db.close();
  }
});

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
