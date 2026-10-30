import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  acknowledgeProviderGap,
  confirmUnknownPart,
  resolveKnownConflict,
  ConnectorOperationError,
} from "../../server/connector-operations.js";
import { ACCOUNT } from "../../server/db.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import {
  recordProviderFault,
  MAX_GAP_VERSION,
} from "../../server/provider-faults.js";
import { isolatedDatabase } from "./isolation.js";
const actor = { id: randomUUID() };
const ref = "synthetic-review-17";
const invalid = (status: number) => (e: unknown) =>
  e instanceof ConnectorOperationError &&
  e.statusCode === status &&
  !e.message.includes("secret");
test("operations reject invalid shape and exhausted versions before any database access", async () => {
  let queries = 0;
  const db = {
    async query() {
      queries++;
      throw Error("secret database");
    },
  } as any;
  const good = {
    messageId: randomUUID(),
    part: 0,
    eventId: randomUUID(),
    expectedResolutionVersion: "0",
    evidenceRef: ref,
    confirmProviderIdObserved: true as const,
  };
  for (const input of [
    null,
    { ...good, part: -1 },
    { ...good, expectedResolutionVersion: MAX_GAP_VERSION },
    { ...good, evidenceRef: "https://secret.example.test" },
    { ...good, confirmProviderIdObserved: false },
    { ...good, extra: true },
  ])
    await assert.rejects(
      confirmUnknownPart(db, actor, input as any),
      invalid(400),
    );
  await assert.rejects(
    resolveKnownConflict(db, actor, {
      eventId: randomUUID(),
      expectedResolutionVersion: "0",
      expectedVariantHashes: [],
      decision: "retain-canonical",
      evidenceRef: ref,
      confirmExternalReview: true,
    }),
    invalid(400),
  );
  await assert.rejects(
    acknowledgeProviderGap(db, actor, {
      expectedGapVersion: MAX_GAP_VERSION,
      expectedOwnerId: null,
      expectedOwnerEpoch: "0",
      evidenceRef: ref,
      confirmHistoryReviewed: true,
    }),
    invalid(400),
  );
  assert.equal(queries, 0);
});
test("operations require an explicit transaction and a freshly authorized administrator", async () => {
  const input = {
    expectedGapVersion: "0",
    expectedOwnerId: null,
    expectedOwnerEpoch: "0",
    evidenceRef: ref,
    confirmHistoryReviewed: true as const,
  };
  let reads = 0;
  const db = {
    async query(sql: string) {
      reads++;
      return {
        rows: sql.includes("current_setting") ? [{ marker: "" }] : [],
        rowCount: 0,
      };
    },
  } as any;
  await assert.rejects(acknowledgeProviderGap(db, actor, input), invalid(409));
  assert.equal(reads, 2);
  const revoked = {
    async query(sql: string) {
      return {
        rows: sql.includes("current_setting") ? [{ marker: "active" }] : [],
        rowCount: 0,
      };
    },
  } as any;
  await assert.rejects(
    acknowledgeProviderGap(revoked, actor, input),
    invalid(403),
  );
});

test("exact-ID recovery preserves staff attribution, partial confirmations and audited concurrency", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  async function tx<T>(fn: (db: any) => Promise<T>) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
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
  try {
    const admin = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','ops-admin@example.test','unused','admin') RETURNING id",
      )
    ).rows[0];
    const staff = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Staff','ops-staff@example.test','unused','agent') RETURNING id",
      )
    ).rows[0];
    const event = {
      threadType: 0 as const,
      threadId: "ops-peer",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text" as const,
      text: "synthetic",
    };
    const received = await ingestProviderEvent(pool, event);
    const cid = (
      await pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        received.messageId,
      ])
    ).rows[0].conversation_id;
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status) VALUES($1,'outbound','synthetic',$2,'unknown') RETURNING id",
        [cid, staff.id],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,0,'unknown'),($1,1,'unknown')",
      [mid],
    );
    const first = await ingestProviderEvent(pool, {
      ...event,
      isSelf: true,
      providerId: "same-id",
      senderId: "self",
    });
    const second = await ingestProviderEvent(pool, {
      ...event,
      isSelf: true,
      providerId: "second-id",
      senderId: "self",
    });
    const input = {
      messageId: mid,
      part: 0,
      eventId: first.eventId,
      expectedResolutionVersion: "0",
      evidenceRef: ref,
      confirmProviderIdObserved: true as const,
    };
    await assert.rejects(
      tx((db) => confirmUnknownPart(db, staff, input)),
      invalid(403),
    );
    const other = await ingestProviderEvent(pool, {
      ...event,
      threadId: "other-thread",
      isSelf: true,
      providerId: "same-id",
      senderId: "self",
    });
    await assert.rejects(
      tx((db) =>
        confirmUnknownPart(db, admin, { ...input, eventId: other.eventId }),
      ),
      invalid(409),
    );
    assert.deepEqual(await tx((db) => confirmUnknownPart(db, admin, input)), {
      messageStatus: "unknown",
    });
    assert.equal(
      (await pool.query("SELECT actor_id FROM messages WHERE id=$1", [mid]))
        .rows[0].actor_id,
      staff.id,
    );
    const results = await Promise.allSettled([
      tx((db) =>
        confirmUnknownPart(db, admin, {
          ...input,
          part: 1,
          eventId: second.eventId,
        }),
      ),
      tx((db) =>
        confirmUnknownPart(db, admin, {
          ...input,
          part: 1,
          eventId: second.eventId,
        }),
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const final = (
      await pool.query(
        "SELECT m.status,m.actor_id,m.provider_id,o.status outbox_status FROM messages m JOIN outbox o ON o.message_id=m.id WHERE m.id=$1",
        [mid],
      )
    ).rows[0];
    assert.deepEqual(final, {
      status: "sent",
      actor_id: staff.id,
      provider_id: "same-id",
      outbox_status: "sent",
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.part_confirmed' AND actor_id=$1",
          [admin.id],
        )
      ).rows[0].n,
      2,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [mid],
        )
      ).rows.map((r) => r.status),
      ["sent", "sent"],
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM provider_ledger")).rows[0]
        .n,
      0,
    );
    await pool.query("UPDATE users SET active=false WHERE id=$1", [admin.id]);
    await assert.rejects(
      tx((db) =>
        acknowledgeProviderGap(db, admin, {
          expectedGapVersion: "0",
          expectedOwnerId: null,
          expectedOwnerEpoch: "0",
          evidenceRef: ref,
          confirmHistoryReviewed: true,
        }),
      ),
      invalid(403),
    );
  } finally {
    await d.close();
  }
});

