import test from "node:test";
import assert from "node:assert/strict";
import type { PilotGrant } from "../../server/pilot-policy.js";
import {
  assertG5Scope,
  G5_MAX_PARTS_PER_DAY,
  G5_MAX_PEERS,
  G5_SESSION_LIMIT_MS,
  g5ScopeSummary,
  g5StageForPurpose,
} from "../../tools/g5-policy.js";

const now = Date.now();
function grant(overrides: Partial<PilotGrant> = {}): PilotGrant {
  return {
    version: 1,
    grantId: "g5-grant-1",
    purpose: "observe",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    ownerConsentRef: "g5-consent-1",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: "account-a",
    allowedPeerIds: ["peer-b"],
    maxPartsPerDay: 10,
    minIntervalMs: 2000,
    ...overrides,
  };
}

test("the G5 hard bounds match the approved scope", () => {
  assert.equal(G5_SESSION_LIMIT_MS, 2 * 60 * 60 * 1000);
  assert.equal(G5_MAX_PARTS_PER_DAY, 10);
  assert.equal(G5_MAX_PEERS, 1);
  assert.equal(g5StageForPurpose("enroll-session"), "bootstrap");
  assert.equal(g5StageForPurpose("observe"), "observe");
  assert.equal(g5StageForPurpose("send-test"), "send-test");
  assert.throws(() => g5StageForPurpose("other"), /Pilot scope unavailable/);
});

test("observe and send-test admit exactly one peer and at most ten parts per day", () => {
  assert.doesNotThrow(() => assertG5Scope("observe", grant()));
  assert.doesNotThrow(() =>
    assertG5Scope("send-test", grant({ purpose: "send-test" })),
  );
  for (const stage of ["observe", "send-test"] as const) {
    const value = grant({ purpose: stage });
    for (const invalid of [
      { allowedPeerIds: [] },
      { allowedPeerIds: ["peer-b", "peer-c"] },
      { maxPartsPerDay: 11 },
      { minIntervalMs: 1999 },
      { expectedAccountId: null },
      { expiresAt: new Date(now + 3 * 60 * 60 * 1000).toISOString() },
    ]) {
      assert.throws(
        () => assertG5Scope(stage, { ...value, ...invalid } as PilotGrant),
        /Pilot scope unavailable/,
      );
    }
    assert.throws(
      () => assertG5Scope(stage, { ...value, purpose: "enroll-session" }),
      /Pilot scope unavailable/,
    );
  }
});

test("bootstrap admits only a null account, no peers and an enrollment purpose", () => {
  const enroll = grant({
    purpose: "enroll-session",
    expectedAccountId: null,
    allowedPeerIds: [],
    maxPartsPerDay: 10,
  });
  assert.doesNotThrow(() => assertG5Scope("bootstrap", enroll));
  for (const invalid of [
    { expectedAccountId: "account-a" },
    { allowedPeerIds: ["peer-b"] },
    { maxPartsPerDay: 11 },
    { expiresAt: new Date(now + 3 * 60 * 60 * 1000).toISOString() },
  ]) {
    assert.throws(
      () => assertG5Scope("bootstrap", { ...enroll, ...invalid } as PilotGrant),
      /Pilot scope unavailable/,
    );
  }
  assert.throws(
    () =>
      assertG5Scope(
        "bootstrap",
        grant({ expectedAccountId: null, allowedPeerIds: [] }),
      ),
    /Pilot scope unavailable/,
  );
});

test("the scope summary exposes counts and limits but no identifiers", () => {
  const value = grant();
  const summary = g5ScopeSummary(value);
  assert.deepEqual(summary, {
    purpose: "observe",
    accountBound: true,
    peerCount: 1,
    maxPartsPerDay: 10,
    minIntervalMs: 2000,
    lifetimeMs: 60 * 60 * 1000 + 60_000,
  });
  const text = JSON.stringify(summary);
  assert.equal(text.includes("account-a"), false);
  assert.equal(text.includes("peer-b"), false);
  assert.equal(text.includes("g5-grant"), false);
  assert.equal(text.includes("g5-consent"), false);
});
