import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT } from "../../server/db.js";
import {
  createSdkProvider,
  type TextTransport,
} from "../../adapters/zalo/provider.js";
import {
  ProviderNotDispatchedError,
  ProviderReservationConsumedError,
  runWorkerOnce,
} from "../../server/worker.js";
import type { PilotGrant } from "../../server/pilot-policy.js";
import {
  bindPilotSession,
  runPilotLoop,
  type PilotConnector,
} from "../../tools/pilot-runtime.js";
import { G5_SESSION_LIMIT_MS } from "../../tools/g5-policy.js";

const sentinelUid = "zalo-uid-pilot-1";
const grant = (overrides: Partial<PilotGrant> = {}): PilotGrant =>
  Object.freeze({
    version: 1,
    grantId: "grant-flow-1",
    purpose: "send-test",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
    ownerConsentRef: "owner-consent-1",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: sentinelUid,
    allowedPeerIds: ["peer-a", "peer-b"],
    maxPartsPerDay: 30,
    minIntervalMs: 2000,
    ...overrides,
  });

type DeliveryResult =
  | { status: "sent"; providerId: string }
  | { status: "failed" | "unknown" };

function transport(result: DeliveryResult = { status: "sent", providerId: "sdk-1" }) {
  const calls: Array<{ peer: string; text: string; type?: number }> = [];
  const value: TextTransport & { calls: typeof calls } = {
    calls,
    status: "connected",
    async sendText(peer, text, type) {
      calls.push({ peer, text, type });
      return result;
    },
  };
  return value;
}

const owner = (admitted = true) => ({
  admitted,
  async assertCurrent() {},
});

async function seed(
  pool: pg.Pool,
  options: {
    peer?: string;
    threadType?: 0 | 1;
    outbox?: boolean;
    text?: string;
  } = {},
) {
  const {
    peer = "peer-a",
    threadType = 0,
    outbox = false,
    text = "synthetic pilot body",
  } = options;
  const cid = (
    await pool.query(
      "INSERT INTO conversations(account_id,contact_id,contact_name,provider_thread_type,provider_thread_id) VALUES($1,$2,'Synthetic peer',$3,$4) RETURNING id",
      [ACCOUNT, `zalo:${randomUUID()}`, threadType, peer],
    )
  ).rows[0].id;
  const mid = (
    await pool.query(
      "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound',$2,'pending') RETURNING id",
      [cid, text],
    )
  ).rows[0].id;
  if (outbox)
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
  await pool.query(
    "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,0,'pending')",
    [mid],
  );
  await pool.query(
    "UPDATE provider_state SET status='connected',reconciliation_required=false WHERE account_id=$1",
    [ACCOUNT],
  );
  return { cid, mid };
}

async function prepare(pool: pg.Pool, provider: ReturnType<typeof createSdkProvider>, id: string) {
  const client = await pool.connect();
  try {
    await provider.prepareMessage!(id, client);
  } finally {
    client.release();
  }
}

async function send(
  pool: pg.Pool,
  provider: ReturnType<typeof createSdkProvider>,
  id: string,
) {
  const client = await pool.connect();
  try {
    return await provider.sendPart(id, 0, client);
  } finally {
    client.release();
  }
}

const ledgerCount = async (pool: pg.Pool) =>
  (await pool.query("SELECT count(*)::int AS count FROM pilot_part_ledger")).rows[0]
    .count;

test("an allowlisted direct peer is reserved before one egress and persisted", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    const { mid } = await seed(database.pool);
    await prepare(database.pool, provider, mid);
    assert.equal(await send(database.pool, provider, mid), "sdk-1");
    assert.deepEqual(transportSpy.calls, [
      { peer: "peer-a", text: "synthetic pilot body", type: 0 },
    ]);
    assert.equal(await ledgerCount(database.pool), 1);
    const budget = (
      await database.pool.query(
        "SELECT reserved_parts,max_parts FROM pilot_send_budget WHERE account_id=$1",
        [ACCOUNT],
      )
    ).rows[0];
    assert.deepEqual(budget, { reserved_parts: 1, max_parts: 30 });
  } finally {
    await database.close();
  }
});

