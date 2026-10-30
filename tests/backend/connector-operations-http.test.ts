import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isolatedDatabase } from "./isolation.js";
import { buildApp } from "../../server/app.js";
import { seed, ACCOUNT } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { decodeOperationsCursor } from "../../server/connector-operations-http.js";
import { ingestProviderEvent } from "../../server/provider-store.js";

test("operator HTTP routes enforce roles, CSRF, bounded private pages and exact-ID confirmation", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const email = randomUUID() + "@example.test",
      password = randomUUID();
    await seed(pool, { adminEmail: email, adminPassword: password });
    app = await buildApp({ pool, config: configFromEnv({}) });
    const login = async (email: string, password: string) => {
      const r = await app!.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password },
      });
      assert.equal(r.statusCode, 200);
      return {
        cookie: String(r.headers["set-cookie"]).split(";")[0],
        origin: "http://127.0.0.1:3100",
        "x-csrf-token": r.json().csrfToken,
      };
    };
    const admin = await login(email, password);
    for (const role of ["agent", "supervisor"]) {
      const e = randomUUID() + "@example.test",
        p = randomUUID();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/users",
            headers: admin,
            payload: { name: role, email: e, password: p, role },
          })
        ).statusCode,
        200,
      );
      const h = await login(e, p);
      for (const url of [
        "/api/provider/operations",
        "/api/provider/operations/events?state=held",
        "/api/provider/operations/unknown",
      ])
        assert.equal((await app.inject({ url, headers: h })).statusCode, 403);
      const summary: any = (
        await app.inject({ url: "/api/provider", headers: h })
      ).json();
      assert.equal(summary.mode, "disabled");
      assert.equal(summary.gapVersion, "0");
      assert.equal("owner" in summary, false);
    }
    for (const url of [
      "/api/provider/operations/events?state=held&limit=51",
      "/api/provider/operations/events?state=held&cursor=bad",
      "/api/provider/operations/unknown?limit=0",
    ])
      assert.equal((await app.inject({ url, headers: admin })).statusCode, 400);
    assert.equal(
      (await app.inject({ url: "/api/provider/operations", headers: admin }))
        .statusCode,
      200,
    );
    const b = {
      threadType: 0 as const,
      threadId: "http-ops",
      providerId: "inbound",
      senderId: "peer",
      isSelf: false,
      kind: "text" as const,
      text: "synthetic",
    };
    await ingestProviderEvent(pool, b);
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    const actor = (
      await pool.query("SELECT id FROM users WHERE email=$1", [email])
    ).rows[0].id;
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status,actor_id) VALUES($1,'outbound','original staff message','unknown',$2) RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,0,'unknown')",
      [mid],
    );
    const receipt = await ingestProviderEvent(pool, {
      ...b,
      providerId: "exact-observed-id",
      isSelf: true,
      senderId: "self",
    });
    assert.equal(receipt.held, true);
    const listing = await app.inject({
      url: "/api/provider/operations/events?state=held&limit=1",
      headers: admin,
    });
    assert.equal(listing.statusCode, 200);
    assert.equal(listing.json().items[0].id, receipt.eventId);
    const detail = await app.inject({
      url: "/api/provider/operations/events/" + receipt.eventId,
      headers: admin,
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().providerId, "exact-observed-id");
    const secondReceipt = await ingestProviderEvent(pool, {
      ...b,
      providerId: "second-held-id",
      isSelf: true,
      senderId: "self",
    });
    const page1 = (
      await app.inject({
        url: "/api/provider/operations/events?state=held&limit=1",
        headers: admin,
      })
    ).json();
    assert.equal(typeof page1.nextCursor, "string");
    const page2 = (
      await app.inject({
        url:
          "/api/provider/operations/events?state=held&limit=1&cursor=" +
          page1.nextCursor,
        headers: admin,
      })
    ).json();
    assert.deepEqual(
      new Set([page1.items[0].id, page2.items[0].id]),
      new Set([receipt.eventId, secondReceipt.eventId]),
    );
    const body = {
      messageId: mid,
      part: 0,
      eventId: receipt.eventId,
      expectedResolutionVersion: "0",
      evidenceRef: "synthetic-review-1",
      confirmProviderIdObserved: true,
    };
    for (const headers of [
      { ...admin, origin: "https://wrong.example.test" },
      { ...admin, "x-csrf-token": "wrong" },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/provider/operations/confirm-part",
            headers,
            payload: body,
          })
        ).statusCode,
        403,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/operations/confirm-part",
          headers: admin,
          payload: { ...body, expectedResolutionVersion: "not-a-version" },
        })
      ).statusCode,
      400,
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/provider/operations/confirm-part",
      headers: admin,
      payload: body,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().messageStatus, "sent");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/operations/confirm-part",
          headers: admin,
          payload: body,
        })
      ).statusCode,
      409,
    );
    const m = (
      await pool.query(
        "SELECT actor_id,status,provider_id FROM messages WHERE id=$1",
        [mid],
      )
    ).rows[0];
    assert.deepEqual(m, {
      actor_id: actor,
      status: "sent",
      provider_id: "exact-observed-id",
    });
    assert.equal(
      (await pool.query("SELECT * FROM provider_ledger")).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.part_confirmed'",
        )
      ).rows[0].n,
      1,
    );
    const canonical = await ingestProviderEvent(pool, {
      ...b,
      providerId: "canonical-conflict",
    });
    await ingestProviderEvent(pool, {
      ...b,
      providerId: "canonical-conflict",
      text: "different normalized evidence",
    });
    const conflictDetail = (
      await app.inject({
        url: "/api/provider/operations/events/" + canonical.eventId,
        headers: admin,
      })
    ).json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/operations/resolve-conflict",
          headers: admin,
          payload: {
            eventId: canonical.eventId,
            expectedResolutionVersion: conflictDetail.resolutionVersion,
            expectedVariantHashes: conflictDetail.variants.map(
              (v: any) => v.semanticHash,
            ),
            decision: "retain-canonical",
            evidenceRef: "synthetic-conflict-review",
            confirmExternalReview: true,
          },
        })
      ).statusCode,
      200,
    );
    const overview = (
      await app.inject({ url: "/api/provider/operations", headers: admin })
    ).json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/operations/ack-gap",
          headers: admin,
          payload: {
            expectedGapVersion: overview.gapVersion,
            expectedOwnerId: overview.owner.ownerId,
            expectedOwnerEpoch: overview.owner.epoch,
            evidenceRef: "synthetic-history-review",
            confirmHistoryReviewed: true,
          },
        })
      ).statusCode,
      200,
    );
    const safeSummary = (
      await app.inject({ url: "/api/provider", headers: admin })
    ).json();
    assert.equal(safeSummary.status, "disconnected");
    assert.equal(safeSummary.reconciliationRequired, false);
    const ownerId = randomUUID();
    await pool.query(
      "UPDATE connector_ownership SET phase='uncertain',owner_id=$1,epoch=2",
      [ownerId],
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/operations/ack-fence",
          headers: admin,
          payload: {
            expectedOwnerId: ownerId,
            expectedEpoch: "2",
            evidenceRef: "synthetic-stopped-egress-fence",
            acknowledgeExternalFence: true,
          },
        })
      ).statusCode,
      200,
    );
    const otherAccount = randomUUID();
    const foreign = (
      await pool.query(
        "INSERT INTO conversations(account_id,contact_id,contact_name) VALUES($1,'foreign','Foreign') RETURNING id",
        [otherAccount],
      )
    ).rows[0].id;
    const foreignMessage = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','must not leak','unknown') RETURNING id",
        [foreign],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [foreignMessage],
    );
    const foreignEvent = (
      await pool.query(
        "INSERT INTO provider_events(account_id,conversation_id,thread_type,thread_id,direction,provider_id,sender_id,kind,text,semantic_hash,state) VALUES($1,$2,0,'foreign','outbound','foreign-event','self','text','must not leak',$3,'held') RETURNING id",
        [otherAccount, foreign, "a".repeat(64)],
      )
    ).rows[0].id;
    assert.equal(
      (
        await app.inject({
          url: "/api/provider/operations/events/" + foreignEvent,
          headers: admin,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      JSON.stringify(
        (
          await app.inject({
            url: "/api/provider/operations/events?state=held",
            headers: admin,
          })
        ).json(),
      ).includes("must not leak"),
      false,
    );
    assert.equal(
      JSON.stringify(
        (
          await app.inject({
            url: "/api/provider/operations/unknown",
            headers: admin,
          })
        ).json(),
      ).includes("must not leak"),
      false,
    );
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [actor]);
    assert.equal(
      (await app.inject({ url: "/api/provider/operations", headers: admin }))
        .statusCode,
      401,
    );
  } finally {
    await app?.close();
    await database.close();
  }
});

