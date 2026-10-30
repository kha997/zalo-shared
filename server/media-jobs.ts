import type pg from "pg";
import { ACCOUNT } from "./db.js";
import { locatorAad, type LocatorCipher } from "./locator-cipher.js";
export type MediaCandidate = Readonly<{
  index: number;
  name: string;
  url: string;
  category: "photo" | "file";
}>;
export type MediaDescriptor = Readonly<{
  index: number;
  name: string;
  category: "photo" | "file";
  locatorFingerprint: string;
}>;
export type PreparedEventMedia = {
  items: ReadonlyArray<MediaCandidate>;
  descriptors: ReadonlyArray<MediaDescriptor>;
  cipher: LocatorCipher;
};
const unavailable = () => new Error("Private media receipt unavailable");
/** Pure bounded snapshot. URL admission here is syntax only, never fetch permission. */
export function prepareEventMedia(
  items: ReadonlyArray<MediaCandidate>,
  cipher: LocatorCipher | undefined,
): PreparedEventMedia {
  try {
    if (
      !cipher ||
      typeof cipher.seal !== "function" ||
      typeof cipher.fingerprint !== "function" ||
      !Array.isArray(items) ||
      items.length !== 1
    )
      throw unavailable();
    const snapshots = items.map((v, i) => {
      if (
        !v ||
        Object.keys(v).length !== 4 ||
        v.index !== i ||
        !["photo", "file"].includes(v.category) ||
        typeof v.name !== "string" ||
        !v.name.trim() ||
        v.name !== v.name.trim() ||
        v.name.length > 200 ||
        /[\\/\x00-\x1f\x7f]/.test(v.name) ||
        /[:?&#=@%/\\]/.test(v.name.normalize("NFKC")) ||
        [".", ".."].includes(v.name) ||
        Buffer.from(v.name).toString("utf8") !== v.name ||
        typeof v.url !== "string"
      )
        throw unavailable();
      return Object.freeze({
        index: i,
        name: v.name,
        url: v.url,
        category: v.category,
      });
    });
    const descriptors = snapshots.map((v) => {
      const fingerprint = cipher.fingerprint(v.url);
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw unavailable();
      return Object.freeze({
        index: v.index,
        name: v.name,
        category: v.category,
        locatorFingerprint: fingerprint,
      });
    });
    return {
      items: Object.freeze(snapshots),
      descriptors: Object.freeze(descriptors),
      cipher,
    };
  } catch {
    throw unavailable();
  }
}
async function requireTransaction(db: pg.PoolClient) {
  await db.query("SELECT set_config('zalo.media_transaction','active',true)");
  if (
    (
      await db.query(
        "SELECT current_setting('zalo.media_transaction',true) AS marker",
      )
    ).rows[0]?.marker !== "active"
  )
    throw unavailable();
}
async function eventForUpdate(db: pg.PoolClient, eventId: string) {
  const located = (
    await db.query(
      "SELECT conversation_id FROM provider_events WHERE id=$1 AND account_id=$2",
      [eventId, ACCOUNT],
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
    throw unavailable();
  const event = (
    await db.query(
      "SELECT * FROM provider_events WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [eventId, ACCOUNT],
    )
  ).rows[0];
  if (!event) throw unavailable();
  return event;
}
/** Explicit transaction and same-account conversation/event locks; no locator is a SQL parameter. */
export async function enqueueEventMedia(
  db: pg.PoolClient,
  eventId: string,
  media: PreparedEventMedia,
  maxPending = 1000,
): Promise<void> {
  try {
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 10000)
      throw unavailable();
    await requireTransaction(db);
    await eventForUpdate(db, eventId);
    await db.query("SELECT pg_advisory_xact_lock(73004,1)");
    const count = (
      await db.query(
        "SELECT count(*)::int n FROM provider_media_jobs WHERE account_id=$1 AND status IN ('pending','processing','held')",
        [ACCOUNT],
      )
    ).rows[0].n;
    if (count + media.items.length > maxPending) throw unavailable();
    for (const item of media.items) {
      const envelope = media.cipher.seal(
        item.url,
        locatorAad(ACCOUNT, eventId, item.index),
      );
      await db.query(
        "INSERT INTO provider_media_jobs(account_id,event_id,item_index,category,name,locator_fingerprint,locator_envelope,status) VALUES($1,$2,$3,$4,$5,$6,$7,'held')",
        [
          ACCOUNT,
          eventId,
          item.index,
          item.category,
          item.name,
          media.descriptors[item.index].locatorFingerprint,
          envelope,
        ],
      );
    }
  } catch {
    throw unavailable();
  }
}
/** Event/conversation projection controls readiness. Exact sent-part attachment mapping is the only reuse evidence. */
export async function linkEventMedia(
  db: pg.PoolClient,
  eventId: string,
): Promise<void> {
  try {
    await linkEventMediaInternal(db, eventId);
  } catch {
    throw unavailable();
  }
}
async function linkEventMediaInternal(
  db: pg.PoolClient,
  eventId: string,
): Promise<void> {
  await requireTransaction(db);
  const e = await eventForUpdate(db, eventId);
  if ((e.conflict && !e.resolved_at) || !e.message_id) return;
  if (
    !(
      await db.query(
        "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2",
        [e.message_id, e.conversation_id],
      )
    ).rowCount
  )
    throw unavailable();
  const part = (
    await db.query(
      "SELECT p.attachment_id,a.id AS valid_attachment FROM delivery_parts p JOIN messages m ON m.id=p.message_id LEFT JOIN attachments a ON a.id=p.attachment_id AND a.message_id=m.id AND a.account_id=$3 WHERE p.message_id=$1 AND p.provider_id=$2 AND p.status='sent'",
      [e.message_id, e.provider_id, ACCOUNT],
    )
  ).rows[0];
  if (part) {
    await db.query(
      "UPDATE provider_media_jobs SET message_id=$2,status=$3,attachment_id=$4,locator_envelope=NULL,error_code=$5,version=version+1 WHERE event_id=$1 AND account_id=$6 AND status IN ('held','pending')",
      [
        eventId,
        e.message_id,
        part.valid_attachment ? "ready" : "unavailable",
        part.valid_attachment ?? null,
        part.valid_attachment ? null : "unsupported-echo",
        ACCOUNT,
      ],
    );
  } else {
    await db.query(
      "UPDATE provider_media_jobs SET message_id=$2,status='pending',version=version+1 WHERE event_id=$1 AND account_id=$3 AND status='held'",
      [eventId, e.message_id, ACCOUNT],
    );
  }
}
