import test from "node:test";
import assert from "node:assert/strict";
import { recordProviderFault } from "../../server/provider-faults.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT, migrate } from "../../server/db.js";

test("fault boundary validates fixed codes and preserves decimal bigint versions", async () => {
  let calls = 0;
  const db = {
    async query(sql: string) {
      calls++;
      return {
        rows: sql.includes("current_setting")
          ? [{ marker: "active" }]
          : [{ gap_version: "9007199254740993" }],
        rowCount: 1,
      };
    },
  } as any;
  await assert.rejects(recordProviderFault(db, "secret-provider-error" as any));
  assert.equal(calls, 0);
  assert.deepEqual(await recordProviderFault(db, "connection-lost"), {
    gapVersion: "9007199254740993",
  });
  await assert.rejects(
    recordProviderFault(
      { query: async () => ({ rows: [{}] }) } as any,
      "connection-lost",
    ),
  );
  for (const version of [0, "01", "-1", "9223372036854775808", undefined]) {
    await assert.rejects(
      recordProviderFault(
        {
          async query(sql: string) {
            return {
              rowCount: 1,
              rows: [
                sql.includes("current_setting")
                  ? { marker: "active" }
                  : { gap_version: version },
              ],
            };
          },
        } as any,
        "connection-lost",
      ),
      /Provider fault unavailable/,
    );
  }
});

test("provider conflicts preserve bounded variants, reopen resolutions and retain canonical evidence", async () => {
  const d = await isolatedDatabase();
  const event = {
    threadType: 0 as const,
    threadId: "variants",
    providerId: "same-id",
    senderId: "peer",
    isSelf: false,
    kind: "text" as const,
    text: "canonical",
  };
  try {
    const first = await ingestProviderEvent(d.pool, event);
    await ingestProviderEvent(d.pool, { ...event, text: "variant-1" });
    await ingestProviderEvent(d.pool, { ...event, text: "variant-2" });
    const row = async () =>
      (
        await d.pool.query("SELECT * FROM provider_events WHERE id=$1", [
          first.eventId,
        ])
      ).rows[0];
    assert.equal((await row()).text, "canonical");
    assert.equal((await row()).resolution_version, "2");
    assert.equal(
      (
        await d.pool.query(
          "SELECT count(*)::int n FROM provider_event_variants",
        )
      ).rows[0].n,
      2,
    );
    const before = (
      await d.pool.query("SELECT gap_version FROM provider_state")
    ).rows[0].gap_version;
    await ingestProviderEvent(d.pool, { ...event, text: "variant-1" });
    assert.equal((await row()).resolution_version, "2");
    assert.equal(
      BigInt(
        (await d.pool.query("SELECT gap_version FROM provider_state")).rows[0]
          .gap_version,
      ),
      BigInt(before) + 1n,
    );
    // Synthetic representation of Task2's explicit external-review resolution.
    await d.pool.query(
      "UPDATE provider_events SET resolved_at=now(),resolution_ref='synthetic-reviewed' WHERE id=$1",
      [first.eventId],
    );
    await d.pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false",
    );
    for (const text of [event.text, "variant-1", "variant-2"])
      await ingestProviderEvent(d.pool, { ...event, text });
    assert.equal(
      (await d.pool.query("SELECT reconciliation_required FROM provider_state"))
        .rows[0].reconciliation_required,
      false,
    );
    await ingestProviderEvent(d.pool, { ...event, text: "variant-3" });
    assert.equal((await row()).resolved_at, null);
    assert.equal((await row()).resolution_ref, null);
    assert.equal((await row()).resolution_version, "3");
    for (let i = 4; i <= 9; i++)
      await ingestProviderEvent(d.pool, { ...event, text: `variant-${i}` });
    assert.equal(
      (
        await d.pool.query(
          "SELECT count(*)::int n FROM provider_event_variants",
        )
      ).rows[0].n,
      8,
    );
    assert.equal((await row()).variant_overflow, true);
    assert.equal((await row()).overflow_receipts, "1");
    await ingestProviderEvent(d.pool, { ...event, text: "variant-9" });
    assert.equal((await row()).overflow_receipts, "2");
    assert.equal((await row()).text, event.text);
    assert.equal(
      (
        await d.pool.query("SELECT text FROM messages WHERE id=$1", [
          first.messageId,
        ])
      ).rows[0].text,
      event.text,
    );
    await migrate(d.pool);
    assert.equal((await row()).variant_evidence_missing, false);
    assert.equal((await row()).variant_overflow, true);
    const legacy = await ingestProviderEvent(d.pool, {
      ...event,
      providerId: "legacy-id",
    });
    await d.pool.query(
      "UPDATE provider_events SET conflict=true,state='conflict' WHERE id=$1",
      [legacy.eventId],
    );
    await migrate(d.pool);
    await ingestProviderEvent(d.pool, {
      ...event,
      providerId: "legacy-id",
      text: "later-evidence",
    });
    assert.equal(
      (
        await d.pool.query(
          "SELECT variant_evidence_missing FROM provider_events WHERE id=$1",
          [legacy.eventId],
        )
      ).rows[0].variant_evidence_missing,
      true,
    );
    const exhausted = await ingestProviderEvent(d.pool, {
      ...event,
      providerId: "resolution-exhausted",
    });
    await d.pool.query(
      "UPDATE provider_events SET resolution_version=9223372036854775806 WHERE id=$1",
      [exhausted.eventId],
    );
    await ingestProviderEvent(d.pool, {
      ...event,
      providerId: "resolution-exhausted",
      text: "ceiling-variant",
    });
    assert.deepEqual(
      (
        await d.pool.query(
          "SELECT resolution_version,variant_overflow FROM provider_events WHERE id=$1",
          [exhausted.eventId],
        )
      ).rows[0],
      { resolution_version: "9223372036854775807", variant_overflow: true },
    );
    const concurrent = await ingestProviderEvent(d.pool, {
      ...event,
      providerId: "concurrent-variants",
    });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        ingestProviderEvent(d.pool, {
          ...event,
          providerId: "concurrent-variants",
          text: `concurrent-${i}`,
        }),
      ),
    );
    assert.equal(
      (
        await d.pool.query(
          "SELECT count(*)::int n FROM provider_event_variants WHERE event_id=$1",
          [concurrent.eventId],
        )
      ).rows[0].n,
      8,
    );
    assert.deepEqual(
      (
        await d.pool.query(
          "SELECT text,variant_overflow,overflow_receipts FROM provider_events WHERE id=$1",
          [concurrent.eventId],
        )
      ).rows[0],
      {
        text: "canonical",
        variant_overflow: true,
        overflow_receipts: "22",
      },
    );
  } finally {
    await d.close();
  }
});

