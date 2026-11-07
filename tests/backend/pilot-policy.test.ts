import test from "node:test";
import assert from "node:assert/strict";
import { validatePilotGrant } from "../../server/pilot-policy.js";

const build = {
  sourceCommit: "a".repeat(40),
  lockSha256: "b".repeat(64),
  sdkIntegrity: "sha512-" + "c".repeat(64),
};
const now = new Date("2026-11-02T01:00:00.000Z");
const consent = () => ({
  consentRef: "owner-consent-1",
  notAfter: "2026-11-03T00:00:00.000Z",
  expectedAccountId: "zalo-uid-1",
  allowedPurposes: ["enroll-session", "observe", "send-test"],
  allowedPeerIds: ["peer-a", "peer-b", "peer-c", "peer-d"],
  maxPartsPerDay: 30,
  minIntervalMs: 5000,
});
const grant = () => ({
  version: 1,
  grantId: "grant-1",
  purpose: "send-test",
  sourceCommit: build.sourceCommit,
  lockSha256: build.lockSha256,
  sdkIntegrity: build.sdkIntegrity,
  issuedAt: "2026-11-02T00:00:00.000Z",
  expiresAt: "2026-11-02T08:00:00.000Z",
  ownerConsentRef: "owner-consent-1",
  dedicatedAccountAttested: true,
  unofficialClientRiskAccepted: true,
  expectedAccountId: "zalo-uid-1",
  allowedPeerIds: ["peer-a", "peer-b"],
  maxPartsPerDay: 10,
  minIntervalMs: 5000,
});
const check = (
  overrides: Record<string, unknown> = {},
  consentOverrides: Record<string, unknown> = {},
  buildOverrides: Record<string, unknown> = {},
) =>
  validatePilotGrant(
    { ...grant(), ...overrides },
    { ...build, ...buildOverrides },
    { ...consent(), ...consentOverrides },
    now,
  );
const denied = (
  overrides: Record<string, unknown> = {},
  consentOverrides: Record<string, unknown> = {},
  buildOverrides: Record<string, unknown> = {},
) =>
  assert.throws(
    () => check(overrides, consentOverrides, buildOverrides),
    /Pilot grant unavailable/,
  );

test("a valid grant is admitted as an immutable copy", () => {
  const source = grant();
  const result = validatePilotGrant(source, build, consent(), now);
  assert.equal(result.purpose, "send-test");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.allowedPeerIds));
  source.allowedPeerIds.push("peer-c");
  source.maxPartsPerDay = 30;
  assert.deepEqual(result.allowedPeerIds, ["peer-a", "peer-b"]);
  assert.equal(result.maxPartsPerDay, 10);
  assert.throws(() => {
    (result as { purpose: string }).purpose = "observe";
  });
  assert.throws(() => {
    (result.allowedPeerIds as string[]).push("peer-c");
  });
  assert.deepEqual(result.allowedPeerIds, ["peer-a", "peer-b"]);
});

test("grant and consent reject missing, extra and malformed fields", async () => {
  const missing = grant();
  delete (missing as any).lockSha256;
  assert.throws(
    () => validatePilotGrant(missing, build, consent(), now),
    /Pilot grant unavailable/,
  );
  await denied({ unexpected: true });
  await denied({}, { unexpected: true });
  await denied({ grantId: "bad id" });
  await denied({ grantId: 7 });
  await denied({ sourceCommit: "A".repeat(40) });
  await denied({ lockSha256: "b".repeat(63) });
  await denied({ sdkIntegrity: "sha512-short" });
  await denied({ issuedAt: "2026-11-02T00:00:00Z" });
  await denied({ issuedAt: "2026-02-30T00:00:00.000Z" });
  await denied({ expiresAt: "not-a-date" });
  await denied({ expectedAccountId: 123 });
  await denied({}, { expectedAccountId: 123 });
  await denied({}, { notAfter: "2026-11-03" });
});

