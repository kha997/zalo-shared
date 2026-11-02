/** Disposable CI fixture only. Run after load/browser workers have stopped. */
import { ACCOUNT, createPool } from "../server/db.js";
import { resolveKnownConflict } from "../server/connector-operations.js";
import {
  ingestProviderEvent,
  recordPartAccepted,
} from "../server/provider-store.js";
if (
  process.env.CI_PROVIDER_JOURNAL_DISPOSABLE !== "yes" ||
  process.env.PROVIDER_MODE !== "mock"
)
  throw new Error("Requires explicit disposable CI database and mock provider");
const url = process.env.DATABASE_URL;
if (!url || !/^zalo_test$/.test(new URL(url).pathname.slice(1)))
  throw new Error("Requires disposable zalo_test database");
const pool = createPool(url);
const base = {
  threadType: 0 as const,
  threadId: "ci-synthetic-journal",
  senderId: "ci-synthetic-sender",
  kind: "text" as const,
  text: "synthetic journal fixture",
  isSelf: false,
  providerId: "ci-linked",
};
try {
  const initial = await ingestProviderEvent(pool, base);
  const c = await pool.connect();
  let mid: string;
  try {
    await c.query("BEGIN");
    const cid = (
      await c.query("SELECT conversation_id FROM messages WHERE id=$1", [
        initial.messageId,
      ])
    ).rows[0].conversation_id;
    await c.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [cid]);
    const actor = (await c.query("SELECT id FROM users ORDER BY id LIMIT 1"))
      .rows[0]?.id;
    if (!actor) throw new Error("CI users must be seeded first");
    mid = (
      await c.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status) VALUES($1,'outbound','synthetic staff fixture',$2,'unknown') RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await c.query("INSERT INTO delivery_parts(message_id,part) VALUES($1,0)", [
      mid,
    ]);
    await recordPartAccepted(c, mid, 0, "ci-staff-echo");
    const attachment = (
      await c.query(
        "INSERT INTO attachments(owner_id,name,mime,data,message_id) VALUES($1,'ci-bound.txt','text/plain',$2,$3) RETURNING id",
        [actor, Buffer.from("synthetic bound media recovery fixture"), mid],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,1,$2)",
      [mid, attachment],
    );
    await recordPartAccepted(c, mid, 1, "ci-bound-media");
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  await ingestProviderEvent(pool, {
    ...base,
    isSelf: true,
    providerId: "ci-staff-echo",
  });
  await ingestProviderEvent(pool, {
    ...base,
    isSelf: true,
    providerId: "ci-held",
  });
  await ingestProviderEvent(pool, { ...base, providerId: "ci-conflict" });
  await ingestProviderEvent(pool, {
    ...base,
    providerId: "ci-conflict",
    text: "synthetic conflicting fixture",
  });
  await ingestProviderEvent(pool, {
    ...base,
    providerId: "ci-conflict",
    text: "synthetic second conflicting fixture",
  });
  const review = await pool.connect();
  try {
    await review.query("BEGIN");
    const actor = (
      await review.query(
        "SELECT id FROM users WHERE role='admin' AND active AND account_id=$1 ORDER BY id LIMIT 1",
        [ACCOUNT],
      )
    ).rows[0];
    const event = (
      await review.query(
        "SELECT id,resolution_version FROM provider_events WHERE thread_id=$1 AND provider_id='ci-conflict' AND account_id=$2 AND direction='inbound'",
        [base.threadId, ACCOUNT],
      )
    ).rows[0];
    const hashes = (
      await review.query(
        "SELECT semantic_hash FROM provider_event_variants WHERE event_id=$1 ORDER BY semantic_hash",
        [event.id],
      )
    ).rows.map((r) => r.semantic_hash);
    await resolveKnownConflict(review, actor, {
      eventId: event.id,
      expectedResolutionVersion: event.resolution_version,
      expectedVariantHashes: hashes,
      decision: "retain-canonical",
      evidenceRef: "ci-synthetic-external-review",
      confirmExternalReview: true,
    });
    await review.query("COMMIT");
  } catch (error) {
    await review.query("ROLLBACK");
    throw error;
  } finally {
    review.release();
  }
  await ingestProviderEvent(pool, { ...base, providerId: "ci-unresolved" });
  await ingestProviderEvent(pool, {
    ...base,
    providerId: "ci-unresolved",
    text: "synthetic unresolved variant",
  });
  await pool.query(
    "INSERT INTO pilot_send_budget(account_id,day,max_parts,reserved_parts,last_reserved_at) VALUES($1,(now() AT TIME ZONE 'utc')::date,5,1,now()) ON CONFLICT DO NOTHING",
    [ACCOUNT],
  );
  await pool.query(
    "INSERT INTO pilot_part_ledger(account_id,day,message_id,part,grant_id,peer_id) VALUES($1,(now() AT TIME ZONE 'utc')::date,$2,0,'ci-grant','ci-synthetic-peer') ON CONFLICT DO NOTHING",
    [ACCOUNT, mid],
  );
  // Never-attempted outbound work: the backup runs with the app and worker
  // stopped, so restore must leave this pending rather than strand it as an
  // unknown row with no provider event to confirm.
  const pendingMid = (
    await pool.query(
      `WITH m AS (
         INSERT INTO messages(conversation_id,direction,text,status)
         SELECT conversation_id,'outbound','synthetic never-attempted pending fixture','pending'
           FROM messages WHERE id=$1 RETURNING id
       )
       INSERT INTO outbox(message_id,status) SELECT id,'pending' FROM m RETURNING message_id`,
      [mid],
    )
  ).rows[0].message_id;
  await pool.query(
    "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
    [pendingMid],
  );
  // Nonempty inbound media jobs: ready bytes, claimable pending/processing,
  // held, and expired metadata. Synthetic ciphertext only; no real locator.
  const linked = (
    await pool.query(
      "SELECT id,message_id FROM provider_events WHERE provider_id='ci-linked' AND account_id=$1 AND state='linked'",
      [ACCOUNT],
    )
  ).rows[0];
  if (!linked?.message_id) throw new Error("Linked fixture message missing");
  const inboundAttachment = (
    await pool.query(
      "INSERT INTO attachments(account_id,owner_id,name,mime,data,message_id) VALUES($1,NULL,'ci-inbound-ready.png','image/png',$2,$3) RETURNING id",
      [
        ACCOUNT,
        Buffer.from("synthetic inbound ready media fixture"),
        linked.message_id,
      ],
    )
  ).rows[0].id;
  const envelope = JSON.stringify({
    keyId: "ci-synthetic-locator",
    nonce: "AAAAAAAAAAAAAAAA",
    ciphertext: "c3ludGhldGlj",
    tag: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  });
  await pool.query(
    `INSERT INTO provider_media_jobs(account_id,event_id,item_index,category,name,locator_fingerprint,locator_envelope,status,message_id,attachment_id,attempts,created_at)
     VALUES
      ($1,$2,0,'photo','ci-inbound-ready.png',$3,NULL,'ready',$4,$5,1,now()),
      ($1,$2,1,'file','ci-inbound-pending.txt',$6,$7,'pending',$4,NULL,0,now()),
      ($1,$2,2,'file','ci-inbound-processing.txt',$6,$7,'processing',$4,NULL,1,now()-interval '1 minute'),
      ($1,$2,3,'file','ci-inbound-held.txt',$6,$7,'held',$4,NULL,0,now()-interval '2 hours'),
      ($1,$2,4,'file','ci-inbound-expired.txt',$6,NULL,'unavailable',$4,NULL,3,now()-interval '30 hours')`,
    [
      ACCOUNT,
      linked.id,
      "a".repeat(64),
      linked.message_id,
      inboundAttachment,
      "b".repeat(64),
      envelope,
    ],
  );
  const states = (
    await pool.query(
      "SELECT DISTINCT state FROM provider_events WHERE thread_id=$1",
      [base.threadId],
    )
  ).rows.map((r) => r.state);
  if (!["linked", "held", "conflict"].every((s) => states.includes(s)))
    throw new Error("Journal fixture incomplete");
  const owner = await pool.query(
    "UPDATE connector_ownership SET phase='uncertain',epoch=17,owner_id=gen_random_uuid(),owner_label='ci-synthetic-owner',reserved_at=now(),uncertain_at=now(),fault_code='shutdown' WHERE account_id=$1 AND phase='idle' RETURNING account_id",
    [ACCOUNT],
  );
  if (owner.rowCount !== 1)
    throw new Error("Pristine ownership fixture required");
  // A second synthetic row exercises restoration of a previously idle identity.
  // This is recovery coverage, not application multi-account support.
  await pool.query(
    "INSERT INTO connector_ownership(account_id) VALUES('00000000-0000-4000-8000-000000000002')",
  );
  await pool.query(
    "INSERT INTO provider_state(account_id,status,reconciliation_required,gap_version,fault_code) VALUES('00000000-0000-4000-8000-000000000002','disconnected',true,9223372036854775807,'version-exhausted')",
  );
  console.log("Synthetic linked/held/conflict journal fixtures persisted");
} finally {
  await pool.end();
}