test("non-allowlisted peers and group threads are refused before egress", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    for (const options of [
      { peer: "peer-z" },
      { peer: "peer-a", threadType: 1 as const },
    ]) {
      const { mid } = await seed(database.pool, options);
      await assert.rejects(
        prepare(database.pool, provider, mid),
        ProviderNotDispatchedError,
      );
    }
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(await ledgerCount(database.pool), 0);
  } finally {
    await database.close();
  }
});

test("the scoped worker never claims or fails mail outside the grant peers", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    // The out-of-scope row is older, so an unscoped claim would touch it first.
    const outside = await seed(database.pool, {
      peer: "peer-z",
      outbox: true,
    });
    const inside = await seed(database.pool, { peer: "peer-a", outbox: true });
    await runWorkerOnce(database.pool, provider, { peers: ["peer-a"] });
    assert.deepEqual(transportSpy.calls, [
      { peer: "peer-a", text: "synthetic pilot body", type: 0 },
    ]);
    assert.deepEqual(
      (
        await database.pool.query(
          "SELECT m.status AS message,m2.status AS outbox FROM messages m JOIN outbox m2 ON m2.message_id=m.id WHERE m.id=$1",
          [outside.mid],
        )
      ).rows[0],
      { message: "pending", outbox: "pending" },
    );
    assert.equal(
      (
        await database.pool.query(
          "SELECT status FROM messages WHERE id=$1",
          [inside.mid],
        )
      ).rows[0].status,
      "sent",
    );
  } finally {
    await database.close();
  }
});

test("an empty or malformed worker scope is refused instead of widening the claim", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    const { mid } = await seed(database.pool, { outbox: true });
    for (const scope of [
      { peers: [] },
      { peers: [""] },
      { peers: ["peer-a", "peer-a"] },
      { peers: ["bad peer"] },
      {} as never,
      null as never,
    ])
      await assert.rejects(
        runWorkerOnce(database.pool, provider, scope),
        /Worker scope must list exact direct peers/,
      );
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(
      (
        await database.pool.query(
          "SELECT status FROM outbox WHERE message_id=$1",
          [mid],
        )
      ).rows[0].status,
      "pending",
    );
  } finally {
    await database.close();
  }
});

test("a scoped worker quarantines only interrupted mail inside its exact peers", async () => {
  const database = await isolatedDatabase();
  try {
    const outside = await seed(database.pool, {
      peer: "peer-z",
      outbox: true,
    });
    const inside = await seed(database.pool, { peer: "peer-a", outbox: true });
    const ids = [outside.mid, inside.mid];
    await database.pool.query(
      "UPDATE outbox SET status='processing' WHERE message_id=ANY($1::uuid[])",
      [ids],
    );
    await database.pool.query(
      "UPDATE messages SET status='processing' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    await database.pool.query(
      "UPDATE delivery_parts SET status='processing' WHERE message_id=ANY($1::uuid[])",
      [ids],
    );
    const result = await runWorkerOnce(
      database.pool,
      {
        async connected() {
          return false;
        },
        async sendPart() {
          throw new Error("must not dispatch");
        },
      },
      { peers: ["peer-a"] },
    );
    assert.deepEqual(result, { processed: false });
    const statuses = (id: string) =>
      database.pool
        .query(
          "SELECT m.status AS message,o.status AS outbox,p.status AS part FROM messages m JOIN outbox o ON o.message_id=m.id JOIN delivery_parts p ON p.message_id=m.id WHERE m.id=$1",
          [id],
        )
        .then((r) => r.rows[0]);
    assert.deepEqual(await statuses(inside.mid), {
      message: "unknown",
      outbox: "unknown",
      part: "unknown",
    });
    assert.deepEqual(await statuses(outside.mid), {
      message: "processing",
      outbox: "processing",
      part: "processing",
    });
  } finally {
    await database.close();
  }
});

test("a deferred destination returns processed:false so the caller backs off", async () => {
  const database = await isolatedDatabase();
  try {
    const { mid } = await seed(database.pool, { outbox: true });
    let sends = 0;
    const result = await runWorkerOnce(database.pool, {
      async connected() {
        return true;
      },
      async prepareMessage() {
        throw new ProviderNotDispatchedError();
      },
      async sendPart() {
        sends++;
        return null;
      },
    });
    assert.deepEqual(result, { processed: false });
    assert.equal(sends, 0);
    assert.deepEqual(
      (
        await database.pool.query(
          "SELECT m.status AS message,o.status AS outbox,p.status AS part FROM messages m JOIN outbox o ON o.message_id=m.id JOIN delivery_parts p ON p.message_id=m.id WHERE m.id=$1",
          [mid],
        )
      ).rows[0],
      { message: "pending", outbox: "pending", part: "pending" },
    );
  } finally {
    await database.close();
  }
});

