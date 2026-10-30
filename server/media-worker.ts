import type pg from "pg";
import { ACCOUNT, audit } from "./db.js";
import type { OwnershipHandle } from "./connector-ownership.js";
import { locatorAad, type LocatorCipher } from "./locator-cipher.js";
import { linkEventMedia } from "./media-jobs.js";
import { prepareMedia, type MediaInput } from "./media.js";
import {
  downloadMedia,
  MediaDownloadError,
  type MediaNetworkPolicy,
} from "./private-media-download.js";

export interface MediaWorkerOptions {
  owner: OwnershipHandle;
  cipher: LocatorCipher;
  policy: MediaNetworkPolicy;
  /** Trusted test/network adapter only; production uses the bounded downloader. */
  download?: typeof downloadMedia;
  maxDownloadedBytes?: number;
}
const MAX_VERSION = 9223372036854775807n;
const MAX_BYTES = 5 * 1024 * 1024;
// The single admitted connector process also keeps its slots while a GET settles,
// even when its database session (and advisory locks) disappear in the meantime.
let activeCalls = 0;
const unavailable = () => new Error("Private media worker unavailable");
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const version = (x: unknown): x is string =>
  typeof x === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(x) &&
  BigInt(x) <= MAX_VERSION;
const nextVersion =
  "CASE WHEN version<9223372036854775807 THEN version+1 ELSE version END";
type Job = Record<string, any>;

