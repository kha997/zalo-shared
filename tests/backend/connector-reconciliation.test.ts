import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  reconcileUncertainOwnership,
  acknowledgeProviderGap,
  ConnectorOperationError,
} from "../../server/connector-operations.js";
import { ACCOUNT } from "../../server/db.js";
import { MAX_GAP_VERSION } from "../../server/provider-faults.js";
import { isolatedDatabase } from "./isolation.js";

const invalid = (status: number) => (e: unknown) =>
  e instanceof ConnectorOperationError && e.statusCode === status;

function input(ownerId: string, epoch = "1", gap = "1") {
  return {
    requestId: randomUUID(),
    expectedOwnerId: ownerId,
    expectedOwnerEpoch: epoch,
    expectedGapVersion: gap,
    evidenceRef: "g5a-owner-decision-2026-11-04",
    confirmOwnerApproved: true as const,
    localState: { sessionFile: "absent" as const, quarantine: "absent" as const },
  };
}

async function fenced(pool: any, epoch = "1", gap = "1") {
  const ownerId = randomUUID();
  await pool.query(
    `UPDATE connector_ownership SET phase='uncertain',owner_id=$1,owner_label='pilot-enrollment',
       epoch=$2,reserved_at=now(),heartbeat_at=now(),uncertain_at=now(),fault_code='shutdown'
     WHERE account_id=$3`,
    [ownerId, epoch, ACCOUNT],
  );
  await pool.query(
    "UPDATE provider_state SET status='disconnected',reconciliation_required=true,fault_code='shutdown',gap_version=$1 WHERE account_id=$2",
    [gap, ACCOUNT],
  );
  return ownerId;
}

async function tx<T>(pool: any, fn: (db: any) => Promise<T>): Promise<T> {
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

async function admin(pool: any) {
  return (
    await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES('Owner','reconcile-admin@example.test','unused','admin') RETURNING id,name",
    )
  ).rows[0];
}

async function state(pool: any) {
  return (
    await pool.query(
      `SELECT o.phase,o.owner_id,o.epoch::text,o.last_fenced_owner_id,o.last_fenced_epoch::text,
         s.reconciliation_required,s.status,s.gap_version::text,s.fault_code
       FROM connector_ownership o JOIN provider_state s ON s.account_id=o.account_id
       WHERE o.account_id=$1`,
      [ACCOUNT],
    )
  ).rows[0];
}

test("reconciliation rejects malformed input before any database access", async () => {
  let queries = 0;
  const db = {
    async query() {
      queries++;
      throw Error("secret database");
    },
  } as any;
  const ownerId = randomUUID();
  const good = input(ownerId);
  for (const bad of [
    null,
    { ...good, extra: true },
    { ...good, requestId: "not-a-uuid" },
    { ...good, expectedOwnerId: "not-a-uuid" },
    { ...good, expectedOwnerEpoch: MAX_GAP_VERSION },
    { ...good, expectedGapVersion: MAX_GAP_VERSION },
    { ...good, expectedOwnerEpoch: "01" },
    { ...good, evidenceRef: "https://secret.example.test" },
    { ...good, confirmOwnerApproved: false },
    { ...good, localState: { sessionFile: "present", quarantine: "absent" } },
    { ...good, localState: { sessionFile: "absent", quarantine: "present" } },
    { ...good, localState: { sessionFile: "absent", quarantine: "absent", extra: 1 } },
    { ...good, localState: null },
  ])
    await assert.rejects(
      reconcileUncertainOwnership(db, { id: randomUUID() }, bad as any),
      invalid(400),
    );
  assert.equal(queries, 0);
});

test("reconciliation requires an explicit transaction and a fresh administrator", async () => {
  const ownerId = randomUUID();
  const body = input(ownerId);
  let reads = 0;
  const blind = {
    async query(sql: string) {
      reads++;
      return {
        rows: sql.includes("current_setting") ? [{ marker: "" }] : [],
        rowCount: 0,
      };
    },
  } as any;
  await assert.rejects(
    reconcileUncertainOwnership(blind, { id: randomUUID() }, body),
    invalid(409),
  );
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
    reconcileUncertainOwnership(revoked, { id: randomUUID() }, body),
    invalid(403),
  );
});