test("a grant that allowlists the bound account cannot construct a provider", () => {
  assert.throws(
    () =>
      createSdkProvider({} as never, transport(), owner(), {
        grant: grant({ allowedPeerIds: [sentinelUid] }),
        now: () => new Date(),
      }),
    /Pilot dispatch unavailable/,
  );
});

test("an expired grant halts dispatch before reservation or egress", async () => {
  const database = await isolatedDatabase();
  try {
    const halts: string[] = [];
    const expired = grant({
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: expired, onHalt: (reason) => halts.push(reason) },
    );
    const { mid } = await seed(database.pool);
    await assert.rejects(
      prepare(database.pool, provider, mid),
      ProviderNotDispatchedError,
    );
    assert.deepEqual(halts, ["grant-expired"]);
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(await ledgerCount(database.pool), 0);
  } finally {
    await database.close();
  }
});

test("a lost owner prevents reservation and dispatch", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(database.pool, transportSpy, owner(false), {
      grant: grant(),
      now: () => new Date(),
    });
    const { mid } = await seed(database.pool);
    await prepare(database.pool, provider, mid);
    await assert.rejects(send(database.pool, provider, mid), ProviderNotDispatchedError);
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(await ledgerCount(database.pool), 0);
  } finally {
    await database.close();
  }
});

test("a known failed dispatch consumes budget but is never automatically resent", async () => {
  const database = await isolatedDatabase();
  try {
    const halts: string[] = [];
    const transportSpy = transport({ status: "failed" });
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), onHalt: (reason) => halts.push(reason) },
    );
    const { mid } = await seed(database.pool);
    await prepare(database.pool, provider, mid);
    await assert.rejects(send(database.pool, provider, mid), ProviderNotDispatchedError);
    assert.equal(transportSpy.calls.length, 1);
    assert.equal(await ledgerCount(database.pool), 1);
    await database.pool.query(
      "UPDATE delivery_parts SET status='pending' WHERE message_id=$1",
      [mid],
    );
    // The durable reservation is spent: retrying must fail terminally rather
    // than resend, and must not halt the whole pilot.
    await assert.rejects(
      send(database.pool, provider, mid),
      ProviderReservationConsumedError,
    );
    assert.equal(transportSpy.calls.length, 1);
    assert.deepEqual(halts, []);
  } finally {
    await database.close();
  }
});

test("a stale reservation fails one row and never wedges later outbound work", async () => {
  const database = await isolatedDatabase();
  try {
    const calls: string[] = [];
    let outcome: DeliveryResult = { status: "failed" };
    const transportSpy: TextTransport = {
      status: "connected",
      async sendText(peer) {
        calls.push(peer);
        return outcome;
      },
    };
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    await database.pool.query(
      "UPDATE provider_state SET status='connected' WHERE account_id=$1",
      [ACCOUNT],
    );
    const first = await seed(database.pool, { outbox: true });
    const second = await seed(database.pool, { outbox: true, peer: "peer-b" });
    // Pin claim order so the head row is unambiguous.
    await database.pool.query(
      "UPDATE outbox SET created_at=now()-interval '2 seconds' WHERE message_id=$1",
      [first.mid],
    );
    await database.pool.query(
      "UPDATE outbox SET created_at=now()-interval '1 second' WHERE message_id=$1",
      [second.mid],
    );
    // First tick reserves and attempts part 0; the transport reports a known
    // non-dispatch, so the worker returns the row to pending.
    assert.deepEqual(await runWorkerOnce(database.pool, provider), {
      processed: false,
    });
    assert.equal(calls.length, 1);
    // Second tick re-selects the same head row, finds its reservation spent and
    // must fail it terminally without a second egress.
    assert.deepEqual(await runWorkerOnce(database.pool, provider), {
      processed: true,
    });
    assert.equal(calls.length, 1);
    const firstState = (
      await database.pool.query(
        "SELECT m.status AS message,o.status AS outbox,p.status AS part FROM messages m JOIN outbox o ON o.message_id=m.id JOIN delivery_parts p ON p.message_id=m.id WHERE m.id=$1",
        [first.mid],
      )
    ).rows[0];
    assert.deepEqual(firstState, {
      message: "failed",
      outbox: "failed",
      part: "failed",
    });
    // Later work is not starved: the next tick can reserve and send.
    await database.pool.query(
      "UPDATE pilot_send_budget SET last_reserved_at=now()-interval '10 seconds'",
    );
    outcome = { status: "sent", providerId: "sdk-2" };
    assert.deepEqual(await runWorkerOnce(database.pool, provider), {
      processed: true,
    });
    assert.equal(calls.length, 2);
    assert.equal(
      (
        await database.pool.query("SELECT status FROM messages WHERE id=$1", [
          second.mid,
        ])
      ).rows[0].status,
      "sent",
    );
  } finally {
    await database.close();
  }
});

