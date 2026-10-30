import type pg from "pg";
import { ACCOUNT } from "./db.js";
export const MAX_GAP_VERSION = "9223372036854775807";
/** Exhaustion is terminal: recovery must refuse this version, never wrap it. */
export const nextGapVersionSql = `CASE WHEN gap_version<${MAX_GAP_VERSION} THEN gap_version+1 ELSE gap_version END`;
export const providerFaultCodes = [
  "provider_event_conflict",
  "ingress-failed",
  "ingress-overflow",
  "invalid-inbound",
  "connection-lost",
  "initialization-failed",
  "database-lost",
  "heartbeat-timeout",
  "shutdown",
  "ownership-mismatch",
  "external-fence-ack",
  "restore-quarantine",
] as const;
export type ProviderFaultCode = (typeof providerFaultCodes)[number];
export async function recordProviderFault(
  db: pg.PoolClient,
  code: ProviderFaultCode,
): Promise<{ gapVersion: string }> {
  if (!(providerFaultCodes as readonly unknown[]).includes(code))
    throw new Error("Invalid provider fault");
  await db.query("SELECT set_config('zalo.fault_transaction','active',true)");
  if (
    (
      await db.query(
        "SELECT current_setting('zalo.fault_transaction',true) AS marker",
      )
    ).rows[0]?.marker !== "active"
  )
    throw new Error("Existing transaction required");
  const result = await db.query(
    `UPDATE provider_state SET status='disconnected',reconciliation_required=true,
       fault_code=CASE WHEN gap_version=${MAX_GAP_VERSION} THEN 'version-exhausted' ELSE $2 END,
       gap_version=${nextGapVersionSql} WHERE account_id=$1 RETURNING gap_version::text`,
    [ACCOUNT, code],
  );
  const version = result.rows[0]?.gap_version;
  if (
    result.rowCount !== 1 ||
    typeof version !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(version) ||
    BigInt(version) > BigInt(MAX_GAP_VERSION)
  )
    throw new Error("Provider fault unavailable");
  return { gapVersion: version };
}
