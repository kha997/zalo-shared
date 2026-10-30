import type pg from "pg";
import { ACCOUNT, audit } from "./db.js";
import { MAX_GAP_VERSION } from "./provider-faults.js";
import { recordPartAccepted, reconcileSelfEvents } from "./provider-store.js";

export type OperationActor = { id: string };
export class ConnectorOperationError extends Error {
  constructor(readonly statusCode: 400 | 403 | 409) {
    super(
      statusCode === 400
        ? "Invalid connector operation"
        : statusCode === 403
          ? "Administrator required"
          : "Connector operation state changed or is blocked",
    );
    this.name = "ConnectorOperationError";
  }
}
const fail = (status: 400 | 403 | 409): never => {
  throw new ConnectorOperationError(status);
};
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const version = (x: unknown): x is string =>
  typeof x === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(x) &&
  BigInt(x) < BigInt(MAX_GAP_VERSION);
const evidence = (x: unknown): x is string =>
  typeof x === "string" &&
  x.length <= 256 &&
  /^[A-Za-z0-9][A-Za-z0-9_. /#-]*$/.test(x);
function shape(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(value, k))
  )
    fail(400);
}
async function protect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ConnectorOperationError) throw e;
    throw new ConnectorOperationError(409);
  }
}
async function authorize(db: pg.PoolClient, actor: OperationActor) {
  if (!uuid(actor?.id)) fail(400);
  await db.query(
    "SELECT set_config('zalo.operation_transaction','active',true)",
  );
  if (
    (
      await db.query(
        "SELECT current_setting('zalo.operation_transaction',true) AS marker",
      )
    ).rows[0]?.marker !== "active"
  )
    fail(409);
  await db.query("SELECT pg_advisory_xact_lock_shared(72001)");
  const staff = (
    await db.query(
      "SELECT id,name FROM users WHERE id=$1 AND account_id=$2 AND active AND role='admin' FOR SHARE",
      [actor.id, ACCOUNT],
    )
  ).rows[0];
  if (!staff) fail(403);
  return staff;
}
async function workerLock(db: pg.PoolClient) {
  if (
    !(await db.query("SELECT pg_try_advisory_xact_lock(73001) AS locked"))
      .rows[0]?.locked
  )
    fail(409);
}