test("an ambiguous result consumes budget and a repeat is not dispatched", async () => {
  const database = await isolatedDatabase();
  try {
    const halts: string[] = [];
    const transportSpy = transport({ status: "unknown" });
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), onHalt: (reason) => halts.push(reason) },
    );
    const { mid } = await seed(database.pool);
    await prepare(database.pool, provider, mid);
    await assert.rejects(
      send(database.pool, provider, mid),
      /Provider execution uncertain/,
    );
    await assert.rejects(send(database.pool, provider, mid), ProviderReservationConsumedError);
    assert.equal(transportSpy.calls.length, 1);
    assert.equal(await ledgerCount(database.pool), 1);
    assert.deepEqual(halts, ["dispatch-uncertain"]);
  } finally {
    await database.close();
  }
});

test("an exhausted daily quota blocks the next part without egress", async () => {
  const database = await isolatedDatabase();
  try {
    const halts: string[] = [];
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      {
        grant: grant({ maxPartsPerDay: 1 }),
        onHalt: (reason) => halts.push(reason),
      },
    );
    const first = await seed(database.pool, { peer: "peer-a" });
    await prepare(database.pool, provider, first.mid);
    await send(database.pool, provider, first.mid);
    await database.pool.query(
      "UPDATE pilot_send_budget SET last_reserved_at=now()-interval '10 seconds'",
    );
    const second = await seed(database.pool, { peer: "peer-b" });
    await prepare(database.pool, provider, second.mid);
    await assert.rejects(
      send(database.pool, provider, second.mid),
      ProviderNotDispatchedError,
    );
    assert.equal(transportSpy.calls.length, 1);
    assert.equal(await ledgerCount(database.pool), 1);
    assert.deepEqual(halts, ["reservation-denied"]);
  } finally {
    await database.close();
  }
});

test("one grant cannot exceed its part budget across a UTC day rollover", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant({ maxPartsPerDay: 1 }), now: () => new Date() },
    );
    const first = await seed(database.pool);
    await prepare(database.pool, provider, first.mid);
    await send(database.pool, provider, first.mid);
    // A fresh day resets the UTC-day budget, but the activated grant must not
    // regain parts. The interval is also cleared so only the grant cap can deny.
    await database.pool.query(
      "UPDATE pilot_send_budget SET day=day+1,last_reserved_at=now()-interval '10 seconds'",
    );
    const second = await seed(database.pool, { peer: "peer-b" });
    await prepare(database.pool, provider, second.mid);
    await assert.rejects(
      send(database.pool, provider, second.mid),
      ProviderNotDispatchedError,
    );
    assert.equal(transportSpy.calls.length, 1);
    assert.equal(await ledgerCount(database.pool), 1);
  } finally {
    await database.close();
  }
});

test("a text-only pilot refuses an outbound attachment before reservation or egress", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), textOnly: true, now: () => new Date() },
    );
    const { mid } = await seed(database.pool, { peer: "peer-a" });
    const attachmentId = (
      await database.pool.query(
        "INSERT INTO attachments(account_id,name,mime,data,message_id) VALUES($1,'synthetic.png','image/png',$2,$3) RETURNING id",
        [ACCOUNT, Buffer.from([0x89, 0x50, 0x4e, 0x47]), mid],
      )
    ).rows[0].id;
    await database.pool.query(
      "INSERT INTO delivery_parts(message_id,part,status,attachment_id) VALUES($1,1,'pending',$2)",
      [mid, attachmentId],
    );
    await assert.rejects(
      prepare(database.pool, provider, mid),
      /Unsupported SDK media/,
    );
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(await ledgerCount(database.pool), 0);
  } finally {
    await database.close();
  }
});

