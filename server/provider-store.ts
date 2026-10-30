import type pg from "pg";
import type { OwnerToken } from "./connector-ownership.js";
import {
  prepareEventMedia,
  enqueueEventMedia,
  linkEventMedia,
  type MediaCandidate,
} from "./media-jobs.js";
import type { LocatorCipher } from "./locator-cipher.js";
import { createHash, randomUUID } from "node:crypto";
import { ACCOUNT, audit } from "./db.js";
import { recordProviderFault, MAX_GAP_VERSION } from "./provider-faults.js";
export interface ProviderEvent {
  threadType: 0 | 1;
  threadId: string;
  providerId: string;
  senderId: string;
  isSelf: boolean;
  kind: "text" | "unsupported";
  text?: string;
  clientId?: string;
  providerTimestamp?: string;
  /** Private receipt payload, enabled only with an explicitly injected locator cipher. */
  media?: ReadonlyArray<MediaCandidate>;
}
function validate(e: ProviderEvent) {
  const bounded = (s: unknown, n: number, required = false) =>
    typeof s === "string" &&
    s.length <= n &&
    (!required || s.length > 0) &&
    !s.includes("\0");
  if (
    !e ||
    ![0, 1].includes(e.threadType) ||
    typeof e.isSelf !== "boolean" ||
    !["text", "unsupported"].includes(e.kind) ||
    ![e.threadId, e.providerId, e.senderId].every((s) =>
      bounded(s, 200, true),
    ) ||
    (e.kind === "text" && !bounded(e.text, 10000)) ||
    (e.text !== undefined && !bounded(e.text, 10000)) ||
    (e.clientId !== undefined && !bounded(e.clientId, 200)) ||
    (e.providerTimestamp !== undefined && !bounded(e.providerTimestamp, 64)) ||
    Buffer.byteLength(JSON.stringify(e)) > 65536
  )
    throw new Error("Invalid provider event");
}
async function requireTransaction(db: pg.PoolClient) {
  // A transaction-local marker survives a statement only inside an explicit transaction.
  await db.query(
    "SELECT set_config('zalo.provider_transaction','active',true)",
  );
  if (
    (
      await db.query(
        "SELECT current_setting('zalo.provider_transaction',true) AS marker",
      )
    ).rows[0].marker !== "active"
  )
    throw new Error("Existing transaction required");
}
async function lockConversation(db: pg.PoolClient, id: string) {
  if (
    !(
      await db.query(
        "SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [id, ACCOUNT],
      )
    ).rowCount
  )
    throw new Error("Unknown conversation");
}
async function project(db: pg.PoolClient, e: any) {
  let mid: string | null = null;
  if (e.direction === "outbound") {
    const matches = await db.query(
      "SELECT DISTINCT m.id FROM delivery_parts p JOIN messages m ON m.id=p.message_id WHERE m.conversation_id=$1 AND m.direction='outbound' AND p.status='sent' AND p.provider_id=$2",
      [e.conversation_id, e.provider_id],
    );
    if (matches.rowCount! > 1) throw new Error("Conflicting provider mapping");
    mid = matches.rows[0]?.id ?? null;
    if (
      !mid &&
      (
        await db.query(
          "SELECT 1 FROM outbox o JOIN messages m ON m.id=o.message_id WHERE m.conversation_id=$1 AND o.status IN ('processing','unknown') LIMIT 1",
          [e.conversation_id],
        )
      ).rowCount
    )
      return;
  }
  if (!mid) {
    mid = (
      await db.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status,provider_id) VALUES($1,$2,$3,NULL,$5,$4) RETURNING id",
        [
          e.conversation_id,
          e.direction,
          e.kind === "text" ? e.text : "[Unsupported Zalo message]",
          e.provider_id,
          e.direction === "inbound" ? "received" : "sent",
        ],
      )
    ).rows[0].id;
    await audit(db, null, "provider.message_received", mid, { eventId: e.id });
    await db.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [
      e.conversation_id,
    ]);
  }
  await db.query(
    "UPDATE provider_events SET state='linked',message_id=$2 WHERE id=$1",
    [e.id, mid],
  );
  if (e.media_descriptor?.length) await linkEventMedia(db, e.id);
}
export async function ingestProviderEvent(
  pool: pg.Pool,
  event: ProviderEvent,
  context?: {
    owner?: OwnerToken;
    mediaCipher?: LocatorCipher;
    maxPendingMedia?: number;
  },
): Promise<{
  eventId: string;
  messageId: string | null;
  duplicate: boolean;
  held: boolean;
  conflict: boolean;
}> {
  validate(event);
  const media =
    event.media === undefined
      ? undefined
      : prepareEventMedia(event.media, context?.mediaCipher);
  if (
    media &&
    (event.kind !== "unsupported" ||
      (context?.maxPendingMedia !== undefined &&
        (!Number.isInteger(context.maxPendingMedia) ||
          context.maxPendingMedia < 1 ||
          context.maxPendingMedia > 10000)))
  )
    throw new Error("Private media receipt unavailable");
  const hasOwner =
    context !== undefined &&
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    Object.hasOwn(context, "owner");
  if (
    context !== undefined &&
    (!context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      (!hasOwner && !media))
  )
    throw new Error("Connector ownership unavailable");
  if (hasOwner) {
    const owner = context!.owner;
    if (
      !owner ||
      owner.accountId !== ACCOUNT ||
      typeof owner.ownerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        owner.ownerId,
      ) ||
      typeof owner.epoch !== "string" ||
      !/^(0|[1-9][0-9]{0,18})$/.test(owner.epoch) ||
      BigInt(owner.epoch) > 9223372036854775807n
    )
      throw new Error("Connector ownership unavailable");
  }
  const semantic = createHash("sha256")
    .update(
      JSON.stringify([
        event.senderId,
        event.kind,
        event.kind === "text" ? event.text : null,
        event.clientId ?? null,
        event.providerTimestamp ?? null,
        ...(media ? [media.descriptors] : []),
      ]),
    )
    .digest("hex");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (hasOwner) {
      const owner = context!.owner;
      if (
        !owner ||
        owner.accountId !== ACCOUNT ||
        !(
          await db.query(
            "SELECT account_id FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active') FOR SHARE",
            [ACCOUNT, owner.ownerId, owner.epoch],
          )
        ).rowCount
      )
        throw new Error("Connector ownership unavailable");
    }
    const cid = (
      await db.query(
        `INSERT INTO conversations(account_id,contact_id,contact_name,provider_thread_type,provider_thread_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,contact_id) DO UPDATE SET provider_thread_type=EXCLUDED.provider_thread_type,provider_thread_id=EXCLUDED.provider_thread_id RETURNING id`,
        [
          ACCOUNT,
          `zalo:${event.threadType}:${event.threadId}`,
          `Zalo ${event.threadId}`,
          event.threadType,
          event.threadId,
        ],
      )
    ).rows[0].id;
    await lockConversation(db, cid);
    const inserted = await db.query(
      `INSERT INTO provider_events(account_id,conversation_id,thread_type,thread_id,direction,provider_id,sender_id,client_id,provider_timestamp,kind,text,semantic_hash,state,id,media_descriptor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held',$13,$14) ON CONFLICT DO NOTHING RETURNING *`,
      [
        ACCOUNT,
        cid,
        event.threadType,
        event.threadId,
        event.isSelf ? "outbound" : "inbound",
        event.providerId,
        event.senderId,
        event.clientId ?? null,
        event.providerTimestamp ?? null,
        event.kind,
        event.kind === "text" ? event.text : null,
        semantic,
        randomUUID(),
        JSON.stringify(media?.descriptors ?? []),
      ],
    );
    const row =
      inserted.rows[0] ??
      (
        await db.query(
          "SELECT * FROM provider_events WHERE account_id=$1 AND thread_type=$2 AND thread_id=$3 AND direction=$4 AND provider_id=$5",
          [
            ACCOUNT,
            event.threadType,
            event.threadId,
            event.isSelf ? "outbound" : "inbound",
            event.providerId,
          ],
        )
      ).rows[0];
    const duplicate = !inserted.rowCount;
    if (!duplicate && media)
      await enqueueEventMedia(db, row.id, media, context?.maxPendingMedia);
    if (row.conflict || row.semantic_hash !== semantic) {
      const differing = row.semantic_hash !== semantic;
      const known =
        !differing ||
        !!(
          await db.query(
            "SELECT 1 FROM provider_event_variants WHERE event_id=$1 AND semantic_hash=$2",
            [row.id, semantic],
          )
        ).rowCount;
      const newEvidence =
        differing && !known && row.last_overflow_hash !== semantic;
      let overflow = row.variant_overflow;
      if (differing && !known) {
        const count = (
          await db.query(
            "SELECT count(*)::int n FROM provider_event_variants WHERE event_id=$1",
            [row.id],
          )
        ).rows[0].n;
        if (count < 8) {
          await db.query(
            "INSERT INTO provider_event_variants(event_id,semantic_hash,sender_id,kind,text,client_id,provider_timestamp,media_descriptor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              row.id,
              semantic,
              event.senderId,
              event.kind,
              event.kind === "text" ? event.text : null,
              event.clientId ?? null,
              event.providerTimestamp ?? null,
              JSON.stringify(media?.descriptors ?? []),
            ],
          );
        } else {
          overflow = true;
          await db.query(
            `UPDATE provider_events SET variant_overflow=true,overflow_receipts=CASE WHEN overflow_receipts<${MAX_GAP_VERSION} THEN overflow_receipts+1 ELSE overflow_receipts END,last_overflow_hash=$2 WHERE id=$1`,
            [row.id, semantic],
          );
        }
      }
      // A version at its bigint ceiling is permanently non-resolvable, not wrapped.
      if (newEvidence || !row.conflict) {
        await db.query(
          `UPDATE provider_events SET conflict=true,state='conflict',resolved_at=NULL,resolved_by=NULL,resolution_ref=NULL,
             variant_overflow=variant_overflow OR resolution_version>=${BigInt(MAX_GAP_VERSION) - 1n},
             resolution_version=CASE WHEN resolution_version<${MAX_GAP_VERSION} THEN resolution_version+1 ELSE resolution_version END WHERE id=$1`,
          [row.id],
        );
        await audit(db, null, "provider.event_variant", row.id, {
          semanticHash: semantic,
          retained: !overflow,
        });
      }
      if (!row.conflict) {
        await audit(db, null, "provider.event_conflict", row.id);
      }
      const resolved =
        !!row.resolved_at && !overflow && !row.variant_evidence_missing;
      if (newEvidence || !resolved) {
        await db.query(
          "UPDATE provider_media_jobs SET status='held',version=version+1 WHERE event_id=$1 AND status IN ('pending','processing')",
          [row.id],
        );
        await recordProviderFault(db, "provider_event_conflict");
      } else if (row.media_descriptor?.length) await linkEventMedia(db, row.id);
    } else if (!duplicate) await project(db, row);
    await db.query(
      "UPDATE provider_state SET last_event_at=now() WHERE account_id=$1",
      [ACCOUNT],
    );
    const result = (
      await db.query("SELECT * FROM provider_events WHERE id=$1", [row.id])
    ).rows[0];
    await db.query("COMMIT");
    return {
      eventId: row.id,
      messageId: result.message_id,
      duplicate,
      held: result.state === "held",
      conflict: result.conflict,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function reconcileSelfEvents(
  db: pg.PoolClient,
  conversationId: string,
): Promise<void> {
  await requireTransaction(db);
  await lockConversation(db, conversationId);
  const events = await db.query(
    "SELECT * FROM provider_events WHERE conversation_id=$1 AND direction='outbound' AND state='held' ORDER BY received_at,id",
    [conversationId],
  );
  for (const e of events.rows) await project(db, e);
}
export async function recordPartAccepted(
  db: pg.PoolClient,
  messageId: string,
  part: number,
  providerId: string,
): Promise<void> {
  if (
    !Number.isSafeInteger(part) ||
    part < 0 ||
    typeof providerId !== "string" ||
    !providerId.length ||
    providerId.length > 200 ||
    providerId.includes("\0")
  )
    throw new Error("Invalid provider mapping");
  await requireTransaction(db);
  const m = (
    await db.query(
      "SELECT conversation_id FROM messages WHERE id=$1 AND direction='outbound'",
      [messageId],
    )
  ).rows[0];
  if (!m) throw new Error("Unknown message");
  await lockConversation(db, m.conversation_id);
  const p = (
    await db.query(
      "SELECT * FROM delivery_parts WHERE message_id=$1 AND part=$2 FOR UPDATE",
      [messageId, part],
    )
  ).rows[0];
  if (!p) throw new Error("Unknown delivery part");
  if (p.provider_id && p.provider_id !== providerId)
    throw new Error("Conflicting provider mapping");
  if (
    (
      await db.query(
        "SELECT 1 FROM delivery_parts p JOIN messages m ON m.id=p.message_id WHERE m.conversation_id=$1 AND p.provider_id=$2 AND (p.message_id<>$3 OR p.part<>$4)",
        [m.conversation_id, providerId, messageId, part],
      )
    ).rowCount
  )
    throw new Error("Conflicting provider mapping");
  if (
    (
      await db.query(
        "SELECT 1 FROM provider_events WHERE conversation_id=$1 AND direction='outbound' AND provider_id=$2 AND message_id IS NOT NULL AND message_id<>$3",
        [m.conversation_id, providerId, messageId],
      )
    ).rowCount
  )
    throw new Error("Conflicting provider mapping");
  if (
    (
      await db.query(
        "SELECT 1 FROM messages WHERE conversation_id=$1 AND direction='outbound' AND provider_id=$2 AND id<>$3",
        [m.conversation_id, providerId, messageId],
      )
    ).rowCount
  )
    throw new Error("Conflicting provider mapping");
  await db.query(
    "UPDATE delivery_parts SET status='sent',provider_id=$3 WHERE message_id=$1 AND part=$2",
    [messageId, part, providerId],
  );
  await reconcileSelfEvents(db, m.conversation_id);
}