/** Injected library only. It never authenticates, schedules itself or changes outgoing send state. */
export async function runMediaDownloadOnce(
  pool: pg.Pool,
  options: MediaWorkerOptions,
): Promise<{ processed: boolean }> {
  let db: pg.PoolClient | undefined;
  let released = false,
    dead = false,
    localSlot = false,
    lane: number | undefined,
    jobLock: string | undefined;
  const destroy = () => {
    dead = true;
    if (db && !released) {
      released = true;
      try {
        db.release(true);
      } catch {}
    }
  };
  const query = async (
    sql: string,
    values?: any[],
  ): Promise<pg.QueryResult<any>> => {
    if (!db || dead) throw unavailable();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (dead) throw unavailable();
          return db!.query(sql, values);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            destroy();
            reject(unavailable());
          }, 2000);
        }),
      ]);
      if (dead) throw unavailable();
      return result;
    } catch {
      destroy();
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    const owner = options?.owner;
    const budget = options?.maxDownloadedBytes ?? 250 * 1024 * 1024;
    if (
      !owner?.admitted ||
      owner.token?.accountId !== ACCOUNT ||
      !uuid(owner.token.ownerId) ||
      !version(owner.token.epoch) ||
      typeof owner.assertCurrent !== "function" ||
      !options.cipher ||
      typeof options.cipher.open !== "function" ||
      typeof options.cipher.fingerprint !== "function" ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 10 * 1024 * 1024 * 1024 ||
      !(options.policy?.approvedHosts instanceof Set) ||
      !Number.isInteger(options.policy.maxBytes) ||
      options.policy.maxBytes < 1 ||
      options.policy.maxBytes > MAX_BYTES ||
      (options.download !== undefined && typeof options.download !== "function")
    )
      throw unavailable();
    const token = Object.freeze({ ...owner.token });
    const policy: MediaNetworkPolicy = {
      approvedHosts: new Set(options.policy.approvedHosts),
      maxBytes: options.policy.maxBytes,
      ...(options.policy.timeouts
        ? { timeouts: { ...options.policy.timeouts } }
        : {}),
    };
    const current = async () => {
      if (!owner.admitted) throw unavailable();
      await owner.assertCurrent();
      if (!owner.admitted) throw unavailable();
    };
    if (activeCalls >= 2) return { processed: false };
    activeCalls++;
    localSlot = true;
    await current();
    let acquireTimer: ReturnType<typeof setTimeout> | undefined,
      abandoned = false;
    try {
      db = await Promise.race([
        Promise.resolve()
          .then(() => pool.connect())
          .then((client) => {
            if (abandoned) {
              try {
                client.release(true);
              } catch {}
              throw unavailable();
            }
            return client;
          }),
        new Promise<never>((_, reject) => {
          acquireTimer = setTimeout(() => {
            abandoned = true;
            reject(unavailable());
          }, 2000);
        }),
      ]);
    } finally {
      if (acquireTimer) clearTimeout(acquireTimer);
    }
    db.on?.("error", destroy);
    db.on?.("end", destroy);
    for (const n of [0, 1]) {
      if (
        (
          await query(
            "SELECT pg_try_advisory_lock(73003,$1::integer) AS locked",
            [n],
          )
        ).rows[0]?.locked
      ) {
        lane = n;
        break;
      }
    }
    if (lane === undefined) return { processed: false };
    const ownerRow = async () => {
      await current();
      if (
        !(
          await query(
            "SELECT account_id FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase='active' FOR SHARE",
            [ACCOUNT, token.ownerId, token.epoch],
          )
        ).rowCount
      )
        throw unavailable();
    };
    const located = async (id: string) => {
      const row = (
        await query(
          "SELECT e.id AS event_id,e.conversation_id FROM provider_media_jobs j JOIN provider_events e ON e.id=j.event_id AND e.account_id=j.account_id WHERE j.id=$1 AND j.account_id=$2",
          [id, ACCOUNT],
        )
      ).rows[0];
      if (
        !row ||
        !(
          await query(
            "SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",
            [row.conversation_id, ACCOUNT],
          )
        ).rowCount
      )
        throw unavailable();
      const event = (
        await query(
          "SELECT * FROM provider_events WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [row.event_id, ACCOUNT],
        )
      ).rows[0];
      const job = (
        await query(
          "SELECT *,extract(epoch from now()-created_at)::float8 AS age_seconds FROM provider_media_jobs WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [id, ACCOUNT],
        )
      ).rows[0];
      if (!event || !job || job.event_id !== event.id || !version(job.version))
        throw unavailable();
      return { event, job };
    };
    const stopJob = async (job: Job, reason: string, erase = false) => {
      if (
        !(
          await query(
            `UPDATE provider_media_jobs SET status='unavailable',error_code=$3,locator_envelope=CASE WHEN $4::boolean THEN NULL ELSE locator_envelope END,version=${nextVersion},claimed_at=NULL WHERE id=$1 AND account_id=$2 AND version=$5`,
            [job.id, ACCOUNT, reason, erase, job.version],
          )
        ).rowCount
      )
        throw unavailable();
      await audit(
        { query } as any,
        null,
        "media.download_unavailable",
        job.id,
        { reason },
      );
    };
    const rows = (
      await query(
        `SELECT j.id FROM provider_media_jobs j JOIN provider_events e ON e.id=j.event_id AND e.account_id=j.account_id
      WHERE j.account_id=$1 AND (
        (j.status='pending' AND j.next_attempt_at<=now()) OR j.status='processing' OR
        (j.status='held' AND e.message_id IS NOT NULL AND (NOT e.conflict OR (e.resolved_at IS NOT NULL AND NOT e.variant_overflow AND NOT e.variant_evidence_missing))) OR
        (j.status IN ('held','unavailable') AND j.locator_envelope IS NOT NULL AND j.created_at<=now()-interval '24 hours'))
      ORDER BY j.created_at,j.id LIMIT 32`,
        [ACCOUNT],
      )
    ).rows;
    let claimed: Job | undefined, locator: string | undefined;
    for (const candidate of rows) {
      if (!uuid(candidate.id)) throw unavailable();
      if (
        !(
          await query(
            "SELECT pg_try_advisory_lock(73005,hashtext($1::text)) AS locked",
            [candidate.id],
          )
        ).rows[0]?.locked
      )
        continue;
      jobLock = candidate.id;
      await query("BEGIN");
      await ownerRow();
      let { job, event } = await located(candidate.id);
      if (!Number.isFinite(job.age_seconds) || job.age_seconds < 0)
        throw unavailable();
      if (job.locator_envelope && job.age_seconds >= 86400) {
        await stopJob(job, "expired", true);
        await query("COMMIT");
        return { processed: true };
      }
      if (BigInt(job.version) >= MAX_VERSION - 1n) {
        await stopJob(job, "version-exhausted");
        await query("COMMIT");
        return { processed: true };
      }
      if (
        (event.conflict &&
          (!event.resolved_at ||
            event.variant_overflow ||
            event.variant_evidence_missing)) ||
        !event.message_id
      ) {
        if (job.status === "pending" || job.status === "processing")
          await query(
            `UPDATE provider_media_jobs SET status='held',version=${nextVersion} WHERE id=$1 AND account_id=$2`,
            [job.id, ACCOUNT],
          );
        await query("COMMIT");
      } else {
        await linkEventMedia({ query } as any, event.id);
        ({ job, event } = await located(candidate.id));
        if (["pending", "processing"].includes(job.status)) {
          if (BigInt(job.version) >= MAX_VERSION - 1n) {
            await stopJob(job, "version-exhausted");
            await query("COMMIT");
            return { processed: true };
          }
          const message = (
            await query(
              "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2",
              [job.message_id, event.conversation_id],
            )
          ).rows[0];
          const descriptor =
            Array.isArray(event.media_descriptor) &&
            event.media_descriptor.find((d: any) => d.index === job.item_index);
          if (
            !message ||
            job.message_id !== event.message_id ||
            !descriptor ||
            descriptor.name !== job.name ||
            descriptor.category !== job.category ||
            descriptor.locatorFingerprint !== job.locator_fingerprint
          ) {
            await stopJob(job, "descriptor");
            await query("COMMIT");
            return { processed: true };
          }
          if (job.attempts >= 3) {
            await stopJob(job, "retry-limit");
            await query("COMMIT");
            return { processed: true };
          }
          if (
            (
              await query(
                "SELECT reconciliation_required FROM provider_state WHERE account_id=$1 FOR SHARE",
                [ACCOUNT],
              )
            ).rows[0]?.reconciliation_required !== false
          ) {
            await query("ROLLBACK");
            return { processed: false };
          }
          if (!policy.approvedHosts.size) {
            await stopJob(job, "policy");
            await query("COMMIT");
            return { processed: true };
          }
          try {
            locator = options.cipher.open(
              job.locator_envelope,
              locatorAad(ACCOUNT, event.id, job.item_index),
            );
            if (options.cipher.fingerprint(locator) !== job.locator_fingerprint)
              throw unavailable();
          } catch {
            await stopJob(job, "key-unavailable");
            await query("COMMIT");
            return { processed: true };
          }
          const update = await query(
            `UPDATE provider_media_jobs SET status='processing',attempts=attempts+1,claimed_at=now(),error_code=NULL,version=version+1 WHERE id=$1 AND account_id=$2 AND version=$3 AND attempts<3 RETURNING *`,
            [job.id, ACCOUNT, job.version],
          );
          if (update.rowCount !== 1) throw unavailable();
          claimed = update.rows[0];
          await audit(
            { query } as any,
            null,
            "media.download_started",
            job.id,
            { attempt: claimed!.attempts },
          );
          await query("COMMIT");
          break;
        }
        await query("COMMIT");
      }
      await query("SELECT pg_advisory_unlock(73005,hashtext($1::text))", [
        jobLock,
      ]);
      jobLock = undefined;
    }
    if (!claimed || locator === undefined) return { processed: false };
    await current();
    if (dead) throw unavailable();
    let content: { mime: MediaInput["mime"]; data: Buffer } | undefined,
      failure: string | undefined;
    try {
      content = await (options.download ?? downloadMedia)(
        locator,
        claimed.category,
        policy,
      );
      if (
        !content ||
        !Buffer.isBuffer(content.data) ||
        content.data.length > policy.maxBytes ||
        (claimed.category === "photo" &&
          !["image/png", "image/jpeg"].includes(content.mime))
      )
        throw new MediaDownloadError("content");
      let checked;
      try {
        checked = prepareMedia({
          name: claimed.name,
          mime: content.mime,
          data: content.data,
        });
      } catch {
        throw new MediaDownloadError("content");
      }
      content = { mime: content.mime, data: checked.data };
    } catch (error) {
      failure =
        error instanceof MediaDownloadError &&
        [
          "policy",
          "address",
          "timeout",
          "response",
          "content",
          "network",
        ].includes(error.code)
          ? error.code
          : "network";
    }
    await current();
    await query("BEGIN");
    await ownerRow();
    const { job, event } = await located(claimed.id);
    if (
      job.status !== "processing" ||
      job.version !== claimed.version ||
      (event.conflict &&
        (!event.resolved_at ||
          event.variant_overflow ||
          event.variant_evidence_missing)) ||
      event.message_id !== job.message_id
    ) {
      await query("ROLLBACK");
      return { processed: true };
    }
    // Receipt admission takes this quota lock before its final provider-state
    // write. Keep the same order here to avoid a cross-conversation deadlock.
    await query("SELECT pg_advisory_xact_lock(73004,1)");
    if (
      (
        await query(
          "SELECT reconciliation_required FROM provider_state WHERE account_id=$1 FOR SHARE",
          [ACCOUNT],
        )
      ).rows[0]?.reconciliation_required !== false
    ) {
      await query("ROLLBACK");
      return { processed: true };
    }
    if (job.age_seconds >= 86400) {
      await stopJob(job, "expired", true);
      await query("COMMIT");
      return { processed: true };
    }
    if (failure) {
      const retry =
        ["network", "timeout"].includes(failure) && job.attempts < 3;
      await query(
        `UPDATE provider_media_jobs SET status=$3,error_code=$4,next_attempt_at=now()+interval '1 second' * attempts,claimed_at=NULL,version=${nextVersion} WHERE id=$1 AND account_id=$2 AND version=$5`,
        [
          job.id,
          ACCOUNT,
          retry ? "pending" : "unavailable",
          failure,
          job.version,
        ],
      );
      await audit(
        { query } as any,
        null,
        retry ? "media.download_deferred" : "media.download_unavailable",
        job.id,
        { reason: failure },
      );
    } else {
      const used = (
        await query(
          "SELECT coalesce(sum(octet_length(a.data)),0)::text AS bytes FROM attachments a JOIN (SELECT DISTINCT attachment_id FROM provider_media_jobs WHERE account_id=$1 AND status='ready') j ON j.attachment_id=a.id WHERE a.account_id=$1 AND a.owner_id IS NULL",
          [ACCOUNT],
        )
      ).rows[0]?.bytes;
      if (typeof used !== "string" || !/^[0-9]+$/.test(used))
        throw unavailable();
      if (BigInt(used) + BigInt(content!.data.length) > BigInt(budget))
        await stopJob(job, "storage-budget");
      else {
        const source = prepareMedia({
          name: job.name,
          mime: content!.mime,
          data: content!.data,
        });
        const attachment = (
          await query(
            "INSERT INTO attachments(account_id,owner_id,name,mime,data,message_id) VALUES($1,NULL,$2,$3,$4,$5) RETURNING id",
            [
              ACCOUNT,
              source.filename,
              content!.mime,
              source.data,
              job.message_id,
            ],
          )
        ).rows[0]?.id;
        if (
          !uuid(attachment) ||
          !(
            await query(
              `UPDATE provider_media_jobs SET status='ready',attachment_id=$3,locator_envelope=NULL,error_code=NULL,claimed_at=NULL,version=${nextVersion} WHERE id=$1 AND account_id=$2 AND version=$4 AND status='processing'`,
              [job.id, ACCOUNT, attachment, job.version],
            )
          ).rowCount
        )
          throw unavailable();
        await audit({ query } as any, null, "media.download_ready", job.id, {
          attachmentId: attachment,
          bytes: source.data.length,
          mime: content!.mime,
        });
      }
    }
    await query("COMMIT");
    return { processed: true };
  } catch {
    destroy();
    throw unavailable();
  } finally {
    if (db && !dead) {
      try {
        if (jobLock)
          await query("SELECT pg_advisory_unlock(73005,hashtext($1::text))", [
            jobLock,
          ]);
        if (lane !== undefined)
          await query("SELECT pg_advisory_unlock(73003,$1::integer)", [lane]);
      } catch {
        destroy();
      }
    }
    if (db && !released) {
      released = true;
      db.off?.("error", destroy);
      db.off?.("end", destroy);
      try {
        db.release(dead);
      } catch {}
    }
    if (localSlot) activeCalls--;
  }
}