test("a pilot dispatch with no textOnly flag still refuses media by default", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    const { mid } = await seed(database.pool);
    const attachmentId = (
      await database.pool.query(
        "INSERT INTO attachments(account_id,name,mime,data,message_id) VALUES($1,'synthetic.png','image/png',$2,$3) RETURNING id",
        [ACCOUNT, Buffer.from([0x89, 0x50, 0x4e, 0x47]), mid],
      )
    ).rows[0].id;
    await database.pool.query(
      "INSERT INTO delivery_parts(message_id,part,status,attachment_id) VALUES($1,1,'pending',$2)",
      [mid, attachmentId],
    );
    await assert.rejects(
      prepare(database.pool, provider, mid),
      /Unsupported SDK media/,
    );
    assert.equal(transportSpy.calls.length, 0);
    assert.equal(await ledgerCount(database.pool), 0);
  } finally {
    await database.close();
  }
});

test("the reviewed worker path sends once and records the reservation", async () => {
  const database = await isolatedDatabase();
  try {
    const transportSpy = transport();
    const provider = createSdkProvider(
      database.pool,
      transportSpy,
      owner(),
      { grant: grant(), now: () => new Date() },
    );
    const { mid } = await seed(database.pool, { outbox: true });
    await database.pool.query(
      "UPDATE provider_state SET status='connected' WHERE account_id=$1",
      [ACCOUNT],
    );
    assert.deepEqual(await runWorkerOnce(database.pool, provider), {
      processed: true,
    });
    assert.equal(transportSpy.calls.length, 1);
    const state = (
      await database.pool.query(
        "SELECT m.status AS message,o.status AS outbox FROM messages m JOIN outbox o ON o.message_id=m.id WHERE m.id=$1",
        [mid],
      )
    ).rows[0];
    assert.deepEqual(state, { message: "sent", outbox: "sent" });
    assert.equal(await ledgerCount(database.pool), 1);
  } finally {
    await database.close();
  }
});

function fakeConnector() {
  const counts = {
    started: 0,
    stopped: 0,
    runs: 0,
    media: 0,
  };
  const connector: PilotConnector & { counts: typeof counts } = {
    counts,
    async start() {
      counts.started++;
    },
    async stop() {
      counts.stopped++;
    },
    async runOnce() {
      counts.runs++;
      return { processed: false };
    },
    async runMediaOnce() {
      counts.media++;
    },
  };
  return connector;
}

const observeGrant = (overrides: Partial<PilotGrant> = {}) =>
  grant({ purpose: "observe", allowedPeerIds: ["peer-a"], ...overrides });

test("observe never dispatches and always tears down the connector", async () => {
  const connector = fakeConnector();
  const result = await runPilotLoop({
    connector,
    mode: "observe",
    grant: observeGrant(),
    maxTicks: 3,
    tickMs: 0,
    sleep: async () => {},
  });
  assert.deepEqual(result, { halt: "tick-limit", ticks: 3, rejectedInbound: 0 });
  assert.deepEqual(connector.counts, {
    started: 1,
    stopped: 1,
    runs: 0,
    media: 0,
  });
});

test("send-test ticks the worker and stops when the grant expires", async () => {
  const connector = fakeConnector();
  const base = Date.now();
  let clock = base;
  const result = await runPilotLoop({
    connector,
    mode: "send-test",
    grant: grant({
      issuedAt: new Date(base - 60_000).toISOString(),
      expiresAt: new Date(base + 30 * 60 * 1000).toISOString(),
    }),
    maxTicks: 5,
    tickMs: 0,
    now: () => new Date(clock),
    sleep: async () => {
      clock += 60 * 60 * 1000;
    },
  });
  assert.deepEqual(result, {
    halt: "grant-expired",
    ticks: 1,
    rejectedInbound: 0,
  });
  assert.equal(connector.counts.runs, 1);
  assert.equal(connector.counts.stopped, 1);
});