test("reconciliation re-arms ownership and provider state in one transaction", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool);
    const conversation = (
      await pool.query(
        "INSERT INTO conversations(contact_id,contact_name) VALUES('reconcile-peer','Peer') RETURNING id",
      )
    ).rows[0].id;
    const sent = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status,provider_id) VALUES($1,'outbound','synthetic','sent','p-1') RETURNING id",
        [conversation],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'sent')",
      [sent],
    );
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part,status,provider_id) VALUES($1,0,'sent','p-1')",
      [sent],
    );

    const body = input(ownerId);
    assert.deepEqual(
      await tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
      { epoch: "2", gapVersion: "2", alreadyApplied: false },
    );
    const now = await state(pool);
    assert.equal(now.phase, "idle");
    assert.equal(now.owner_id, null);
    assert.equal(now.epoch, "2");
    assert.equal(now.reconciliation_required, false);
    assert.equal(now.status, "disconnected");
    assert.equal(now.gap_version, "2");
    assert.equal(now.fault_code, null);
    assert.equal(now.last_fenced_owner_id, ownerId);
    assert.equal(now.last_fenced_epoch, "1");

    const rows = (
      await pool.query(
        "SELECT actor_id,actor_name,target_id,metadata FROM audit WHERE action='connector.reconciled'",
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, staff.id);
    assert.equal(rows[0].actor_name, "Owner");
    assert.equal(rows[0].target_id, ownerId);
    assert.deepEqual(rows[0].metadata, {
      requestId: body.requestId,
      evidenceRef: body.evidenceRef,
      ownerId,
      epochBefore: "1",
      epochAfter: "2",
      gapVersionBefore: "1",
      gapVersionAfter: "2",
      faultCode: "shutdown",
      providerFault: "shutdown",
      localSessionFile: "absent",
      localQuarantine: "absent",
    });
    assert.equal(
      (await pool.query("SELECT status FROM outbox WHERE message_id=$1", [sent]))
        .rows[0].status,
      "sent",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM messages WHERE id=$1",
          [sent],
        )
      ).rows[0].status,
      "sent",
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM provider_ledger")).rows[0]
        .n,
      0,
    );

    // The gap acknowledgement path now refuses to invent a second recovery.
    await assert.rejects(
      tx(pool, (db) =>
        acknowledgeProviderGap(db, staff, {
          expectedGapVersion: "2",
          expectedOwnerId: null,
          expectedOwnerEpoch: "2",
          evidenceRef: "g5a-owner-decision-2026-11-04",
          confirmHistoryReviewed: true,
        }),
      ),
      invalid(409),
    );
  } finally {
    await d.close();
  }
});

test("a replayed request returns the original result without a second write", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool);
    const body = input(ownerId);
    const first = await tx(pool, (db) =>
      reconcileUncertainOwnership(db, staff, body),
    );
    const replay = await tx(pool, (db) =>
      reconcileUncertainOwnership(db, staff, body),
    );
    assert.deepEqual(replay, { ...first, alreadyApplied: true });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.reconciled'",
        )
      ).rows[0].n,
      1,
    );
    // Same request id, different claim: never a silent success.
    await assert.rejects(
      tx(pool, (db) =>
        reconcileUncertainOwnership(db, staff, {
          ...body,
          evidenceRef: "different-evidence",
        }),
      ),
      invalid(409),
    );
    // A new request against an already recovered state is a mismatch.
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, input(ownerId))),
      invalid(409),
    );
    // The request id cannot be replayed against a different incident.
    const other = await fenced(pool, "2", "2");
    await assert.rejects(
      tx(pool, (db) =>
        reconcileUncertainOwnership(db, staff, {
          ...body,
          expectedOwnerId: other,
          expectedOwnerEpoch: "2",
          expectedGapVersion: "2",
        }),
      ),
      invalid(409),
    );
    assert.equal((await state(pool)).phase, "uncertain");
  } finally {
    await d.close();
  }
});

test("epoch, owner, gap, phase and provider-status mismatches all fail closed", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool);
    for (const bad of [
      input(randomUUID()),
      input(ownerId, "2", "1"),
      input(ownerId, "1", "2"),
      input(ownerId, "0", "1"),
    ])
      await assert.rejects(
        tx(pool, (db) => reconcileUncertainOwnership(db, staff, bad)),
        invalid(409),
      );
    await pool.query(
      "UPDATE connector_ownership SET phase='active',uncertain_at=NULL WHERE account_id=$1",
      [ACCOUNT],
    );
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, input(ownerId))),
      invalid(409),
    );
    await pool.query(
      "UPDATE connector_ownership SET phase='uncertain',owner_id=$1,uncertain_at=now() WHERE account_id=$2",
      [ownerId, ACCOUNT],
    );
    await pool.query(
      "UPDATE provider_state SET reconciliation_required=false WHERE account_id=$1",
      [ACCOUNT],
    );
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, input(ownerId))),
      invalid(409),
    );
    await pool.query(
      "UPDATE provider_state SET reconciliation_required=true,status='connected' WHERE account_id=$1",
      [ACCOUNT],
    );
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, input(ownerId))),
      invalid(409),
    );
    const now = await state(pool);
    assert.equal(now.phase, "uncertain");
    assert.equal(now.epoch, "1");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.reconciled'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await d.close();
  }
});

