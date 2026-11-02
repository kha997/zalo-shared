import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT } from "../../server/db.js";
import { reservePilotPart } from "../../server/pilot-budget.js";
import type { PilotGrant } from "../../server/pilot-policy.js";

const grant = (overrides: Partial<PilotGrant> = {}): PilotGrant =>
  Object.freeze({
    version: 1,
    grantId: "grant-budget-1",
    purpose: "send-test",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    ownerConsentRef: "owner-consent-1",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: "zalo-uid-1",
    allowedPeerIds: ["peer-a", "peer-b", "peer-c", "peer-d"],
    maxPartsPerDay: 30,
    minIntervalMs: 2000,
    ...overrides,
  });

async function transaction<T>(
  client: pg.PoolClient,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
const reserve = async (
  pool: pg.Pool,
  g: PilotGrant,
  input: { messageId: string; part: number; peerId: string; threadType: 0 },
) => {
  const client = await pool.connect();
  try {
    return await transaction(client, () => reservePilotPart(client, g, input));
  } finally {
    client.release();
  }
};
async function seed(
  pool: pg.Pool,
  options: {
    peer?: string;
    account?: string;
    threadType?: 0 | 1;
    direction?: "inbound" | "outbound";
    part?: number;
    partStatus?: string;
  } = {},
) {
  const {
    peer = "peer-a",
    account = ACCOUNT,
    threadType = 0,
    direction = "outbound",
    part = 0,
    partStatus = "pending",
  } = options;
  const cid = (
    await pool.query(
      "INSERT INTO conversations(account_id,contact_id,contact_name,provider_thread_type,provider_thread_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [account, `zalo:${randomUUID()}`, "Synthetic peer", threadType, peer],
    )
  ).rows[0].id;
  const mid = (
    await pool.query(
      "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,$2,'synthetic pilot body','pending') RETURNING id",
      [cid, direction],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,$2,$3)",
    [mid, part, partStatus],
  );
  return { cid, mid };
}
const budget = async (pool: pg.Pool) =>
  (
    await pool.query(
      "SELECT max_parts,reserved_parts FROM pilot_send_budget WHERE account_id=$1",
      [ACCOUNT],
    )
  ).rows[0];
const ledger = async (pool: pg.Pool) =>
  (
    await pool.query(
      "SELECT account_id,to_char(day,'YYYY-MM-DD') AS day,message_id,part,grant_id,peer_id,reserved_at FROM pilot_part_ledger WHERE account_id=$1 ORDER BY message_id,part",
      [ACCOUNT],
    )
  ).rows;

test("a verified repeat reserves once and consumes no additional budget", async () => {
  const database = await isolatedDatabase();
  try {
    const { mid } = await seed(database.pool);
    const input = {
      messageId: mid,
      part: 0,
      peerId: "peer-a",
      threadType: 0 as const,
    };
    await reserve(database.pool, grant(), input);
    assert.deepEqual(await budget(database.pool), {
      max_parts: 30,
      reserved_parts: 1,
    });
    const first = (await ledger(database.pool))[0];
    assert.equal(first.day, new Date().toISOString().slice(0, 10));
    assert.equal(first.grant_id, "grant-budget-1");
    assert.equal(first.peer_id, "peer-a");
    assert.deepEqual(
      await reserve(
        database.pool,
        grant({ grantId: "grant-budget-2", maxPartsPerDay: 10 }),
        input,
      ),
      { status: "already-reserved" },
    );
    assert.deepEqual(await budget(database.pool), {
      max_parts: 30,
      reserved_parts: 1,
    });
    assert.equal((await ledger(database.pool)).length, 1);
    assert.equal(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='pilot.part_reserved'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await database.close();
  }
});

test("simultaneous reservations share one durable interval and day counter", async () => {
  const database = await isolatedDatabase();
  try {
    const seeds = await Promise.all(
      ["peer-a", "peer-b", "peer-c", "peer-d"].map((peer) =>
        seed(database.pool, { peer }),
      ),
    );
    const results = await Promise.allSettled(
      seeds.map((s, i) =>
        reserve(database.pool, grant(), {
          messageId: s.mid,
          part: 0,
          peerId: ["peer-a", "peer-b", "peer-c", "peer-d"][i],
          threadType: 0,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 3);
    assert.deepEqual(await budget(database.pool), {
      max_parts: 30,
      reserved_parts: 1,
    });
    assert.equal((await ledger(database.pool)).length, 1);
    await database.pool.query(
      "UPDATE pilot_send_budget SET last_reserved_at=now()-interval '3 seconds' WHERE account_id=$1",
      [ACCOUNT],
    );
    const next = seeds.find((_, i) => results[i].status === "rejected")!;
    const nextPeer = ["peer-a", "peer-b", "peer-c", "peer-d"][
      results.findIndex((r) => r.status === "rejected")
    ];
    await reserve(database.pool, grant(), {
      messageId: next.mid,
      part: 0,
      peerId: nextPeer,
      threadType: 0,
    });
    assert.deepEqual(await budget(database.pool), {
      max_parts: 30,
      reserved_parts: 2,
    });
  } finally {
    await database.close();
  }
});

test("quota exhaustion is durable and a new grant cannot raise the day cap", async () => {
  const database = await isolatedDatabase();
  try {
    const seeds = await Promise.all(
      ["peer-a", "peer-b", "peer-c"].map((peer) =>
        seed(database.pool, { peer }),
      ),
    );
    const g = grant({ maxPartsPerDay: 2, allowedPeerIds: ["peer-a", "peer-b", "peer-c"] });
    for (const [index, peer] of ["peer-a", "peer-b"].entries()) {
      if (index) {
        await database.pool.query(
          "UPDATE pilot_send_budget SET last_reserved_at=now()-interval '3 seconds' WHERE account_id=$1",
          [ACCOUNT],
        );
      }
      await reserve(database.pool, g, {
        messageId: seeds[index].mid,
        part: 0,
        peerId: peer,
        threadType: 0,
      });
    }
    assert.deepEqual(await budget(database.pool), {
      max_parts: 2,
      reserved_parts: 2,
    });
    await database.pool.query(
      "UPDATE pilot_send_budget SET last_reserved_at=now()-interval '3 seconds' WHERE account_id=$1",
      [ACCOUNT],
    );
    await assert.rejects(
      () =>
        reserve(database.pool, grant({ maxPartsPerDay: 10 }), {
          messageId: seeds[2].mid,
          part: 0,
          peerId: "peer-c",
          threadType: 0,
        }),
      /Pilot send budget unavailable/,
    );
    assert.deepEqual(await budget(database.pool), {
      max_parts: 2,
      reserved_parts: 2,
    });
    assert.equal((await ledger(database.pool)).length, 2);
  } finally {
    await database.close();
  }
});

test("a prior reservation stays consumed across a day and grant boundary", async () => {
  const database = await isolatedDatabase();
  try {
    const { mid } = await seed(database.pool);
    await reserve(database.pool, grant(), {
      messageId: mid,
      part: 0,
      peerId: "peer-a",
      threadType: 0,
    });
    await database.pool.query(
      "UPDATE pilot_send_budget SET day=day-1 WHERE account_id=$1",
      [ACCOUNT],
    );
    await database.pool.query(
      "UPDATE pilot_part_ledger SET day=day-1 WHERE account_id=$1",
      [ACCOUNT],
    );
    assert.deepEqual(
      await reserve(database.pool, grant({ grantId: "grant-budget-2" }), {
        messageId: mid,
        part: 0,
        peerId: "peer-a",
        threadType: 0,
      }),
      { status: "already-reserved" },
    );
    const rows = await ledger(database.pool);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].grant_id, "grant-budget-1");
    assert.notEqual(rows[0].day, new Date().toISOString().slice(0, 10));
    assert.equal(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM pilot_send_budget WHERE account_id=$1 AND day=(now() AT TIME ZONE 'utc')::date",
          [ACCOUNT],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      () =>
        reserve(database.pool, grant(), {
          messageId: mid,
          part: 0,
          peerId: "peer-b",
          threadType: 0,
        }),
      /Pilot send budget unavailable/,
    );
  } finally {
    await database.close();
  }
});

test("the minimum interval survives a UTC day rollover", async () => {
  const database = await isolatedDatabase();
  try {
    const first = await seed(database.pool, { peer: "peer-a" });
    await reserve(database.pool, grant(), {
      messageId: first.mid,
      part: 0,
      peerId: "peer-a",
      threadType: 0,
    });
    await database.pool.query(
      "UPDATE pilot_send_budget SET day=day-1 WHERE account_id=$1",
      [ACCOUNT],
    );
    await database.pool.query(
      "UPDATE pilot_part_ledger SET day=day-1 WHERE account_id=$1",
      [ACCOUNT],
    );
    const second = await seed(database.pool, { peer: "peer-b" });
    await assert.rejects(
      () =>
        reserve(database.pool, grant(), {
          messageId: second.mid,
          part: 0,
          peerId: "peer-b",
          threadType: 0,
        }),
      /Pilot send budget unavailable/,
    );
    assert.equal((await ledger(database.pool)).length, 1);
    await database.pool.query(
      "UPDATE pilot_send_budget SET last_reserved_at=last_reserved_at-interval '3 seconds' WHERE account_id=$1",
      [ACCOUNT],
    );
    assert.deepEqual(
      await reserve(database.pool, grant(), {
        messageId: second.mid,
        part: 0,
        peerId: "peer-b",
        threadType: 0,
      }),
      { status: "reserved" },
    );
    assert.equal((await ledger(database.pool)).length, 2);
  } finally {
    await database.close();
  }
});

test("accepted or ambiguous repeats never look freshly reserved", async () => {
  const database = await isolatedDatabase();
  try {
    const { mid } = await seed(database.pool);
    const input = {
      messageId: mid,
      part: 0,
      peerId: "peer-a",
      threadType: 0 as const,
    };
    await reserve(database.pool, grant(), input);
    await database.pool.query(
      "UPDATE delivery_parts SET status='sent' WHERE message_id=$1 AND part=0",
      [mid],
    );
    await assert.rejects(
      () => reserve(database.pool, grant(), input),
      /Pilot send budget unavailable/,
    );
    assert.deepEqual(await budget(database.pool), {
      max_parts: 30,
      reserved_parts: 1,
    });
    assert.equal((await ledger(database.pool)).length, 1);
  } finally {
    await database.close();
  }
});

test("malformed, foreign, non-direct and non-outbound jobs never reserve", async () => {
  const database = await isolatedDatabase();
  try {
    const normal = await seed(database.pool, { part: 0 });
    const group = await seed(database.pool, { peer: "peer-b", threadType: 1 });
    const inbound = await seed(database.pool, {
      peer: "peer-c",
      direction: "inbound",
    });
    const foreign = await seed(database.pool, {
      peer: "peer-d",
      account: randomUUID(),
    });
    const sent = await seed(database.pool, {
      peer: "peer-e",
      part: 0,
      partStatus: "sent",
    });
    const base = { part: 0, peerId: "peer-a", threadType: 0 as const };
    const cases: Array<() => Promise<unknown>> = [
      () =>
        reserve(database.pool, grant(), { ...base, messageId: group.mid }),
      () =>
        reserve(database.pool, grant(), { ...base, messageId: inbound.mid }),
      () =>
        reserve(database.pool, grant(), {
          ...base,
          messageId: foreign.mid,
          peerId: "peer-d",
        }),
      () =>
        reserve(
          database.pool,
          grant({ allowedPeerIds: ["peer-a", "peer-e"] }),
          { ...base, messageId: sent.mid, peerId: "peer-e" },
        ),
      () =>
        reserve(database.pool, grant(), {
          ...base,
          messageId: normal.mid,
          part: 1,
        }),
      () =>
        reserve(database.pool, grant({ purpose: "observe" }), {
          ...base,
          messageId: normal.mid,
        }),
      () =>
        reserve(
          database.pool,
          grant({ allowedPeerIds: ["peer-b"] }),
          { ...base, messageId: normal.mid },
        ),
      () =>
        reserve(database.pool, grant(), {
          ...base,
          messageId: normal.mid,
          peerId: "peer-z",
        }),
      () =>
        reserve(database.pool, grant(), {
          ...base,
          messageId: normal.mid,
          threadType: 1 as 0,
        }),
      () =>
        reserve(database.pool, grant(), {
          ...base,
          messageId: normal.mid,
          part: 10001,
        }),
    ];
    for (const run of cases)
      await assert.rejects(run, /Pilot send budget unavailable/);
    assert.equal(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM pilot_send_budget",
        )
      ).rows[0].n,
      0,
    );
    assert.equal((await ledger(database.pool)).length, 0);
  } finally {
    await database.close();
  }
});

test("reservation requires a caller transaction and an unexpired grant", async () => {
  const database = await isolatedDatabase();
  try {
    const { mid } = await seed(database.pool);
    const input = {
      messageId: mid,
      part: 0,
      peerId: "peer-a",
      threadType: 0 as const,
    };
    const client = await database.pool.connect();
    try {
      await assert.rejects(
        () => reservePilotPart(client, grant(), input),
        /Pilot send budget unavailable/,
      );
    } finally {
      client.release();
    }
    const spoof = await database.pool.connect();
    try {
      await spoof.query("SET SESSION zalo.pilot_budget_transaction='active'");
      await assert.rejects(
        () => reservePilotPart(spoof, grant(), input),
        /Pilot send budget unavailable/,
      );
    } finally {
      await spoof
        .query("RESET zalo.pilot_budget_transaction")
        .catch(() => {});
      spoof.release();
    }
    await assert.rejects(
      () =>
        reserve(
          database.pool,
          grant({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
          input,
        ),
      /Pilot send budget unavailable/,
    );
    assert.equal(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM pilot_send_budget",
        )
      ).rows[0].n,
      0,
    );
    assert.equal((await ledger(database.pool)).length, 0);
  } finally {
    await database.close();
  }
});
