import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ACCOUNT } from "./db.js";
import {
  MAX_GAP_VERSION,
  nextGapVersionSql,
  recordProviderFault,
} from "./provider-faults.js";
export type OwnerToken = Readonly<{
  accountId: string;
  ownerId: string;
  epoch: string;
}>;
export type OwnerFault =
  | "database-lost"
  | "heartbeat-timeout"
  | "initialization-failed"
  | "shutdown"
  | "ownership-mismatch";
export interface OwnershipHandle {
  readonly token: OwnerToken;
  readonly admitted: boolean;
  assertCurrent(): Promise<void>;
  markActive(): Promise<void>;
  invalidate(reason: OwnerFault): Promise<void>;
  close(): Promise<void>;
}
export interface Staff {
  id: string;
}
const unavailable = () => new Error("Connector ownership unavailable");
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const epoch = (s: unknown): s is string =>
  typeof s === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(s) &&
  BigInt(s) <= 9223372036854775807n;
const label = (s: unknown, max: number): s is string =>
  typeof s === "string" &&
  s.length <= max &&
  /^[A-Za-z0-9][A-Za-z0-9_. /#-]*$/.test(s);
const faults = new Set<OwnerFault>([
  "database-lost",
  "heartbeat-timeout",
  "initialization-failed",
  "shutdown",
  "ownership-mismatch",
]);

/** The dedicated session is never returned reusable: destroying it drops all session locks. */
export async function acquireConnectorOwnership(
  pool: pg.Pool,
  options: {
    ownerLabel: string;
    onRevoked: () => void;
    heartbeatMs?: number;
    queryTimeoutMs?: number;
  },
): Promise<OwnershipHandle> {
  const heartbeat = options?.heartbeatMs ?? 5000,
    timeout = options?.queryTimeoutMs ?? 2000;
  if (
    !label(options?.ownerLabel, 128) ||
    typeof options?.onRevoked !== "function" ||
    !Number.isInteger(heartbeat) ||
    heartbeat < 100 ||
    heartbeat > 60000 ||
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 10000
  )
    throw unavailable();
  let client: pg.PoolClient;
  let abandoned = false,
    connectTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    client = await Promise.race([
      Promise.resolve()
        .then(() => pool.connect())
        .then((c) => {
          if (abandoned) {
            try {
              c.release(true);
            } catch {}
            throw unavailable();
          }
          return c;
        }),
      new Promise<never>((_, reject) => {
        connectTimer = setTimeout(() => {
          abandoned = true;
          reject(unavailable());
        }, timeout);
      }),
    ]);
  } catch {
    abandoned = true;
    throw unavailable();
  } finally {
    if (connectTimer) clearTimeout(connectTimer);
  }
  let live = true,
    released = false,
    healthy = true,
    notified = false;
  let token: OwnerToken | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let ending: Promise<void> | undefined;
  const destroy = () => {
    healthy = false;
    if (!released) {
      released = true;
      try {
        client.release(true);
      } catch {}
    }
  };
  const revoke = () => {
    live = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!notified) {
      notified = true;
      try {
        Promise.resolve(options.onRevoked()).catch(() => {});
      } catch {}
    }
  };
  const lost = () => {
    revoke();
    destroy();
  };
  // Retain a harmless observer after disposal so late client error events cannot escape.
  client.on("error", lost);
  client.on("end", lost);
  const query = async (sql: string, values?: any[]) => {
    if (!healthy || released) throw unavailable();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (!healthy || released) throw unavailable();
          return client.query(sql, values);
        }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            lost();
            reject(unavailable());
          }, timeout);
        }),
      ]);
      if (!healthy || released) throw unavailable();
      return result;
    } catch {
      lost();
      throw unavailable();
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  };
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
  const requireLive = () => {
    if (!live || !healthy || !token) throw unavailable();
  };
  const invalidate = (reason: OwnerFault): Promise<void> => {
    revoke(); // Local permission disappears before the first asynchronous operation.
    if (ending) return ending;
    const safeReason = faults.has(reason) ? reason : "ownership-mismatch";
    ending = serial(async () => {
      try {
        if (healthy && token)
          await query(
            `WITH changed AS (
          UPDATE connector_ownership SET phase='uncertain',uncertain_at=now(),fault_code=$4
          WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active') RETURNING account_id
        ), disconnected AS (
          UPDATE provider_state SET status='disconnected',reconciliation_required=true,
            fault_code=CASE WHEN gap_version=${MAX_GAP_VERSION} THEN 'version-exhausted' ELSE $4 END,
            gap_version=${nextGapVersionSql}
          WHERE account_id IN(SELECT account_id FROM changed) RETURNING account_id
        ) INSERT INTO audit(account_id,action,target_id,metadata)
          SELECT account_id,'connector.uncertain',$2::text,jsonb_build_object('epoch',$3::text,'reason',$4::text) FROM changed`,
            [token.accountId, token.ownerId, token.epoch, safeReason],
          );
      } catch {
        /* Existing reserved/active row already prevents takeover. */
      } finally {
        destroy();
      }
    });
    return ending;
  };
  try {
    await serial(async () => {
      if (
        !(await query("SELECT pg_try_advisory_lock(73002,1) AS locked")).rows[0]
          ?.locked
      )
        throw unavailable();
      await query("BEGIN");
      const row = (
        await query(
          "SELECT phase FROM connector_ownership WHERE account_id=$1 FOR UPDATE",
          [ACCOUNT],
        )
      ).rows[0];
      if (!row || row.phase !== "idle") throw unavailable();
      const ownerId = randomUUID();
      const reserved = await query(
        "UPDATE connector_ownership SET phase='reserved',owner_id=$2,owner_label=$3,epoch=epoch+1,reserved_at=now(),heartbeat_at=now(),uncertain_at=NULL,fault_code=NULL WHERE account_id=$1 AND phase='idle' RETURNING epoch::text",
        [ACCOUNT, ownerId, options.ownerLabel],
      );
      if (reserved.rowCount !== 1 || !epoch(reserved.rows[0].epoch))
        throw unavailable();
      token = Object.freeze({
        accountId: ACCOUNT,
        ownerId,
        epoch: reserved.rows[0].epoch,
      });
      await query(
        "INSERT INTO audit(account_id,action,target_id,metadata) VALUES($1,'connector.reserved',$2,$3)",
        [
          ACCOUNT,
          ownerId,
          { epoch: token.epoch, ownerLabel: options.ownerLabel },
        ],
      );
      await query("COMMIT");
      requireLive();
    });
  } catch {
    revoke();
    destroy(); // Discard rolls back uncommitted work; never attempt a retry after unknown COMMIT.
    throw unavailable();
  }
  const checked = async (sql: string) => {
    requireLive();
    try {
      await serial(async () => {
        requireLive();
        const result = await query(sql, [
          token!.accountId,
          token!.ownerId,
          token!.epoch,
        ]);
        requireLive();
        if (result.rowCount !== 1) throw unavailable();
      });
    } catch {
      await invalidate("ownership-mismatch");
      throw unavailable();
    }
  };
  const pulse = () => {
    if (!live) return;
    timer = setTimeout(() => {
      timer = undefined;
      void checked(
        "UPDATE connector_ownership SET heartbeat_at=now() WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active') RETURNING epoch",
      ).then(pulse, () => {});
    }, heartbeat);
    timer.unref();
  };
  pulse();
  return {
    token: token!,
    get admitted() {
      return live && healthy;
    },
    assertCurrent: () =>
      checked(
        "SELECT epoch FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active')",
      ),
    markActive: () =>
      checked(
        "UPDATE connector_ownership SET phase='active',heartbeat_at=now() WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active') RETURNING epoch",
      ),
    invalidate,
    close: () => invalidate("shutdown"),
  };
}