export async function confirmUnknownPart(
  db: pg.PoolClient,
  actor: OperationActor,
  input: {
    messageId: string;
    part: number;
    eventId: string;
    expectedResolutionVersion: string;
    evidenceRef: string;
    confirmProviderIdObserved: true;
  },
): Promise<{ messageStatus: "unknown" | "sent" }> {
  return protect(async () => {
    shape(input, [
      "messageId",
      "part",
      "eventId",
      "expectedResolutionVersion",
      "evidenceRef",
      "confirmProviderIdObserved",
    ]);
    if (
      !uuid(actor?.id) ||
      !uuid(input.messageId) ||
      !uuid(input.eventId) ||
      !Number.isSafeInteger(input.part) ||
      input.part < 0 ||
      input.part > 5 ||
      !version(input.expectedResolutionVersion) ||
      !evidence(input.evidenceRef) ||
      input.confirmProviderIdObserved !== true
    )
      fail(400);
    const staff = await authorize(db, actor);
    await workerLock(db);
    const job = (
      await db.query(
        "SELECT o.id,o.status,m.status message_status,m.conversation_id FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.direction='outbound' AND c.account_id=$2 FOR UPDATE OF o",
        [input.messageId, ACCOUNT],
      )
    ).rows[0];
    if (!job || job.status !== "unknown" || job.message_status !== "unknown")
      fail(409);
    const conversation = (
      await db.query(
        "SELECT id,provider_thread_type,provider_thread_id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [job.conversation_id, ACCOUNT],
      )
    ).rows[0];
    if (!conversation) fail(409);
    const part = (
      await db.query(
        "SELECT status,provider_id FROM delivery_parts WHERE message_id=$1 AND part=$2 FOR UPDATE",
        [input.messageId, input.part],
      )
    ).rows[0];
    const event = (
      await db.query(
        "SELECT * FROM provider_events WHERE id=$1 AND account_id=$2 AND conversation_id=$3 FOR UPDATE",
        [input.eventId, ACCOUNT, conversation.id],
      )
    ).rows[0];
    if (
      !part ||
      part.status !== "unknown" ||
      part.provider_id !== null ||
      !event ||
      event.state !== "held" ||
      event.direction !== "outbound" ||
      event.conflict ||
      event.variant_overflow ||
      event.variant_evidence_missing ||
      event.message_id !== null ||
      String(event.resolution_version) !== input.expectedResolutionVersion ||
      event.thread_type !== conversation.provider_thread_type ||
      event.thread_id !== conversation.provider_thread_id
    )
      fail(409);
    // The ID is read from the scoped durable receipt, never supplied by text/time inference.
    await recordPartAccepted(
      db,
      input.messageId,
      input.part,
      event.provider_id,
    );
    const changed = await db.query(
      "UPDATE provider_events SET resolution_version=resolution_version+1,resolved_at=now(),resolved_by=$2,resolution_ref=$3 WHERE id=$1 AND resolution_version=$4",
      [event.id, staff.id, input.evidenceRef, input.expectedResolutionVersion],
    );
    if (changed.rowCount !== 1) fail(409);
    const remaining = (
      await db.query(
        "SELECT count(*)::int n FROM delivery_parts WHERE message_id=$1 AND status NOT IN ('sent','skipped')",
        [input.messageId],
      )
    ).rows[0].n;
    let messageStatus: "unknown" | "sent" = "unknown";
    if (remaining === 0) {
      await db.query(
        "UPDATE messages SET status='sent',provider_id=(SELECT provider_id FROM delivery_parts WHERE message_id=$1 AND status='sent' AND provider_id IS NOT NULL ORDER BY part LIMIT 1) WHERE id=$1",
        [input.messageId],
      );
      await db.query("UPDATE outbox SET status='sent' WHERE message_id=$1", [
        input.messageId,
      ]);
      await reconcileSelfEvents(db, conversation.id);
      messageStatus = "sent";
    }
    await audit(db, staff, "connector.part_confirmed", input.messageId, {
      part: input.part,
      eventId: event.id,
      providerId: event.provider_id,
      threadType: event.thread_type,
      threadId: event.thread_id,
      evidenceRef: input.evidenceRef,
    });
    return { messageStatus };
  });
}

export async function resolveKnownConflict(
  db: pg.PoolClient,
  actor: OperationActor,
  input: {
    eventId: string;
    expectedResolutionVersion: string;
    expectedVariantHashes: string[];
    decision: "retain-canonical";
    evidenceRef: string;
    confirmExternalReview: true;
  },
): Promise<void> {
  return protect(async () => {
    shape(input, [
      "eventId",
      "expectedResolutionVersion",
      "expectedVariantHashes",
      "decision",
      "evidenceRef",
      "confirmExternalReview",
    ]);
    if (
      !uuid(actor?.id) ||
      !uuid(input.eventId) ||
      !version(input.expectedResolutionVersion) ||
      !Array.isArray(input.expectedVariantHashes) ||
      input.expectedVariantHashes.length < 1 ||
      input.expectedVariantHashes.length > 8 ||
      input.expectedVariantHashes.some(
        (h) => typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h),
      ) ||
      new Set(input.expectedVariantHashes).size !==
        input.expectedVariantHashes.length ||
      input.decision !== "retain-canonical" ||
      !evidence(input.evidenceRef) ||
      input.confirmExternalReview !== true
    )
      fail(400);
    const staff = await authorize(db, actor);
    const located = (
      await db.query(
        "SELECT conversation_id FROM provider_events WHERE id=$1 AND account_id=$2",
        [input.eventId, ACCOUNT],
      )
    ).rows[0];
    if (
      !located ||
      !(
        await db.query(
          "SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [located.conversation_id, ACCOUNT],
        )
      ).rowCount
    )
      fail(409);
    const event = (
      await db.query(
        "SELECT * FROM provider_events WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [input.eventId, ACCOUNT],
      )
    ).rows[0];
    if (
      !event ||
      !event.conflict ||
      event.state !== "conflict" ||
      event.resolved_at ||
      event.variant_overflow ||
      event.variant_evidence_missing ||
      String(event.resolution_version) !== input.expectedResolutionVersion ||
      BigInt(event.resolution_version) >= BigInt(MAX_GAP_VERSION) - 1n
    )
      fail(409);
    const hashes = (
      await db.query(
        "SELECT semantic_hash FROM provider_event_variants WHERE event_id=$1 ORDER BY semantic_hash",
        [event.id],
      )
    ).rows.map((r) => r.semantic_hash);
    const expected = [...input.expectedVariantHashes].sort();
    if (
      hashes.length !== expected.length ||
      hashes.some((h, i) => h !== expected[i])
    )
      fail(409);
    const result = await db.query(
      "UPDATE provider_events SET resolved_at=now(),resolved_by=$2,resolution_ref=$3,resolution_version=resolution_version+1 WHERE id=$1 AND resolution_version=$4 AND resolved_at IS NULL",
      [event.id, staff.id, input.evidenceRef, input.expectedResolutionVersion],
    );
    if (result.rowCount !== 1) fail(409);
    await audit(db, staff, "connector.conflict_resolved", event.id, {
      decision: input.decision,
      semanticHash: event.semantic_hash,
      variantHashes: hashes,
      previousResolutionVersion: input.expectedResolutionVersion,
      evidenceRef: input.evidenceRef,
    });
  });
}