test("operator cursor rejects malformed and normalized calendar dates before SQL", () => {
  const cursor = (time: string, id: string = randomUUID()) =>
    Buffer.from(JSON.stringify({ time, id })).toString("base64url");
  assert.equal(decodeOperationsCursor(undefined), null);
  for (const v of [
    "bad",
    "x".repeat(513),
    cursor("2026-02-30T12:00:00.123456Z"),
    cursor("0000-01-01T00:00:00.000000Z"),
    cursor("2026-10-30T12:00:00.123456Z", "not-uuid"),
  ])
    assert.throws(() => decodeOperationsCursor(v));
  assert.equal(
    decodeOperationsCursor(cursor("2026-10-30T12:00:00.123456Z"))!.time,
    "2026-10-30T12:00:00.123456Z",
  );
});

test(
  "operator HTTP rechecks admin after initial authentication for reads and mutations",
  { timeout: 15000 },
  async () => {
    const database = await isolatedDatabase();
    let release = () => {},
      reached = () => {};
    let paused = Promise.resolve(),
      intercepted = Promise.resolve(),
      armed = false;
    const pool = new Proxy(database.pool, {
      get(target, key) {
        if (key === "query")
          return async (...args: any[]) => {
            const r = await (target.query as any)(...args);
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
            return r;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let app: Awaited<ReturnType<typeof buildApp>> | undefined,
      pending: Promise<any> | undefined;
    try {
      const email = randomUUID() + "@example.test",
        password = randomUUID();
      await seed(database.pool, { adminEmail: email, adminPassword: password });
      app = await buildApp({ pool, config: configFromEnv({}) });
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password },
      });
      assert.equal(login.statusCode, 200);
      const actor = login.json().user.id;
      const headers = {
        cookie: String(login.headers["set-cookie"]).split(";")[0],
        origin: "http://127.0.0.1:3100",
        "x-csrf-token": login.json().csrfToken,
      };
      for (const mutation of [false, true]) {
        await database.pool.query("UPDATE users SET role='admin' WHERE id=$1", [
          actor,
        ]);
        paused = new Promise<void>((r) => {
          release = r;
        });
        intercepted = new Promise<void>((r) => {
          reached = r;
        });
        armed = true;
        pending = app
          .inject(
            mutation
              ? {
                  method: "POST",
                  url: "/api/provider/operations/ack-gap",
                  headers,
                  payload: {
                    expectedGapVersion: "0",
                    expectedOwnerId: null,
                    expectedOwnerEpoch: "0",
                    evidenceRef: "synthetic-race",
                    confirmHistoryReviewed: true,
                  },
                }
              : { url: "/api/provider/operations", headers },
          )
          .then((r) => r);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            intercepted,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error("Authentication interception timed out")),
                4000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        const db = await database.pool.connect();
        try {
          await db.query("BEGIN");
          await db.query("SELECT pg_advisory_xact_lock(72001)");
          await db.query("UPDATE users SET role='agent' WHERE id=$1", [actor]);
          await db.query("COMMIT");
        } finally {
          db.release();
        }
        release();
        assert.equal((await pending).statusCode, 403);
      }
      assert.equal(
        (
          await database.pool.query(
            "SELECT count(*)::int n FROM audit WHERE action='connector.gap_acknowledged'",
          )
        ).rows[0].n,
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