test("unresolved provider, media, outbox and part work blocks recovery", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool);
    const body = input(ownerId);
    const conversation = (
      await pool.query(
        "INSERT INTO conversations(contact_id,contact_name,provider_thread_type,provider_thread_id) VALUES('block-peer','Peer',0,'block-peer') RETURNING id",
      )
    ).rows[0].id;
    const held = (
      await pool.query(
        `INSERT INTO provider_events(account_id,conversation_id,thread_type,thread_id,direction,provider_id,sender_id,kind,text,semantic_hash,state)
         VALUES($1,$2,0,'block-peer','inbound','e-1','peer','text','synthetic',$3,'held') RETURNING id`,
        [ACCOUNT, conversation, "a".repeat(64)],
      )
    ).rows[0].id;
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
      invalid(409),
    );

    await pool.query("UPDATE provider_events SET state='linked' WHERE id=$1", [
      held,
    ]);
    const media = (
      await pool.query(
        `INSERT INTO provider_media_jobs(account_id,event_id,item_index,category,name,locator_fingerprint,status)
         VALUES($1,$2,0,'photo','synthetic',$3,'held') RETURNING id`,
        [ACCOUNT, held, "b".repeat(64)],
      )
    ).rows[0].id;
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
      invalid(409),
    );

    await pool.query("DELETE FROM provider_media_jobs WHERE id=$1", [media]);
    const message = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic','pending') RETURNING id",
        [conversation],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'pending')",
      [message],
    );
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
      invalid(409),
    );

    await pool.query("UPDATE messages SET status='sent' WHERE id=$1", [message]);
    await pool.query("UPDATE outbox SET status='sent' WHERE message_id=$1", [
      message,
    ]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,0,'unknown')",
      [message],
    );
    await assert.rejects(
      tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
      invalid(409),
    );

    await pool.query(
      "UPDATE delivery_parts SET status='sent' WHERE message_id=$1",
      [message],
    );
    assert.equal(
      (await tx(pool, (db) => reconcileUncertainOwnership(db, staff, body))).epoch,
      "2",
    );
  } finally {
    await d.close();
  }
});

test("a live connector or worker lock prevents recovery", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool);
    const body = input(ownerId);
    const holder = await pool.connect();
    try {
      assert.equal(
        (await holder.query("SELECT pg_try_advisory_lock(73002,1) AS locked"))
          .rows[0].locked,
        true,
      );
      await assert.rejects(
        tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
        invalid(409),
      );
      await holder.query("SELECT pg_advisory_unlock(73002,1)");
      assert.equal(
        (await holder.query("SELECT pg_try_advisory_lock(73001) AS locked"))
          .rows[0].locked,
        true,
      );
      await assert.rejects(
        tx(pool, (db) => reconcileUncertainOwnership(db, staff, body)),
        invalid(409),
      );
      await holder.query("SELECT pg_advisory_unlock(73001)");
    } finally {
      await holder.query("SELECT pg_advisory_unlock_all()").catch(() => {});
      holder.release();
    }
    assert.equal((await state(pool)).phase, "uncertain");
    assert.equal(
      (await tx(pool, (db) => reconcileUncertainOwnership(db, staff, body))).epoch,
      "2",
    );
  } finally {
    await d.close();
  }
});

test("recovery refuses to run at the terminal version", async () => {
  const d = await isolatedDatabase();
  const { pool } = d;
  try {
    const staff = await admin(pool);
    const ownerId = await fenced(pool, "1", MAX_GAP_VERSION);
    await assert.rejects(
      tx(pool, (db) =>
        reconcileUncertainOwnership(db, staff, input(ownerId, "1", MAX_GAP_VERSION)),
      ),
      invalid(400),
    );
    await assert.rejects(
      tx(pool, (db) =>
        reconcileUncertainOwnership(
          db,
          staff,
          input(ownerId, "1", (BigInt(MAX_GAP_VERSION) - 1n).toString()),
        ),
      ),
      invalid(409),
    );
    const now = await state(pool);
    assert.equal(now.phase, "uncertain");
    assert.equal(now.gap_version, MAX_GAP_VERSION);
  } finally {
    await d.close();
  }
});