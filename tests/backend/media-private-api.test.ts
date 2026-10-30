import test from "node:test";
import type { LightMyRequestResponse } from "fastify";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { canReplaceMediaSnapshot } from "../../client/src/InboundMediaStatus.js";
import { buildApp, safeInboundMedia } from "../../server/app.js";
import { ACCOUNT, seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { isolatedDatabase } from "./isolation.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { createLocatorCipher } from "../../server/locator-cipher.js";

test("media projection never returns encrypted locators, fingerprints or unsafe metadata", () => {
  const secret = "SYNTHETIC-LOCATOR-TOKEN";
  const view = safeInboundMedia(
    Array.from({ length: 8 }, (_, i) => ({
      id: randomUUID(),
      name: `https://cdn.example.test/file?token=${secret}`,
      category: "file",
      status: "pending",
      version: "9007199254740993",
      error_code: `https://cdn.example.test/?token=${secret}`,
      attachment_id: null,
      locator_envelope: { ciphertext: secret },
      locator_fingerprint: secret,
      extra: secret,
    })),
  );
  assert.equal(view.length, 5);
  assert.equal(view[0].version, "9007199254740993");
  assert.equal(view[0].name, "Tệp đính kèm");
  assert.equal(view[0].errorCode, "unavailable");
  assert.equal(JSON.stringify(view).includes(secret), false);
  assert.deepEqual(Object.keys(view[0]).sort(), [
    "attachmentId",
    "category",
    "errorCode",
    "id",
    "name",
    "status",
    "version",
  ]);
  assert.equal(
    safeInboundMedia([
      {
        id: randomUUID(),
        name: "safe.txt",
        category: "file",
        status: "ready",
        version: "1",
        attachment_id: null,
      },
    ])[0].status,
    "unavailable",
  );
});

test("four staff read only private bounded media metadata and refresh an older ready attachment", async () => {
  const database = await isolatedDatabase();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const { pool } = database;
    const email = `${randomUUID()}@example.test`,
      password = randomUUID();
    await seed(pool, { adminEmail: email, adminPassword: password });
    app = await buildApp({ pool, config: configFromEnv({}) });
    async function login(email: string, password: string) {
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
    }
    const admin = await login(email, password),
      staff = [];
    for (let i = 0; i < 4; i++) {
      const email = `${randomUUID()}@example.test`,
        password = randomUUID();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/users",
            headers: admin,
            payload: {
              email,
              password,
              name: `Media reader ${i}`,
              role: "agent",
            },
          })
        ).statusCode,
        200,
      );
      staff.push(await login(email, password));
    }
    const cipher = createLocatorCipher({
      activeKeyId: "test",
      keys: new Map([["test", randomBytes(32)]]),
      fingerprintKey: randomBytes(32),
    });
    const receipt = await ingestProviderEvent(
      pool,
      {
        threadType: 0,
        threadId: "private-media",
        providerId: "private-file",
        senderId: "peer",
        isSelf: false,
        kind: "unsupported",
        media: [
          {
            index: 0,
            name: "ready.txt",
            category: "file",
            url: "https://cdn.example.test/file?token=SYNTHETIC-LOCATOR-TOKEN",
          },
        ],
      },
      { mediaCipher: cipher },
    );
    const mid = receipt.messageId!,
      cid = (
        await pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
          mid,
        ])
      ).rows[0].conversation_id;
    const read = (headers: any) =>
      app!.inject({ url: `/api/messages/${mid}`, headers });
    assert.equal((await read({})).statusCode, 401);
    for (const headers of staff) {
      const response = await read(headers);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().media[0].status, "pending");
      assert.equal(response.json().mediaPlaceholder, true);
      assert.equal(response.body.includes("SYNTHETIC-LOCATOR-TOKEN"), false);
      assert.equal(response.body.includes("locator_envelope"), false);
      assert.equal(response.body.includes("locatorFingerprint"), false);
    }
    const staffActor = (
      await pool.query(
        "SELECT id FROM users WHERE role='agent' ORDER BY id LIMIT 1",
      )
    ).rows[0].id;
    await pool.query("UPDATE messages SET actor_id=$2 WHERE id=$1", [
      mid,
      staffActor,
    ]);
    assert.equal((await read(staff[0])).json().mediaPlaceholder, false);
    await pool.query("UPDATE messages SET actor_id=NULL WHERE id=$1", [mid]);
    const aid = (
      await pool.query(
        "INSERT INTO attachments(name,mime,data,message_id) VALUES('ready.txt','text/plain',$1,$2) RETURNING id",
        [Buffer.from("synthetic private bytes"), mid],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE provider_media_jobs SET status='ready',attachment_id=$1,locator_envelope=NULL,version=version+1 WHERE event_id=$2",
      [aid, receipt.eventId],
    );
    await pool.query(
      "UPDATE messages SET created_at=now()-interval '1 hour' WHERE id=$1",
      [mid],
    );
    await pool.query(
      "INSERT INTO messages(conversation_id,direction,text,status) SELECT $1,'inbound','newer','received' FROM generate_series(1,60)",
      [cid],
    );
    const list = await app.inject({
      url: `/api/conversations/${cid}/messages?limit=50`,
      headers: staff[0],
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json().items.some((m: any) => m.id === mid),
      false,
    );
    for (const headers of staff) {
      const ready = await read(headers);
      assert.equal(ready.json().media[0].attachmentId, aid);
      assert.equal(ready.json().media[0].status, "ready");
      assert.equal(ready.json().attachments[0].url, `/api/attachments/${aid}`);
      const bytes: LightMyRequestResponse = await app.inject({
        url: `/api/attachments/${aid}`,
        headers,
      });
      assert.equal(bytes.statusCode, 200);
      assert.equal(bytes.body, "synthetic private bytes");
      assert.equal(bytes.headers["x-content-type-options"], "nosniff");
    }
    const upload = await app.inject({
      method: "POST",
      url: "/api/attachments",
      headers: admin,
      payload: {
        name: "unattached.txt",
        mime: "text/plain",
        dataBase64: Buffer.from("private owner upload").toString("base64"),
      },
    });
    assert.equal(upload.statusCode, 200);
    assert.equal(
      (
        await app.inject({
          url: `/api/attachments/${upload.json().id}`,
          headers: staff[0],
        })
      ).statusCode,
      404,
    );
    const other = randomUUID();
    await pool.query(
      "INSERT INTO provider_media_jobs(account_id,event_id,item_index,category,name,locator_fingerprint,status,message_id) VALUES($1,$2,1,'file','foreign-hidden.txt',$3,'pending',$4)",
      [other, receipt.eventId, "a".repeat(64), mid],
    );
    assert.equal((await read(staff[0])).json().media.length, 1);

    const foreignCid = (
      await pool.query(
        "INSERT INTO conversations(account_id,contact_id,contact_name) VALUES($1,'foreign','Foreign') RETURNING id",
        [other],
      )
    ).rows[0].id;
    const foreignMid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'inbound','foreign','received') RETURNING id",
        [foreignCid],
      )
    ).rows[0].id;
    const foreignAid = (
      await pool.query(
        "INSERT INTO attachments(account_id,name,mime,data,message_id) VALUES($1,'foreign.txt','text/plain',$2,$3) RETURNING id",
        [other, Buffer.from("foreign bytes"), foreignMid],
      )
    ).rows[0].id;
    assert.equal(
      (
        await app.inject({
          url: `/api/messages/${foreignMid}`,
          headers: staff[0],
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/attachments/${foreignAid}`,
          headers: staff[0],
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: `/api/attachments/${aid}` })).statusCode,
      401,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT account_id FROM provider_media_jobs WHERE event_id=$1",
          [receipt.eventId],
        )
      ).rows[0].account_id,
      ACCOUNT,
    );
  } finally {
    await app?.close();
    await database.close();
  }
});

test("delayed media refresh cannot roll back a newer ready file or erase its attachment", () => {
  const id = randomUUID(),
    job = randomUUID(),
    attachment = randomUUID();
  const current: any = {
    id,
    conversationId: randomUUID(),
    attachments: [{ id: attachment }],
    media: [{ id: job, status: "ready", version: "9007199254740993" }],
  };
  assert.equal(
    canReplaceMediaSnapshot(current, {
      ...current,
      attachments: [],
      media: [{ id: job, status: "pending", version: "9007199254740992" }],
    }),
    false,
  );
  assert.equal(
    canReplaceMediaSnapshot(current, { ...current, attachments: [] }),
    false,
  );
  assert.equal(
    canReplaceMediaSnapshot(current, { ...current, media: [] }),
    false,
  );
  assert.equal(
    canReplaceMediaSnapshot(current, {
      ...current,
      media: [{ id: job, status: "ready", version: "9007199254740994" }],
    }),
    true,
  );
  assert.equal(
    canReplaceMediaSnapshot(current, {
      ...current,
      conversationId: randomUUID(),
    }),
    false,
  );
});