test("a live session stops at the two-hour wall-clock limit", async () => {
  const connector = fakeConnector();
  const base = Date.now();
  let clock = base;
  const result = await runPilotLoop({
    connector,
    mode: "observe",
    grant: observeGrant({
      issuedAt: new Date(base - 60_000).toISOString(),
      expiresAt: new Date(base + 7 * 60 * 60 * 1000).toISOString(),
    }),
    maxTicks: 10,
    tickMs: 0,
    sessionLimitMs: G5_SESSION_LIMIT_MS,
    now: () => new Date(clock),
    sleep: async () => {
      clock += 60 * 60 * 1000;
    },
  });
  assert.deepEqual(result, {
    halt: "session-limit",
    ticks: 2,
    rejectedInbound: 0,
  });
  assert.equal(connector.counts.stopped, 1);
});

test("abort, worker errors and policy halts stop without retry", async () => {
  const aborted = new AbortController();
  aborted.abort();
  const first = fakeConnector();
  assert.deepEqual(
    await runPilotLoop({
      connector: first,
      mode: "send-test",
      grant: grant(),
      maxTicks: 5,
      tickMs: 0,
      signal: aborted.signal,
    }),
    { halt: "aborted", ticks: 0, rejectedInbound: 0 },
  );
  assert.equal(first.counts.runs, 0);
  assert.equal(first.counts.stopped, 1);

  const failing = fakeConnector();
  failing.runOnce = async () => {
    throw new Error("raw internal detail");
  };
  assert.deepEqual(
    await runPilotLoop({
      connector: failing,
      mode: "send-test",
      grant: grant(),
      maxTicks: 5,
      tickMs: 0,
    }),
    { halt: "runtime-error", ticks: 0, rejectedInbound: 0 },
  );
  assert.equal(failing.counts.stopped, 1);

  // A policy halt must win over the abort it triggered, so the command exits
  // non-zero instead of reporting a benign operator abort.
  const ambiguous = new AbortController();
  const racing = fakeConnector();
  racing.runOnce = async () => {
    ambiguous.abort();
    throw new Error("raw internal detail");
  };
  assert.deepEqual(
    await runPilotLoop({
      connector: racing,
      mode: "send-test",
      grant: grant(),
      maxTicks: 5,
      tickMs: 0,
      signal: ambiguous.signal,
      haltReason: () => "dispatch-uncertain",
    }),
    { halt: "dispatch-uncertain", ticks: 0, rejectedInbound: 0 },
  );
  assert.equal(racing.counts.stopped, 1);

  const halted = fakeConnector();
  assert.deepEqual(
    await runPilotLoop({
      connector: halted,
      mode: "send-test",
      grant: grant(),
      maxTicks: 5,
      tickMs: 0,
      haltReason: () => "already-reserved",
    }),
    { halt: "already-reserved", ticks: 1, rejectedInbound: 0 },
  );
  assert.equal(halted.counts.runs, 1);
  assert.equal(halted.counts.stopped, 1);
});

test("the loop refuses grants outside the bounded dispatch shape", async () => {
  const base = Date.now();
  for (const overrides of [
    { maxPartsPerDay: 31 },
    { maxPartsPerDay: 0 },
    { minIntervalMs: 1000 },
    { minIntervalMs: 60_001 },
    {
      issuedAt: new Date(base - 1000).toISOString(),
      expiresAt: new Date(base + 9 * 60 * 60 * 1000).toISOString(),
    },
    { expectedAccountId: null as unknown as string },
    { allowedPeerIds: [sentinelUid] },
  ]) {
    const connector = fakeConnector();
    await assert.rejects(
      runPilotLoop({
        connector,
        mode: "send-test",
        grant: grant(overrides),
        maxTicks: 1,
        tickMs: 0,
      }),
      /Pilot runtime unavailable/,
    );
    assert.equal(connector.counts.started, 0);
  }
});

test("the observe provider can never dispatch even if the worker calls it", async () => {
  const { createObserveProvider } = await import("../../tools/pilot-runtime.js");
  const provider = createObserveProvider();
  assert.equal(await provider.connected({} as never), false);
  assert.equal(provider.prepareMessage, undefined);
  await assert.rejects(provider.sendPart("synthetic", 0), ProviderNotDispatchedError);
});

