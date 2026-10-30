import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { ACCOUNT } from "./db.js";
import type { Config } from "./config.js";
import { acknowledgeConnectorFence } from "./connector-ownership.js";
import {
  confirmUnknownPart,
  resolveKnownConflict,
  acknowledgeProviderGap,
} from "./connector-operations.js";
const uuid = z.string().uuid();
const version = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(
    (s) =>
      /^(0|[1-9][0-9]{0,18})$/.test(s) && BigInt(s) <= 9223372036854775807n,
  );
const evidence = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_. /#-]*$/);
const fail = (statusCode: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode });
};
type Queryable = Pick<pg.Pool, "query">;
const timestamp =
  "to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
const cursorSchema = z
  .object({
    time: z
      .string()
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/)
      .refine(
        (s) =>
          Number(s.slice(0, 4)) >= 1 &&
          Number.isFinite(Date.parse(s)) &&
          new Date(s).toISOString() === s.slice(0, 23) + "Z",
      ),
    id: uuid,
  })
  .strict();
export function decodeOperationsCursor(value: string | undefined) {
  if (value === undefined) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
    fail(400, "Invalid cursor");
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) fail(400, "Invalid cursor");
    return cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    fail(400, "Invalid cursor");
  }
}
const encodeCursor = (row: any) =>
  Buffer.from(
    JSON.stringify({ time: row.cursor_time, id: row.cursor_id ?? row.id }),
  ).toString("base64url");
