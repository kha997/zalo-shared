import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prepareEventMedia } from "../../server/media-jobs.js";
import {
  createLocatorCipher,
  locatorAad,
} from "../../server/locator-cipher.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT } from "../../server/db.js";
const cipher = () =>
  createLocatorCipher({
    activeKeyId: "test",
    keys: new Map([["test", randomBytes(32)]]),
    fingerprintKey: randomBytes(32),
  });
const candidate = {
  index: 0,
  name: "private.txt",
  category: "file" as const,
  url: "https://cdn.example.test/file?secret=synthetic",
};
test("private media receipt requires a cipher and bounded normalized descriptors before DB access", async () => {
  assert.throws(() => prepareEventMedia([candidate], undefined));
  const c = cipher(),
    prepared = prepareEventMedia([candidate], c);
  assert.equal(prepared.descriptors[0].name, "private.txt");
  assert.match(prepared.descriptors[0].locatorFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(prepared.descriptors).includes("secret"), false);
  for (const items of [
    [],
    [candidate, candidate],
    [{ ...candidate, index: 1 }],
    [{ ...candidate, name: "../private.txt" }],
    [{ ...candidate, url: "http://private.test" }],
  ])
    assert.throws(() => prepareEventMedia(items as any, c));
  let calls = 0;
  const pool = {
    connect: async () => {
      calls++;
      throw Error("must not connect");
    },
  } as any;
  await assert.rejects(
    ingestProviderEvent(pool, {
      threadType: 0,
      threadId: "peer",
      providerId: "id",
      senderId: "peer",
      isSelf: false,
      kind: "unsupported",
      media: [candidate],
    }),
  );
  await assert.rejects(
    ingestProviderEvent(
      pool,
      {
        threadType: 0,
        threadId: "peer",
        providerId: "id",
        senderId: "peer",
        isSelf: false,
        kind: "unsupported",
      },
      { owner: undefined } as any,
    ),
    /Connector ownership unavailable/,
  );
  assert.equal(calls, 0);
});
test("media journal encrypts and deduplicates intentions, conflicts retain no plaintext locators", async () => {
  const d = await isolatedDatabase(),
    c = cipher();
  const e = {
    threadType: 0 as const,
    threadId: "media-peer",
    providerId: "media-id",
    senderId: "peer",
    isSelf: false,
    kind: "unsupported" as const,
    media: [candidate],
  };
  try {
    const first = await ingestProviderEvent(d.pool, e, { mediaCipher: c });
    await Promise.all(
      Array.from({ length: 4 }, () =>
        ingestProviderEvent(d.pool, e, { mediaCipher: c }),
      ),
    );
    const jobs = (await d.pool.query("SELECT * FROM provider_media_jobs")).rows;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "pending");
    assert.equal(jobs[0].message_id, first.messageId);
    assert.equal(
      c.open(jobs[0].locator_envelope, locatorAad(ACCOUNT, first.eventId, 0)),
      candidate.url,
    );
    const event = (await d.pool.query("SELECT * FROM provider_events")).rows[0];
    assert.equal(JSON.stringify(event).includes("secret"), false);
    assert.equal(JSON.stringify(jobs).includes(candidate.url), false);
    const changed = await ingestProviderEvent(
      d.pool,
      {
        ...e,
        media: [
          { ...candidate, url: "https://cdn.example.test/file?secret=changed" },
        ],
      },
      { mediaCipher: c },
    );
    assert.equal(changed.conflict, true);
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM provider_media_jobs"))
        .rows[0].n,
      1,
    );
    assert.equal(
      JSON.stringify(
        (await d.pool.query("SELECT * FROM provider_event_variants")).rows,
      ).includes("secret"),
      false,
    );
    assert.equal(
      (
        await d.pool.query("SELECT actor_id FROM messages WHERE id=$1", [
          first.messageId,
        ])
      ).rows[0].actor_id,
      null,
    );
  } finally {
    await d.close();
  }
});
test("early exact staff media echoes reuse private bytes while native media stays unattributed", async () => {
  const { recordPartAccepted } = await import("../../server/provider-store.js");
  const d = await isolatedDatabase(),
    c = cipher();
  try {
    const base = {
      threadType: 0 as const,
      threadId: "staff-media",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text" as const,
      text: "hello",
    };
    const first = await ingestProviderEvent(d.pool, base);
    const cid = (
      await d.pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        first.messageId,
      ])
    ).rows[0].conversation_id;
    const actor = (
      await d.pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Staff','media-staff@example.test','unused','agent') RETURNING id",
      )
    ).rows[0].id;
    const mid = (
      await d.pool.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status) VALUES($1,'outbound','',$2,'processing') RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    const aid = (
      await d.pool.query(
        "INSERT INTO attachments(owner_id,name,mime,data,message_id) VALUES($1,'private.txt','text/plain',$2,$3) RETURNING id",
        [actor, Buffer.from("synthetic original bytes"), mid],
      )
    ).rows[0].id;
    await d.pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'processing')",
      [mid],
    );
    await d.pool.query(
      "INSERT INTO delivery_parts(message_id,part,status,attachment_id) VALUES($1,1,'processing',$2)",
      [mid, aid],
    );
    const echo = {
      threadType: 0 as const,
      threadId: base.threadId,
      providerId: "media-accepted",
      senderId: "self",
      isSelf: true,
      kind: "unsupported" as const,
      media: [candidate],
    };
    const early = await ingestProviderEvent(d.pool, echo, { mediaCipher: c });
    assert.equal(early.held, true);
    assert.equal(
      (await d.pool.query("SELECT status FROM provider_media_jobs")).rows[0]
        .status,
      "held",
    );
    const db = await d.pool.connect();
    try {
      await db.query("BEGIN");
      await recordPartAccepted(db, mid, 1, echo.providerId);
      await db.query("COMMIT");
    } finally {
      db.release();
    }
    const job = (await d.pool.query("SELECT * FROM provider_media_jobs"))
      .rows[0];
    assert.equal(job.status, "ready");
    assert.equal(job.attachment_id, aid);
    assert.equal(job.message_id, mid);
    assert.equal(job.locator_envelope, null);
    assert.equal(
      (await d.pool.query("SELECT actor_id FROM messages WHERE id=$1", [mid]))
        .rows[0].actor_id,
      actor,
    );
    await d.pool.query("UPDATE outbox SET status='sent' WHERE message_id=$1", [
      mid,
    ]);
    const native = await ingestProviderEvent(
      d.pool,
      { ...echo, providerId: "native-phone" },
      { mediaCipher: c },
    );
    assert.equal(
      (
        await d.pool.query("SELECT actor_id FROM messages WHERE id=$1", [
          native.messageId,
        ])
      ).rows[0].actor_id,
      null,
    );
    assert.equal(
      (
        await d.pool.query(
          "SELECT status FROM provider_media_jobs WHERE event_id=$1",
          [native.eventId],
        )
      ).rows[0].status,
      "pending",
    );
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      1,
    );
  } finally {
    await d.close();
  }
});
test("media quota, encryption failure and stale ownership roll back complete receipt intentions", async () => {
  const d = await isolatedDatabase(),
    c = cipher();
  const e = {
    threadType: 0 as const,
    threadId: "quota-media",
    providerId: "first",
    senderId: "peer",
    isSelf: false,
    kind: "unsupported" as const,
    media: [candidate],
  };
  try {
    await ingestProviderEvent(d.pool, e, {
      mediaCipher: c,
      maxPendingMedia: 1,
    });
    await assert.rejects(
      ingestProviderEvent(
        d.pool,
        { ...e, providerId: "overquota" },
        { mediaCipher: c, maxPendingMedia: 1 },
      ),
      /Private media receipt unavailable/,
    );
    await assert.rejects(
      ingestProviderEvent(
        d.pool,
        { ...e, providerId: "cipher-failure" },
        {
          mediaCipher: {
            ...c,
            seal() {
              throw Error(candidate.url);
            },
          },
        },
      ),
      /Private media receipt unavailable/,
    );
    await assert.rejects(
      ingestProviderEvent(
        d.pool,
        { ...e, providerId: "stale-owner" },
        {
          mediaCipher: c,
          owner: {
            accountId: ACCOUNT,
            ownerId: "00000000-0000-4000-8000-000000000099",
            epoch: "1",
          },
        },
      ),
      /Connector ownership unavailable/,
    );
    for (const table of ["provider_events", "provider_media_jobs", "messages"])
      assert.equal(
        (await d.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
        1,
      );
    const before = (await d.pool.query("SELECT * FROM provider_media_jobs"))
      .rows;
    const { migrate } = await import("../../server/db.js");
    await migrate(d.pool);
    assert.deepEqual(
      (await d.pool.query("SELECT * FROM provider_media_jobs")).rows,
      before,
    );
  } finally {
    await d.close();
  }
});
test("direct media receipt rejects locator-bearing names before descriptors or database writes", async () => {
  const c = cipher();
  let calls = 0;
  const pool = {
    connect: async () => {
      calls++;
      throw Error("must not connect");
    },
  } as any;
  for (const name of [
    candidate.url,
    "private.pdf?token=SYNTHETIC-LOCATOR-TOKEN",
    "private.pdf#secret",
    "user:password@host.pdf",
    "private.pdf&token=secret",
    "private%3Ftoken%3Dsecret.pdf",
    "private.pdf？token＝synthetic",
    "user＠host.pdf",
  ]) {
    const media = [{ ...candidate, name }];
    assert.throws(
      () => prepareEventMedia(media, c),
      /Private media receipt unavailable/,
    );
    await assert.rejects(
      ingestProviderEvent(
        pool,
        {
          threadType: 0,
          threadId: "peer",
          providerId: "secret-name",
          senderId: "peer",
          isSelf: false,
          kind: "unsupported",
          media,
        },
        { mediaCipher: c },
      ),
      /Private media receipt unavailable/,
    );
  }
  assert.equal(calls, 0);
});