export async function acknowledgeProviderGap(
  db: pg.PoolClient,
  actor: OperationActor,
  input: {
    expectedGapVersion: string;
    expectedOwnerId: string | null;
    expectedOwnerEpoch: string;
    evidenceRef: string;
    confirmHistoryReviewed: true;
  },
): Promise<void> {
  return protect(async () => {
    shape(input, [
      "expectedGapVersion",
      "expectedOwnerId",
      "expectedOwnerEpoch",
      "evidenceRef",
      "confirmHistoryReviewed",
    ]);
    if (
      !uuid(actor?.id) ||
      !version(input.expectedGapVersion) ||
      !(
        typeof input.expectedOwnerEpoch === "string" &&
        /^(0|[1-9][0-9]{0,18})$/.test(input.expectedOwnerEpoch) &&
        BigInt(input.expectedOwnerEpoch) <= BigInt(MAX_GAP_VERSION)
      ) ||
      (input.expectedOwnerId !== null && !uuid(input.expectedOwnerId)) ||
      !evidence(input.evidenceRef) ||
      input.confirmHistoryReviewed !== true
    )
      fail(400);
    const staff = await authorize(db, actor);
    await workerLock(db);
    const owner = (
      await db.query(
        "SELECT phase,owner_id,epoch::text FROM connector_ownership WHERE account_id=$1 FOR UPDATE",
        [ACCOUNT],
      )
    ).rows[0];
    if (
      !owner ||
      !["idle", "active"].includes(owner.phase) ||
      owner.owner_id !== input.expectedOwnerId ||
      owner.epoch !== input.expectedOwnerEpoch
    )
      fail(409);
    const state = (
      await db.query(
        "SELECT gap_version::text,reconciliation_required FROM provider_state WHERE account_id=$1 FOR UPDATE",
        [ACCOUNT],
      )
    ).rows[0];
    if (
      !state ||
      state.gap_version !== input.expectedGapVersion ||
      !state.reconciliation_required ||
      state.gap_version === MAX_GAP_VERSION
    )
      fail(409);
    const unresolved = await db.query(
      `SELECT 1 FROM provider_events WHERE account_id=$1 AND (state='held' OR variant_overflow OR variant_evidence_missing OR (conflict AND resolved_at IS NULL)) LIMIT 1`,
      [ACCOUNT],
    );
    const uncertain = await db.query(
      "SELECT 1 FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND (o.status IN ('unknown','processing') OR m.status IN ('unknown','processing')) LIMIT 1",
      [ACCOUNT],
    );
    if (unresolved.rowCount || uncertain.rowCount) fail(409);
    const result = await db.query(
      "UPDATE provider_state SET reconciliation_required=false,fault_code=NULL,status='disconnected' WHERE account_id=$1 AND gap_version=$2 AND reconciliation_required",
      [ACCOUNT, input.expectedGapVersion],
    );
    if (result.rowCount !== 1) fail(409);
    await audit(db, staff, "connector.gap_acknowledged", ACCOUNT, {
      gapVersion: input.expectedGapVersion,
      ownerId: input.expectedOwnerId,
      ownerEpoch: input.expectedOwnerEpoch,
      evidenceRef: input.evidenceRef,
    });
  });
}