/** Caller must already hold an explicit transaction; this records attestation, not external fencing. */
export async function acknowledgeConnectorFence(
  db: pg.PoolClient,
  actor: Staff,
  input: {
    expectedOwnerId: string;
    expectedEpoch: string;
    evidenceRef: string;
    acknowledgeExternalFence: true;
  },
): Promise<void> {
  try {
    if (
      !uuid(actor?.id) ||
      !uuid(input?.expectedOwnerId) ||
      !epoch(input?.expectedEpoch) ||
      !label(input?.evidenceRef, 256) ||
      input.acknowledgeExternalFence !== true
    )
      throw unavailable();
    await db.query(
      "SELECT set_config('zalo.ownership_transaction','active',true)",
    );
    if (
      (
        await db.query(
          "SELECT current_setting('zalo.ownership_transaction',true) AS marker",
        )
      ).rows[0]?.marker !== "active"
    )
      throw unavailable();
    // Share the staff-change lock used by authenticated mutation transactions.
    await db.query("SELECT pg_advisory_xact_lock_shared(72001)");
    const staff = (
      await db.query(
        "SELECT id,name FROM users WHERE id=$1 AND account_id=$2 AND active AND role='admin' FOR SHARE",
        [actor.id, ACCOUNT],
      )
    ).rows[0];
    if (
      !staff ||
      !(await db.query("SELECT pg_try_advisory_xact_lock(73002,1) AS locked"))
        .rows[0]?.locked
    )
      throw unavailable();
    const old = (
      await db.query(
        "SELECT phase,owner_id,epoch::text FROM connector_ownership WHERE account_id=$1 FOR UPDATE",
        [ACCOUNT],
      )
    ).rows[0];
    if (
      !old ||
      old.phase === "idle" ||
      old.owner_id !== input.expectedOwnerId ||
      old.epoch !== input.expectedEpoch
    )
      throw unavailable();
    await db.query(
      "INSERT INTO audit(account_id,actor_id,actor_name,action,target_id,metadata) VALUES($1,$2,$3,'connector.external_fence_ack',$4,$5)",
      [
        ACCOUNT,
        staff.id,
        staff.name,
        old.owner_id,
        { epoch: old.epoch, evidenceRef: input.evidenceRef },
      ],
    );
    const result = await db.query(
      "UPDATE connector_ownership SET phase='idle',owner_id=NULL,owner_label=NULL,last_fenced_owner_id=$2,last_fenced_epoch=$3,last_fenced_at=now(),fault_code=NULL WHERE account_id=$1 AND owner_id=$2 AND epoch=$3",
      [ACCOUNT, old.owner_id, old.epoch],
    );
    if (result.rowCount !== 1) throw unavailable();
    await recordProviderFault(db, "external-fence-ack");
  } catch {
    throw unavailable();
  }
}