test("runtime entry refuses non-Linux hosts and incomplete private configuration", async () => {
  const { startPilotRuntime } = await import("../../tools/pilot-runtime.js");
  const manifest = {
    version: 1,
    build: {
      sourceCommit: "a".repeat(40),
      lockSha256: "b".repeat(64),
      sdkIntegrity: "sha512-" + "c".repeat(64),
    },
    consent: {},
    grant: observeGrant(),
  } as never;
  const env = {
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    PILOT_KEY_FILE: "/private/key",
    PILOT_SESSION_FILE: "/private/session",
  };
  if (process.platform !== "linux") {
    await assert.rejects(
      startPilotRuntime({ command: "run-observe", manifest, env }),
      /Pilot runtime unavailable/,
    );
    return;
  }
  for (const input of [
    { command: "run-bogus", manifest, env },
    { command: "run-send-test", manifest, env },
    { command: "run-observe", manifest, env: { ...env, DATABASE_URL: "http://x" } },
    { command: "run-observe", manifest, env: { ...env, PILOT_KEY_FILE: "key" } },
    { command: "run-observe", manifest, env: { ...env, PILOT_SESSION_FILE: "session" } },
    { command: "run-observe", manifest, env: { ...env, DATABASE_URL: undefined } },
  ] as const)
    await assert.rejects(
      startPilotRuntime(input as never),
      /Pilot runtime unavailable/,
    );
});

test("the live runtime refuses a policy-valid grant outside the G5 scope", async () => {
  const { startPilotRuntime } = await import("../../tools/pilot-runtime.js");
  const base = Date.now();
  // Eight hours is valid for the generic pilot policy but exceeds the approved
  // two-hour G5 session. The G5 refusal must happen before build identity,
  // private key, session or database access.
  const grant = observeGrant({
    issuedAt: new Date(base - 1000).toISOString(),
    expiresAt: new Date(base + 8 * 60 * 60 * 1000 - 1000).toISOString(),
    maxPartsPerDay: 10,
  });
  const manifest = {
    version: 1,
    build: {
      sourceCommit: grant.sourceCommit,
      lockSha256: grant.lockSha256,
      sdkIntegrity: grant.sdkIntegrity,
    },
    consent: {
      consentRef: grant.ownerConsentRef,
      notAfter: new Date(base + 9 * 60 * 60 * 1000).toISOString(),
      expectedAccountId: sentinelUid,
      allowedPurposes: ["observe"],
      allowedPeerIds: ["peer-a"],
      maxPartsPerDay: 10,
      minIntervalMs: 2000,
    },
    grant,
  };
  await assert.rejects(
    startPilotRuntime({
      command: "run-observe",
      manifest,
      env: {
        DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
        PILOT_KEY_FILE: "/private/key",
        PILOT_SESSION_FILE: "/private/session",
      },
    } as never),
    /Pilot runtime unavailable/,
  );
});

test("a mismatched purpose or unbounded configuration is refused before start", async () => {
  await assert.rejects(
    runPilotLoop(undefined as never),
    /Pilot runtime unavailable/,
  );
  for (const input of [
    { mode: "send-test" as const, grant: observeGrant(), maxTicks: 1 },
    { mode: "observe" as const, grant: grant(), maxTicks: 1 },
    { mode: "observe" as const, grant: observeGrant(), maxTicks: 0 },
    { mode: "observe" as const, grant: observeGrant(), maxTicks: 1, tickMs: 60_001 },
    {
      mode: "observe" as const,
      grant: observeGrant(),
      maxTicks: 1,
      sessionLimitMs: 2 * 60 * 60 * 1000 + 1,
    },
  ]) {
    const connector = fakeConnector();
    await assert.rejects(
      runPilotLoop({ connector, tickMs: 0, ...input }),
      /Pilot runtime unavailable/,
    );
    assert.equal(connector.counts.started, 0);
  }
});