test("fault increments serialize against a stale acknowledgement and require an explicit transaction", async () => {
  const d = await isolatedDatabase();
  const a = await d.pool.connect(),
    b = await d.pool.connect();
  try {
    await assert.rejects(
      recordProviderFault(a, "connection-lost"),
      /transaction/,
    );
    await a.query("BEGIN");
    await a.query(
      "UPDATE provider_state SET gap_version=9007199254740992 WHERE account_id=$1",
      [ACCOUNT],
    );
    assert.deepEqual(await recordProviderFault(a, "connection-lost"), {
      gapVersion: "9007199254740993",
    });
    await a.query("COMMIT");
    const stale = "9007199254740993";
    await a.query("BEGIN");
    await recordProviderFault(a, "connection-lost");
    await b.query("BEGIN");
    const ack = b.query(
      "UPDATE provider_state SET reconciliation_required=false WHERE account_id=$1 AND gap_version=$2 RETURNING gap_version",
      [ACCOUNT, stale],
    );
    await a.query("COMMIT");
    assert.equal((await ack).rowCount, 0);
    await b.query("COMMIT");
    assert.equal(
      (await d.pool.query("SELECT reconciliation_required FROM provider_state"))
        .rows[0].reconciliation_required,
      true,
    );
    await a.query("BEGIN");
    await a.query(
      "UPDATE provider_state SET gap_version=9223372036854775807,reconciliation_required=false",
    );
    assert.deepEqual(await recordProviderFault(a, "connection-lost"), {
      gapVersion: "9223372036854775807",
    });
    await a.query("COMMIT");
    assert.deepEqual(
      (
        await d.pool.query(
          "SELECT gap_version,fault_code,reconciliation_required FROM provider_state",
        )
      ).rows[0],
      {
        gap_version: "9223372036854775807",
        fault_code: "version-exhausted",
        reconciliation_required: true,
      },
    );
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await b.query("ROLLBACK").catch(() => {});
    a.release();
    b.release();
    await d.close();
  }
});