test("conflict resolution retains evidence and gap acknowledgement cannot hide later faults", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  async function tx<T>(fn: (db: any) => Promise<T>) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
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
  try {
    const admin = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','ops-gap@example.test','unused','admin') RETURNING id",
      )
    ).rows[0];
    const e = {
      threadType: 0 as const,
      threadId: "gap-peer",
      providerId: "conflict",
      senderId: "peer",
      isSelf: false,
      kind: "text" as const,
      text: "canonical",
    };
    const initial = await ingestProviderEvent(pool, e);
    await ingestProviderEvent(pool, { ...e, text: "different" });
    const row = (
      await pool.query("SELECT * FROM provider_events WHERE id=$1", [
        initial.eventId,
      ])
    ).rows[0];
    const hashes = (
      await pool.query(
        "SELECT semantic_hash FROM provider_event_variants WHERE event_id=$1",
        [initial.eventId],
      )
    ).rows.map((r) => r.semantic_hash);
    const resolve = {
      eventId: initial.eventId,
      expectedResolutionVersion: String(row.resolution_version),
      expectedVariantHashes: hashes,
      decision: "retain-canonical" as const,
      evidenceRef: ref,
      confirmExternalReview: true as const,
    };
    await assert.rejects(
      tx((db) =>
        resolveKnownConflict(db, admin, {
          ...resolve,
          expectedVariantHashes: ["0".repeat(64)],
        }),
      ),
      invalid(409),
    );
    await tx((db) => resolveKnownConflict(db, admin, resolve));
    await assert.rejects(
      tx((db) => resolveKnownConflict(db, admin, resolve)),
      invalid(409),
    );
    assert.equal(
      (
        await pool.query("SELECT text FROM provider_events WHERE id=$1", [
          initial.eventId,
        ])
      ).rows[0].text,
      "canonical",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM provider_event_variants WHERE event_id=$1",
          [initial.eventId],
        )
      ).rows[0].n,
      1,
    );
    const version = (
      await pool.query("SELECT gap_version::text FROM provider_state")
    ).rows[0].gap_version;
    const ack = {
      expectedGapVersion: version,
      expectedOwnerId: null,
      expectedOwnerEpoch: "0",
      evidenceRef: ref,
      confirmHistoryReviewed: true as const,
    };
    for (const role of ["agent", "supervisor"]) {
      const denied = (
        await pool.query(
          "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,'unused',$3) RETURNING id",
          [role, `${role}@ops.example.test`, role],
        )
      ).rows[0];
      await assert.rejects(
        tx((db) => acknowledgeProviderGap(db, denied, ack)),
        invalid(403),
      );
    }
    const foreign = (
      await pool.query(
        "INSERT INTO users(account_id,name,email,password_hash,role) VALUES($1,'Foreign','foreign@ops.example.test','unused','admin') RETURNING id",
        [randomUUID()],
      )
    ).rows[0];
    await assert.rejects(
      tx((db) => acknowledgeProviderGap(db, foreign, ack)),
      invalid(403),
    );
    for (const phase of ["reserved", "uncertain"]) {
      const ownerId = randomUUID();
      await pool.query("UPDATE connector_ownership SET phase=$1,owner_id=$2", [
        phase,
        ownerId,
      ]);
      await assert.rejects(
        tx((db) =>
          acknowledgeProviderGap(db, admin, {
            ...ack,
            expectedOwnerId: ownerId,
          }),
        ),
        invalid(409),
      );
    }
    await pool.query(
      "UPDATE connector_ownership SET phase='idle',owner_id=NULL",
    );
    await assert.rejects(
      tx((db) =>
        acknowledgeProviderGap(db, admin, { ...ack, expectedOwnerEpoch: "1" }),
      ),
      invalid(409),
    );
    await tx((db) => acknowledgeProviderGap(db, admin, ack));
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status,reconciliation_required FROM provider_state",
        )
      ).rows[0],
      { status: "disconnected", reconciliation_required: false },
    );
    await tx((db) => recordProviderFault(db, "connection-lost"));
    await assert.rejects(
      tx((db) => acknowledgeProviderGap(db, admin, ack)),
      invalid(409),
    );
    assert.equal(
      (await pool.query("SELECT reconciliation_required FROM provider_state"))
        .rows[0].reconciliation_required,
      true,
    );
    await ingestProviderEvent(pool, { ...e, text: "new variant" });
    const reopened = (
      await pool.query(
        "SELECT resolved_at,resolution_version FROM provider_events WHERE id=$1",
        [initial.eventId],
      )
    ).rows[0];
    assert.equal(reopened.resolved_at, null);
    await pool.query(
      "UPDATE provider_events SET variant_evidence_missing=true WHERE id=$1",
      [initial.eventId],
    );
    await assert.rejects(
      tx((db) =>
        resolveKnownConflict(db, admin, {
          ...resolve,
          expectedResolutionVersion: String(reopened.resolution_version),
        }),
      ),
      invalid(409),
    );
    await pool.query("UPDATE provider_state SET gap_version=$1", [
      MAX_GAP_VERSION,
    ]);
    await assert.rejects(
      tx((db) =>
        acknowledgeProviderGap(db, admin, {
          ...ack,
          expectedGapVersion: MAX_GAP_VERSION,
        }),
      ),
      invalid(400),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.gap_acknowledged'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await d.close();
  }
});