test("clock reversal, future issuance and expiry fail closed", async () => {
  await denied({ issuedAt: "2026-11-02T02:00:00.000Z" });
  assert.throws(
    () =>
      validatePilotGrant(
        grant(),
        build,
        consent(),
        new Date("2026-11-01T23:00:00.000Z"),
      ),
    /Pilot grant unavailable/,
  );
  await denied({ expiresAt: "2026-11-02T01:00:00.000Z" });
  await denied({ expiresAt: "2026-11-02T09:00:00.000Z" });
  assert.throws(
    () =>
      validatePilotGrant(
        grant(),
        build,
        consent(),
        new Date("2026-11-02T08:00:00.000Z"),
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      validatePilotGrant(
        grant(),
        build,
        { ...consent(), notAfter: "2026-11-02T00:30:00.000Z" },
        new Date("2026-11-02T01:00:00.000Z"),
      ),
    /Pilot grant unavailable/,
  );
});

test("source, lock and SDK integrity must match the reviewed build", async () => {
  await denied({}, {}, { sourceCommit: "d".repeat(40) });
  await denied({}, {}, { lockSha256: "e".repeat(64) });
  await denied({}, {}, { sdkIntegrity: "sha512-" + "f".repeat(64) });
  assert.throws(
    () =>
      validatePilotGrant(
        { ...grant(), sourceCommit: "d".repeat(40) },
        build,
        consent(),
        now,
      ),
    /Pilot grant unavailable/,
  );
});

test("attestations, bound account and allowed peers are mandatory where applicable", async () => {
  await denied({ dedicatedAccountAttested: false });
  await denied({ unofficialClientRiskAccepted: false });
  await denied({ expectedAccountId: null });
  await denied({}, { expectedAccountId: "zalo-uid-2" });
  await denied({ expectedAccountId: "zalo-uid-2" });
  await denied({ allowedPeerIds: ["peer-a", "peer-z"] });
  await denied({ allowedPeerIds: ["peer-a", "peer-a"] });
  await denied({ allowedPeerIds: [] });
  await denied({ allowedPeerIds: ["peer-a", "peer-b", "peer-c", "peer-d", "peer-e"] });
  await denied({}, { allowedPeerIds: ["peer-a", "peer-b", "peer-c", "peer-d", "peer-e"] });
  await denied({}, { allowedPeerIds: ["peer-a", "peer-a"] });
});

test("enrollment may omit the account but ordinary purposes require consent binding", () => {
  const result = check(
    {
      purpose: "enroll-session",
      expectedAccountId: null,
      issuedAt: "2026-11-02T00:30:00.000Z",
      expiresAt: "2026-11-02T01:30:00.000Z",
    },
    { expectedAccountId: null, allowedPurposes: ["enroll-session"] },
  );
  assert.equal(result.expectedAccountId, null);
  assert.equal(result.purpose, "enroll-session");
  const bound = check(
    {
      purpose: "enroll-session",
      expectedAccountId: "new-uid",
      issuedAt: "2026-11-02T00:30:00.000Z",
      expiresAt: "2026-11-02T01:30:00.000Z",
    },
    { expectedAccountId: null, allowedPurposes: ["enroll-session"] },
  );
  assert.equal(bound.expectedAccountId, "new-uid");
  assert.throws(
    () =>
      check(
        { purpose: "observe", expectedAccountId: null },
        { expectedAccountId: null },
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      check(
        { purpose: "send-test", expectedAccountId: "attacker-uid" },
        { expectedAccountId: null, allowedPurposes: ["send-test"] },
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      check(
        { purpose: "send-test", expectedAccountId: "attacker-uid" },
        { expectedAccountId: null },
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      check(
        {
          purpose: "enroll-session",
          expectedAccountId: null,
          expiresAt: "2026-11-02T02:00:00.000Z",
        },
        { expectedAccountId: null, allowedPurposes: ["enroll-session"] },
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      check(
        {},
        {
          expectedAccountId: null,
          allowedPurposes: ["enroll-session", "send-test"],
        },
      ),
    /Pilot grant unavailable/,
  );
});

test("budgets, intervals and purposes stay inside the consent scope", async () => {
  await denied({ maxPartsPerDay: 0 });
  await denied({ maxPartsPerDay: 31 });
  await denied({ maxPartsPerDay: 10 }, { maxPartsPerDay: 5 });
  await denied({ minIntervalMs: 1999 });
  await denied({ minIntervalMs: 60001 });
  await denied({ minIntervalMs: 4000 });
  await denied({}, { maxPartsPerDay: 0 });
  await denied({}, { minIntervalMs: 1000 });
  await denied({}, { allowedPurposes: ["observe"] });
  await denied({ purpose: "enroll-session" });
  await denied({ purpose: "production" });
  await denied({}, { allowedPurposes: ["observe", "observe"] });
});

test("routine technical refresh is allowed only under the same consent scope", () => {
  const refreshed = {
    ...build,
    sourceCommit: "d".repeat(40),
    lockSha256: "e".repeat(64),
    sdkIntegrity: "sha256-" + "f".repeat(64),
  };
  const result = validatePilotGrant(
    {
      ...grant(),
      sourceCommit: refreshed.sourceCommit,
      lockSha256: refreshed.lockSha256,
      sdkIntegrity: refreshed.sdkIntegrity,
      issuedAt: "2026-11-02T02:00:00.000Z",
      expiresAt: "2026-11-02T10:00:00.000Z",
    },
    refreshed,
    consent(),
    new Date("2026-11-02T02:30:00.000Z"),
  );
  assert.equal(result.sourceCommit, refreshed.sourceCommit);
  assert.throws(
    () =>
      validatePilotGrant(
        {
          ...grant(),
          sourceCommit: refreshed.sourceCommit,
          lockSha256: refreshed.lockSha256,
          sdkIntegrity: refreshed.sdkIntegrity,
        },
        build,
        consent(),
        now,
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      validatePilotGrant(
        { ...grant(), purpose: "enroll-session" },
        build,
        { ...consent(), allowedPurposes: ["send-test"] },
        now,
      ),
    /Pilot grant unavailable/,
  );
  assert.throws(
    () =>
      validatePilotGrant(
        grant(),
        build,
        { ...consent(), notAfter: "2026-11-02T05:00:00.000Z" },
        now,
      ),
    /Pilot grant unavailable/,
  );
});
