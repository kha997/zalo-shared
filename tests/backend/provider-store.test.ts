import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedDatabase } from "./isolation.js";
import { migrate } from "../../server/db.js";
import {
  ingestProviderEvent,
  recordPartAccepted,
  reconcileSelfEvents,
} from "../../server/provider-store.js";
const event = {
  threadType: 0 as const,
  threadId: "synthetic-thread",
  providerId: "synthetic-event",
  senderId: "synthetic-sender",
  isSelf: false,
  kind: "text" as const,
  text: "hello",
};
test("provider store exports bounded acceptance before opening a database", async () => {
  assert.equal(typeof recordPartAccepted, "function");
  assert.equal(typeof reconcileSelfEvents, "function");
  await assert.rejects(
    ingestProviderEvent(null as any, { ...event, text: "x".repeat(10001) }),
    /Invalid/,
  );
});
test("journal serializes replay, scopes identities, flags conflict and survives migration", async () => {
  const db = await isolatedDatabase();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ingestProviderEvent(db.pool, event)),
    );
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    assert.equal((await db.pool.query("SELECT * FROM messages")).rowCount, 1);
    await ingestProviderEvent(db.pool, { ...event, threadType: 1 });
    await ingestProviderEvent(db.pool, { ...event, isSelf: true });
    assert.equal((await db.pool.query("SELECT * FROM messages")).rowCount, 3);
    const conflict = await ingestProviderEvent(db.pool, {
      ...event,
      text: "changed",
    });
    assert.equal(conflict.conflict, true);
    await ingestProviderEvent(db.pool, { ...event, text: "changed again" });
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM audit WHERE action='provider.event_conflict'",
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT reconciliation_required FROM provider_state",
        )
      ).rows[0].reconciliation_required,
      true,
    );
    await migrate(db.pool);
    assert.equal(
      (await db.pool.query("SELECT * FROM provider_events")).rowCount,
      3,
    );
  } finally {
    await db.close();
  }
});
test("early echoes reconcile exact parts, preserve staff and release native phone messages after completion", async () => {
  const db = await isolatedDatabase();
  const c = await db.pool.connect();
  try {
    const initial = await ingestProviderEvent(db.pool, event);
    const cid = (
      await c.query("SELECT conversation_id FROM messages WHERE id=$1", [
        initial.messageId,
      ])
    ).rows[0].conversation_id;
    const actor = (
      await c.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Staff','synthetic@example.invalid','none','agent') RETURNING id",
      )
    ).rows[0].id;
    const mid = (
      await c.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status) VALUES($1,'outbound','app',$2,'processing') RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'processing')",
      [mid],
    );
    await c.query("INSERT INTO delivery_parts(message_id,part) VALUES($1,0)", [
      mid,
    ]);
    assert.equal(
      (
        await ingestProviderEvent(db.pool, {
          ...event,
          isSelf: true,
          providerId: "app-echo",
        })
      ).held,
      true,
    );
    assert.equal(
      (
        await ingestProviderEvent(db.pool, {
          ...event,
          isSelf: true,
          providerId: "phone",
        })
      ).held,
      true,
    );
    await c.query("BEGIN");
    await recordPartAccepted(c, mid, 0, "app-echo");
    await c.query("ROLLBACK");
    assert.equal(
      (
        await c.query(
          "SELECT state FROM provider_events WHERE provider_id='app-echo'",
        )
      ).rows[0].state,
      "held",
    );
    await c.query("BEGIN");
    await recordPartAccepted(c, mid, 0, "app-echo");
    await c.query("UPDATE outbox SET status='sent' WHERE message_id=$1", [mid]);
    await reconcileSelfEvents(c, cid);
    await c.query("COMMIT");
    const echo = (
      await c.query(
        "SELECT m.actor_id,e.message_id FROM provider_events e JOIN messages m ON m.id=e.message_id WHERE e.provider_id='app-echo'",
      )
    ).rows[0];
    assert.equal(echo.message_id, mid);
    assert.equal(echo.actor_id, actor);
    const phone = (
      await c.query(
        "SELECT m.actor_id FROM provider_events e JOIN messages m ON m.id=e.message_id WHERE e.provider_id='phone'",
      )
    ).rows[0];
    assert.equal(phone.actor_id, null);
    assert.equal(
      (
        await ingestProviderEvent(db.pool, {
          ...event,
          isSelf: true,
          providerId: "app-echo",
        })
      ).messageId,
      mid,
    );
  } finally {
    c.release();
    await db.close();
  }
});
test("unknown attempts keep echoes held; mappings and explicit transaction requirements are enforced", async () => {
  const db = await isolatedDatabase();
  const c = await db.pool.connect();
  try {
    const first = await ingestProviderEvent(db.pool, event);
    const cid = (
      await c.query("SELECT conversation_id FROM messages WHERE id=$1", [
        first.messageId,
      ])
    ).rows[0].conversation_id;
    await assert.rejects(reconcileSelfEvents(c, cid), /transaction/);
    const mid = (
      await c.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','app','unknown') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await c.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0),($1,1)",
      [mid],
    );
    const held = await ingestProviderEvent(db.pool, {
      ...event,
      isSelf: true,
      providerId: "unrecognized",
    });
    assert.equal(held.held, true);
    await c.query("BEGIN");
    await reconcileSelfEvents(c, cid);
    await c.query("COMMIT");
    assert.equal(
      (
        await c.query("SELECT state FROM provider_events WHERE id=$1", [
          held.eventId,
        ])
      ).rows[0].state,
      "held",
    );
    await c.query("BEGIN");
    await recordPartAccepted(c, mid, 0, "accepted");
    await assert.rejects(
      recordPartAccepted(c, mid, 1, "accepted"),
      /Conflicting/,
    );
    await c.query("ROLLBACK");
    assert.equal(
      (
        await c.query(
          "SELECT provider_id FROM delivery_parts WHERE message_id=$1 AND part=0",
          [mid],
        )
      ).rows[0].provider_id,
      null,
    );
  } finally {
    c.release();
    await db.close();
  }
});
test("late self echo matches accepted part while native projection cannot be reassigned", async () => {
  const db = await isolatedDatabase();
  const c = await db.pool.connect();
  try {
    const first = await ingestProviderEvent(db.pool, event);
    const cid = (
      await c.query("SELECT conversation_id FROM messages WHERE id=$1", [
        first.messageId,
      ])
    ).rows[0].conversation_id;
    const mid = (
      await c.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','app','sent') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0),($1,1)",
      [mid],
    );
    await c.query("BEGIN");
    await recordPartAccepted(c, mid, 0, "late");
    await c.query("COMMIT");
    assert.equal(
      (
        await ingestProviderEvent(db.pool, {
          ...event,
          isSelf: true,
          providerId: "late",
        })
      ).messageId,
      mid,
    );
    const native = await ingestProviderEvent(db.pool, {
      ...event,
      isSelf: true,
      providerId: "native",
    });
    assert.notEqual(native.messageId, mid);
    await c.query("BEGIN");
    await assert.rejects(
      recordPartAccepted(c, mid, 1, "native"),
      /Conflicting/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
    await db.close();
  }
});
test("known conflict replay restores quarantine without duplicating its audit", async () => {
  const db = await isolatedDatabase();
  try {
    await ingestProviderEvent(db.pool, event);
    await ingestProviderEvent(db.pool, { ...event, text: "conflict" });
    for (const text of ["conflict", event.text]) {
      await db.pool.query(
        "UPDATE provider_state SET status='connected',reconciliation_required=false,fault_code=NULL",
      );
      assert.equal(
        (await ingestProviderEvent(db.pool, { ...event, text })).conflict,
        true,
      );
      const state = (await db.pool.query("SELECT * FROM provider_state"))
        .rows[0];
      assert.equal(state.status, "disconnected");
      assert.equal(state.reconciliation_required, true);
      assert.equal(state.fault_code, "provider_event_conflict");
    }
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM audit WHERE action='provider.event_conflict'",
        )
      ).rowCount,
      1,
    );
  } finally {
    await db.close();
  }
});
test("message activity preserves assignment version and direction status contract", async () => {
  const db = await isolatedDatabase();
  try {
    const incoming = await ingestProviderEvent(db.pool, event);
    const original = (
      await db.pool.query(
        "SELECT c.* FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE m.id=$1",
        [incoming.messageId],
      )
    ).rows[0];
    const native = await ingestProviderEvent(db.pool, {
      ...event,
      isSelf: true,
    });
    assert.equal(
      (
        await db.pool.query("SELECT status FROM messages WHERE id=$1", [
          incoming.messageId,
        ])
      ).rows[0].status,
      "received",
    );
    assert.equal(
      (
        await db.pool.query("SELECT status FROM messages WHERE id=$1", [
          native.messageId,
        ])
      ).rows[0].status,
      "sent",
    );
    assert.equal(
      (
        await db.pool.query(
          "UPDATE conversations SET version=version+1 WHERE id=$1 AND version=$2 RETURNING id",
          [original.id, original.version],
        )
      ).rowCount,
      1,
    );
  } finally {
    await db.close();
  }
});