test("the loop refuses unbounded peers and reports redacted inbound rejections", async () => {
  for (const allowedPeerIds of [
    [],
    ["peer-a", "peer-a"],
    ["bad peer"],
    ["peer-a", "peer-b", "peer-c", "peer-d", "peer-e"],
  ])
    await assert.rejects(
      runPilotLoop({
        connector: fakeConnector(),
        mode: "observe",
        grant: observeGrant({ allowedPeerIds }),
        maxTicks: 1,
        tickMs: 0,
      }),
      /Pilot runtime unavailable/,
    );
  const connector = { ...fakeConnector(), rejectedInbound: 2 };
  assert.deepEqual(
    await runPilotLoop({
      connector,
      mode: "send-test",
      grant: grant(),
      maxTicks: 1,
      tickMs: 0,
    }),
    { halt: "tick-limit", ticks: 1, rejectedInbound: 2 },
  );
});

test("the runtime build identity and database transport are verified", async () => {
  const { assertBuildIdentity, requireTlsDatabaseUrl } = await import(
    "../../tools/pilot-gates.js"
  );
  const build = {
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
  };
  assert.doesNotThrow(() =>
    assertBuildIdentity({ version: 1, ...build }, build),
  );
  for (const identity of [
    null,
    {},
    { ...build, version: 2 },
    { ...build, version: 1, sourceCommit: "d".repeat(40) },
    { ...build, version: 1, extra: true },
  ])
    assert.throws(
      () => assertBuildIdentity(identity, build),
      /Pilot runtime unavailable/,
    );

  for (const url of [
    "postgresql://u:p@127.0.0.1:5432/zalo",
    "postgresql://u:p@localhost/zalo",
    "postgresql://u:p@[::1]:5432/zalo",
    "postgresql://u:p@db.internal:5432/zalo?sslmode=require",
    "postgresql://u:p@db.internal/zalo?sslmode=verify-full",
    "postgresql://u:p@db.internal/zalo?sslmode=verify-full&application_name=pilot&connect_timeout=5",
  ])
    assert.doesNotThrow(() => requireTlsDatabaseUrl(url));
  for (const url of [
    "mysql://u:p@db.internal/zalo",
    "postgresql://",
    "not a url",
    "postgresql://u:p@db.internal:5432/zalo",
    "postgresql://u:p@db.internal:5432/zalo?sslmode=disable",
    "postgresql://u:p@127.0.0.1:5432/zalo?ssl=false",
    "postgresql://u:p@db.internal:5432/zalo?sslmode=prefer",
    "postgresql://u:p@db.internal/zalo?sslmode=require&sslmode=disable",
    "postgresql://u:p@127.0.0.1/zalo?host=db.internal",
    "postgresql://u:p@127.0.0.1/zalo?hostaddr=db.internal",
    "postgresql://u:p@127.0.0.1/zalo?port=5432",
    "postgresql://u:p@db%2Einternal/zalo?sslmode=require",
    "postgresql://u:p@db.internal/zalo?sslmode=require#fragment",
    "postgresql://u:p@db.internal?sslmode=require",
    "postgresql://u:p@db.internal/zalo?SSLMODE=require",
  ])
    assert.throws(
      () => requireTlsDatabaseUrl(url),
      /Pilot runtime unavailable/,
    );
});

test("the runtime session adapter exposes only the bound account's credentials", async () => {
  const session = {
    imei: "synthetic-imei",
    userAgent: "synthetic-user-agent",
    cookie: [
      { key: "synthetic", value: "sentinel", domain: "example.invalid", path: "/" },
    ],
  };
  const writes: unknown[] = [];
  const store = {
    async read() {
      return { version: 1, accountId: sentinelUid, session };
    },
    async write(value: unknown) {
      writes.push(value);
    },
  };
  const bound = bindPilotSession(store, sentinelUid);
  assert.deepEqual(await bound.read(), session);
  await bound.write(session);
  assert.deepEqual(writes, [{ version: 1, accountId: sentinelUid, session }]);

  for (const value of [
    { version: 1, accountId: "zalo-uid-other", session },
    { version: 2, accountId: sentinelUid, session },
    { version: 1, accountId: sentinelUid },
    { version: 1, accountId: sentinelUid, session: { ...session, cookie: null } },
    { version: 1, accountId: sentinelUid, session: { ...session, extra: true } },
    { version: 1, accountId: sentinelUid, session: { ...session, imei: "" } },
    null,
  ]) {
    await assert.rejects(
      bindPilotSession(
        {
          async read() {
            return value;
          },
          async write() {},
        },
        sentinelUid,
      ).read(),
      /Pilot runtime unavailable/,
    );
  }
});