test("a concurrently queued fault defeats a stale gap acknowledgement without losing quarantine", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  const hold = await pool.connect(),
    fault = await pool.connect(),
    ack = await pool.connect();
  let faultWork: Promise<unknown> | undefined,
    ackWork: Promise<unknown> | undefined;
  try {
    const admin = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','race@ops.example.test','unused','admin') RETURNING id",
      )
    ).rows[0];
    await pool.query(
      "UPDATE provider_state SET reconciliation_required=true,gap_version=7",
    );
    await hold.query("BEGIN");
    await hold.query("SELECT account_id FROM provider_state FOR UPDATE");
    await fault.query("BEGIN");
    const pid = (await fault.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    faultWork = recordProviderFault(fault, "connection-lost").then(() =>
      fault.query("COMMIT"),
    );
    void faultWork.catch(() => {});
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (
          await pool.query(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
            [pid],
          )
        ).rows[0]?.wait_event_type === "Lock"
      ) {
        blocked = true;
        break;
      }
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(
      blocked,
      true,
      "fault UPDATE must be queued on the held provider row",
    );
    await ack.query("BEGIN");
    ackWork = acknowledgeProviderGap(ack, admin, {
      expectedGapVersion: "7",
      expectedOwnerId: null,
      expectedOwnerEpoch: "0",
      evidenceRef: ref,
      confirmHistoryReviewed: true,
    });
    void ackWork.catch(() => {});
    await hold.query("COMMIT");
    await faultWork;
    await assert.rejects(ackWork, invalid(409));
    await ack.query("ROLLBACK");
    assert.deepEqual(
      (
        await pool.query(
          "SELECT gap_version::text,reconciliation_required FROM provider_state",
        )
      ).rows[0],
      { gap_version: "8", reconciliation_required: true },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.gap_acknowledged'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await hold.query("ROLLBACK").catch(() => {});
    await Promise.allSettled([faultWork, ackWork].filter(Boolean));
    await fault.query("ROLLBACK").catch(() => {});
    await ack.query("ROLLBACK").catch(() => {});
    hold.release();
    fault.release();
    ack.release();
    await d.close();
  }
});

test("operations fail closed under worker contention and never expose raw database errors", async () => {
  const input = {
    messageId: randomUUID(),
    part: 0,
    eventId: randomUUID(),
    expectedResolutionVersion: "0",
    evidenceRef: ref,
    confirmProviderIdObserved: true as const,
  };
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return {
        rows: sql.includes("current_setting")
          ? [{ marker: "active" }]
          : sql.includes("FROM users")
            ? [{ id: actor.id, name: "Admin" }]
            : sql.includes("pg_try_advisory_xact_lock")
              ? [{ locked: false }]
              : [],
        rowCount: 1,
      };
    },
  } as any;
  await assert.rejects(confirmUnknownPart(db, actor, input), invalid(409));
  assert.equal(
    statements.some((s) => s.startsWith("UPDATE") || s.startsWith("INSERT")),
    false,
  );
  const failed = {
    async query() {
      throw new Error("SECRET database URL and password");
    },
  } as any;
  await assert.rejects(
    confirmUnknownPart(failed, actor, input),
    (e) =>
      e instanceof ConnectorOperationError &&
      e.statusCode === 409 &&
      !JSON.stringify(e).includes("SECRET") &&
      e.cause === undefined,
  );
});