export async function providerSummary(db: Queryable, config: Config) {
  const row = (
    await db.query(
      `SELECT s.status,s.last_event_at,s.reconciliation_required,s.gap_version::text,s.fault_code,o.phase ownership_phase,o.owner_id,o.epoch::text,
 (SELECT count(*)::int FROM provider_events e WHERE e.account_id=s.account_id AND e.state='held') held,
 (SELECT count(*)::int FROM provider_events e WHERE e.account_id=s.account_id AND (e.variant_overflow OR e.variant_evidence_missing OR(e.conflict AND e.resolved_at IS NULL))) conflicts,
 (SELECT count(*)::int FROM outbox b JOIN messages m ON m.id=b.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=s.account_id AND (b.status='unknown' OR m.status='unknown')) unknown_jobs
 FROM provider_state s JOIN connector_ownership o ON o.account_id=s.account_id WHERE s.account_id=$1`,
      [ACCOUNT],
    )
  ).rows[0];
  if (!row) fail(409, "Connector state unavailable");
  return {
    mode: config.mockEnabled ? "mock" : "disabled",
    status: config.mockEnabled ? row.status : "disconnected",
    lastEventAt: row.last_event_at?.toISOString() ?? null,
    reconciliationRequired: row.reconciliation_required,
    gapVersion: row.gap_version,
    counts: {
      held: row.held,
      unresolvedConflicts: row.conflicts,
      unknownJobs: row.unknown_jobs,
    },
    ownershipPhase: row.ownership_phase,
    privateOwner: {
      ownerId: row.owner_id,
      epoch: row.epoch,
      phase: row.ownership_phase,
    },
    privateFault: row.fault_code,
  };
}
const summary = (r: any) => ({
  id: r.id,
  conversationId: r.conversation_id,
  providerId: r.provider_id,
  direction: r.direction,
  kind: r.kind,
  text: r.text,
  state: r.state,
  resolutionVersion: String(r.resolution_version),
  conflict: r.conflict,
  resolvedAt: r.resolved_at?.toISOString() ?? null,
  variantOverflow: r.variant_overflow,
  variantEvidenceMissing: r.variant_evidence_missing,
  receivedAt: r.received_at.toISOString(),
});
type Transaction = <T>(
  req: any,
  fn: (db: pg.PoolClient) => Promise<T>,
) => Promise<T>;
export function registerConnectorOperations(
  app: FastifyInstance,
  options: {
    config: Config;
    transaction: Transaction;
    admin: (req: any) => void;
  },
) {
  const { transaction, admin, config } = options;
  const secured = <T>(req: any, fn: (db: pg.PoolClient) => Promise<T>) =>
    transaction(req, async (db) => {
      admin(req);
      return fn(db);
    });
  app.get("/api/provider/operations", async (req) =>
    secured(req, async (db) => {
      const r = await providerSummary(db, config);
      return {
        mode: r.mode,
        status: r.status,
        reconciliationRequired: r.reconciliationRequired,
        gapVersion: r.gapVersion,
        faultCode: r.privateFault,
        owner: r.privateOwner,
        counts: r.counts,
      };
    }),
  );
  app.get("/api/provider/operations/events", async (req: any) =>
    secured(req, async (db) => {
      const q = z
        .object({
          state: z.enum(["held", "conflict"]),
          limit: z.coerce.number().int().min(1).max(50).default(25),
          cursor: z.string().optional(),
        })
        .strict()
        .parse(req.query);
      const cursor = decodeOperationsCursor(q.cursor);
      const rows = (
        await db.query(
          `SELECT *,${timestamp} cursor_time FROM provider_events WHERE account_id=$1 AND state=$2 AND ($3::timestamptz IS NULL OR(received_at,id)<($3::timestamptz,$4::uuid)) ORDER BY received_at DESC,id DESC LIMIT $5`,
          [
            ACCOUNT,
            q.state,
            cursor?.time ?? null,
            cursor?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      const items = rows.slice(0, q.limit);
      return {
        items: items.map(summary),
        nextCursor: rows.length > q.limit ? encodeCursor(items.at(-1)) : null,
      };
    }),
  );
  app.get("/api/provider/operations/events/:id", async (req: any) =>
    secured(req, async (db) => {
      const id = uuid.parse(req.params.id);
      const e = (
        await db.query(
          "SELECT * FROM provider_events WHERE id=$1 AND account_id=$2",
          [id, ACCOUNT],
        )
      ).rows[0];
      if (!e) fail(404, "Provider event not found");
      const variants = (
        await db.query(
          "SELECT * FROM provider_event_variants WHERE event_id=$1 ORDER BY semantic_hash LIMIT 8",
          [id],
        )
      ).rows;
      return {
        ...summary(e),
        semanticHash: e.semantic_hash,
        variants: variants.map((v) => ({
          semanticHash: v.semantic_hash,
          senderId: v.sender_id,
          kind: v.kind,
          text: v.text,
          clientId: v.client_id,
          providerTimestamp: v.provider_timestamp,
          receivedAt: v.received_at.toISOString(),
        })),
      };
    }),
  );
  app.get("/api/provider/operations/unknown", async (req: any) =>
    secured(req, async (db) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(25),
          cursor: z.string().optional(),
        })
        .strict()
        .parse(req.query);
      const cursor = decodeOperationsCursor(q.cursor);
      const rows = (
        await db.query(
          `SELECT m.id,m.conversation_id,m.text,m.actor_id,m.created_at,o.id cursor_id,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND(o.status='unknown' OR m.status='unknown') AND($2::timestamptz IS NULL OR(o.created_at,o.id)<($2::timestamptz,$3::uuid)) ORDER BY o.created_at DESC,o.id DESC LIMIT $4`,
          [ACCOUNT, cursor?.time ?? null, cursor?.id ?? null, q.limit + 1],
        )
      ).rows;
      const selected = rows.slice(0, q.limit);
      const items = [];
      for (const r of selected) {
        const parts = (
          await db.query(
            "SELECT part,status,provider_id,attachment_id FROM delivery_parts WHERE message_id=$1 ORDER BY part LIMIT 6",
            [r.id],
          )
        ).rows;
        items.push({
          messageId: r.id,
          conversationId: r.conversation_id,
          text: r.text,
          actorId: r.actor_id,
          createdAt: r.created_at.toISOString(),
          parts: parts.map((p) => ({
            part: p.part,
            status: p.status,
            providerId: p.provider_id,
            attachmentId: p.attachment_id,
          })),
        });
      }
      return {
        items,
        nextCursor:
          rows.length > q.limit ? encodeCursor(selected.at(-1)) : null,
      };
    }),
  );
  const confirm = z
    .object({
      messageId: uuid,
      part: z.number().int().min(0).max(5),
      eventId: uuid,
      expectedResolutionVersion: version,
      evidenceRef: evidence,
      confirmProviderIdObserved: z.literal(true),
    })
    .strict();
  const conflict = z
    .object({
      eventId: uuid,
      expectedResolutionVersion: version,
      expectedVariantHashes: z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .min(1)
        .max(8),
      decision: z.literal("retain-canonical"),
      evidenceRef: evidence,
      confirmExternalReview: z.literal(true),
    })
    .strict();
  const gap = z
    .object({
      expectedGapVersion: version,
      expectedOwnerId: uuid.nullable(),
      expectedOwnerEpoch: version,
      evidenceRef: evidence,
      confirmHistoryReviewed: z.literal(true),
    })
    .strict();
  const fence = z
    .object({
      expectedOwnerId: uuid,
      expectedEpoch: version,
      evidenceRef: evidence,
      acknowledgeExternalFence: z.literal(true),
    })
    .strict();
  app.post("/api/provider/operations/confirm-part", async (req: any) =>
    secured(req, (db) =>
      confirmUnknownPart(db, req.staff, confirm.parse(req.body)),
    ),
  );
  app.post("/api/provider/operations/resolve-conflict", async (req: any) =>
    secured(req, async (db) => {
      await resolveKnownConflict(db, req.staff, conflict.parse(req.body));
      return { ok: true };
    }),
  );
  app.post("/api/provider/operations/ack-gap", async (req: any) =>
    secured(req, async (db) => {
      await acknowledgeProviderGap(db, req.staff, gap.parse(req.body));
      return { ok: true };
    }),
  );
  app.post("/api/provider/operations/ack-fence", async (req: any) =>
    secured(req, async (db) => {
      const body = fence.parse(req.body);
      try {
        await acknowledgeConnectorFence(db, req.staff, body);
      } catch {
        fail(409, "Connector fencing state changed or is blocked");
      }
      return { ok: true };
    }),
  );
}
