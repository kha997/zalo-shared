import type pg from "pg";
import { ACCOUNT } from "./db.js";
import { expireMediaLocators, type MediaRetentionResult } from "./media-retention.js";
import { runMediaDownloadOnce, type MediaWorkerOptions } from "./media-worker.js";

export interface MediaSchedulerOptions {
  pool: pg.Pool;
  worker: MediaWorkerOptions;
  retention?: { retentionMs?: number; maxJobs?: number };
  maintenanceEvery?: number;
  maxIterations: number;
  idleDelayMs?: number;
  signal?: { readonly aborted: boolean };
  sleep?: (ms: number) => Promise<void>;
}

export interface MediaSchedulerResult {
  iterations: number;
  downloads: number;
  expired: number;
  stopped: "bounded" | "aborted" | "owner-lost" | "key-missing";
}

const unavailable = () => new Error("Private media scheduler unavailable");
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Counts encrypted jobs that the supplied keyring cannot open; never returns locators. */
async function locatorKeyCoverage(
  pool: pg.Pool,
  cipher: MediaWorkerOptions["cipher"],
): Promise<{ envelopes: number; missing: number }> {
  const db = await pool.connect();
  try {
    const rows = (
      await db.query(
        "SELECT DISTINCT locator_envelope->>'keyId' AS key_id FROM provider_media_jobs WHERE account_id=$1 AND locator_envelope IS NOT NULL AND status IN ('pending','processing','held') LIMIT 32",
        [ACCOUNT],
      )
    ).rows;
    if (typeof cipher.hasKey !== "function")
      return { envelopes: rows.length, missing: 0 };
    let missing = 0;
    for (const row of rows) {
      if (
        typeof row.key_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(row.key_id) ||
        !cipher.hasKey(row.key_id)
      )
        missing++;
    }
    return { envelopes: rows.length, missing };
  } finally {
    db.release();
  }
}

/**
 * Bounded download scheduling. It never imports the outbox/provider sender and
 * never retries an external message; the only external effect is a media GET.
 * Ownership is rechecked every iteration and maintenance is bounded per run.
 */
export async function runMediaScheduler(
  options: MediaSchedulerOptions,
): Promise<MediaSchedulerResult> {
  const maxIterations = options?.maxIterations;
  const maintenanceEvery = options?.maintenanceEvery ?? 10;
  const idleDelayMs = options?.idleDelayMs ?? 500;
  const sleep = options?.sleep ?? defaultSleep;
  const worker = options?.worker;
  if (
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 10000 ||
    !Number.isInteger(maintenanceEvery) ||
    maintenanceEvery < 1 ||
    maintenanceEvery > 1000 ||
    !Number.isInteger(idleDelayMs) ||
    idleDelayMs < 0 ||
    idleDelayMs > 60000 ||
    typeof sleep !== "function" ||
    !worker?.owner ||
    typeof worker.owner.assertCurrent !== "function"
  )
    throw unavailable();
  let downloads = 0,
    expired = 0,
    iterations = 0,
    keyChecked = false;
  for (let i = 0; i < maxIterations; i++) {
    if (options.signal?.aborted)
      return { iterations, downloads, expired, stopped: "aborted" };
    if (!worker.owner.admitted)
      return { iterations, downloads, expired, stopped: "owner-lost" };
    try {
      await worker.owner.assertCurrent();
    } catch {
      return { iterations, downloads, expired, stopped: "owner-lost" };
    }
    if (!worker.owner.admitted)
      return { iterations, downloads, expired, stopped: "owner-lost" };
    iterations++;
    if (i % maintenanceEvery === 0) {
      let result: MediaRetentionResult;
      try {
        result = await expireMediaLocators(options.pool, {
          owner: worker.owner,
          ...(options.retention ?? {}),
        });
      } catch {
        if (!worker.owner.admitted)
          return { iterations, downloads, expired, stopped: "owner-lost" };
        throw unavailable();
      }
      expired += result.expired;
    }
    if (!keyChecked) {
      let coverage: { envelopes: number; missing: number };
      try {
        coverage = await locatorKeyCoverage(options.pool, worker.cipher);
      } catch {
        throw unavailable();
      }
      if (coverage.missing > 0)
        return { iterations, downloads, expired, stopped: "key-missing" };
      keyChecked = true;
    }
    let processed = false;
    try {
      processed = (await runMediaDownloadOnce(options.pool, worker)).processed;
    } catch {
      if (!worker.owner.admitted)
        return { iterations, downloads, expired, stopped: "owner-lost" };
      throw unavailable();
    }
    if (processed) downloads++;
    else await sleep(idleDelayMs);
  }
  return { iterations, downloads, expired, stopped: "bounded" };
}
