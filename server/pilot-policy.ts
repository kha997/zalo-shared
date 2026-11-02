export type PilotPurpose = "enroll-session" | "observe" | "send-test";

export type PilotConsentScope = Readonly<{
  consentRef: string;
  notAfter: string;
  expectedAccountId: string | null;
  allowedPurposes: readonly PilotPurpose[];
  allowedPeerIds: readonly string[];
  maxPartsPerDay: number;
  minIntervalMs: number;
}>;

export type PilotGrant = Readonly<{
  version: 1;
  grantId: string;
  purpose: PilotPurpose;
  sourceCommit: string;
  lockSha256: string;
  sdkIntegrity: string;
  issuedAt: string;
  expiresAt: string;
  ownerConsentRef: string;
  dedicatedAccountAttested: true;
  unofficialClientRiskAccepted: true;
  expectedAccountId: string | null;
  allowedPeerIds: readonly string[];
  maxPartsPerDay: number;
  minIntervalMs: number;
}>;

const GRANT_KEYS = [
  "version",
  "grantId",
  "purpose",
  "sourceCommit",
  "lockSha256",
  "sdkIntegrity",
  "issuedAt",
  "expiresAt",
  "ownerConsentRef",
  "dedicatedAccountAttested",
  "unofficialClientRiskAccepted",
  "expectedAccountId",
  "allowedPeerIds",
  "maxPartsPerDay",
  "minIntervalMs",
] as const;
const CONSENT_KEYS = [
  "consentRef",
  "notAfter",
  "expectedAccountId",
  "allowedPurposes",
  "allowedPeerIds",
  "maxPartsPerDay",
  "minIntervalMs",
] as const;
const PURPOSES: readonly PilotPurpose[] = [
  "enroll-session",
  "observe",
  "send-test",
];
const MAX_LIFETIME_MS: Readonly<Record<PilotPurpose, number>> = {
  "enroll-session": 60 * 60 * 1000,
  observe: 8 * 60 * 60 * 1000,
  "send-test": 8 * 60 * 60 * 1000,
};
const MAX_CLOCK_SKEW_MS = 30_000;
const unavailable = () => new Error("Pilot grant unavailable");

const object = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => (expected as readonly string[]).includes(key))
  );
};
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const commit = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integrity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 256 &&
  /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value);
const boundedInt = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const peerList = (value: unknown, min: number, max: number): value is string[] => {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    !value.every(id)
  )
    return false;
  return new Set(value).size === value.length;
};
const purposeList = (value: unknown): value is PilotPurpose[] =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= 3 &&
  value.every((item) => PURPOSES.includes(item)) &&
  new Set(value).size === value.length;

function readConsent(value: unknown, now: Date): PilotConsentScope {
  if (!object(value) || !exactKeys(value, CONSENT_KEYS)) throw unavailable();
  if (
    !id(value.consentRef) ||
    !timestamp(value.notAfter) ||
    (value.expectedAccountId !== null && !id(value.expectedAccountId)) ||
    !purposeList(value.allowedPurposes) ||
    !peerList(value.allowedPeerIds, 0, 4) ||
    (value.expectedAccountId === null &&
      value.allowedPurposes.some((purpose) => purpose !== "enroll-session")) ||
    !boundedInt(value.maxPartsPerDay, 1, 30) ||
    !boundedInt(value.minIntervalMs, 2000, 60000) ||
    Date.parse(value.notAfter) <= now.getTime()
  )
    throw unavailable();
  return Object.freeze({
    consentRef: value.consentRef,
    notAfter: value.notAfter,
    expectedAccountId: value.expectedAccountId,
    allowedPurposes: Object.freeze([...value.allowedPurposes]),
    allowedPeerIds: Object.freeze([...value.allowedPeerIds]),
    maxPartsPerDay: value.maxPartsPerDay,
    minIntervalMs: value.minIntervalMs,
  });
}

/**
 * Validates an expiring technical grant against the separately held consent
 * scope and the reviewed build identity. It performs no vault, SDK or network
 * action. Every rejection is indistinguishable and carries no secret value.
 */
export function validatePilotGrant(
  value: unknown,
  build: { sourceCommit: string; lockSha256: string; sdkIntegrity: string },
  consentValue: unknown,
  now: Date,
): PilotGrant {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw unavailable();
  const consent = readConsent(consentValue, now);
  if (!object(value) || !exactKeys(value, GRANT_KEYS)) throw unavailable();
  if (
    value.version !== 1 ||
    !id(value.grantId) ||
    !PURPOSES.includes(value.purpose as PilotPurpose) ||
    !commit(value.sourceCommit) ||
    !sha256(value.lockSha256) ||
    !integrity(value.sdkIntegrity) ||
    !timestamp(value.issuedAt) ||
    !timestamp(value.expiresAt) ||
    !id(value.ownerConsentRef) ||
    value.dedicatedAccountAttested !== true ||
    value.unofficialClientRiskAccepted !== true ||
    (value.expectedAccountId !== null && !id(value.expectedAccountId)) ||
    !peerList(value.allowedPeerIds, 0, 4) ||
    !boundedInt(value.maxPartsPerDay, 1, 30) ||
    !boundedInt(value.minIntervalMs, 2000, 60000)
  )
    throw unavailable();
  if (
    !commit(build?.sourceCommit) ||
    !sha256(build?.lockSha256) ||
    !integrity(build?.sdkIntegrity) ||
    value.sourceCommit !== build.sourceCommit ||
    value.lockSha256 !== build.lockSha256 ||
    value.sdkIntegrity !== build.sdkIntegrity
  )
    throw unavailable();
  const purpose = value.purpose as PilotPurpose;
  const issued = Date.parse(value.issuedAt);
  const expires = Date.parse(value.expiresAt);
  if (
    expires <= issued ||
    expires - issued > MAX_LIFETIME_MS[purpose] ||
    issued > now.getTime() + MAX_CLOCK_SKEW_MS ||
    expires <= now.getTime() ||
    value.ownerConsentRef !== consent.consentRef ||
    !consent.allowedPurposes.includes(purpose)
  )
    throw unavailable();
  if (expires > Date.parse(consent.notAfter)) throw unavailable();
  if (purpose === "enroll-session") {
    // The first login may precede UID discovery, but any pre-bound consent
    // still wins. Ordinary purposes below require a non-null consent account.
    if (
      consent.expectedAccountId !== null &&
      value.expectedAccountId !== consent.expectedAccountId
    )
      throw unavailable();
  } else if (
    consent.expectedAccountId === null ||
    value.expectedAccountId !== consent.expectedAccountId
  )
    throw unavailable();
  if (
    (purpose === "observe" || purpose === "send-test") &&
    value.allowedPeerIds.length < 1
  )
    throw unavailable();
  if (!value.allowedPeerIds.every((peer) => consent.allowedPeerIds.includes(peer)))
    throw unavailable();
  if (
    value.maxPartsPerDay > consent.maxPartsPerDay ||
    value.minIntervalMs < consent.minIntervalMs
  )
    throw unavailable();
  return Object.freeze({
    version: 1,
    grantId: value.grantId,
    purpose,
    sourceCommit: value.sourceCommit,
    lockSha256: value.lockSha256,
    sdkIntegrity: value.sdkIntegrity,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    ownerConsentRef: value.ownerConsentRef,
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: value.expectedAccountId,
    allowedPeerIds: Object.freeze([...value.allowedPeerIds]),
    maxPartsPerDay: value.maxPartsPerDay,
    minIntervalMs: value.minIntervalMs,
  });
}
