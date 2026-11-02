import type { PilotGrant, PilotPurpose } from "../server/pilot-policy.js";

export type G5Stage = "bootstrap" | "observe" | "send-test";

/**
 * Hard bounds from the Owner's G5 scope decision. They are stricter than the
 * generic pilot policy; broadening any value requires a new Owner decision and
 * a reviewed code change.
 */
export const G5_SESSION_LIMIT_MS = 2 * 60 * 60 * 1000;
export const G5_MAX_PARTS_PER_DAY = 10;
export const G5_MAX_PEERS = 1;

const STAGE_PURPOSE: Readonly<Record<G5Stage, PilotPurpose>> = {
  bootstrap: "enroll-session",
  observe: "observe",
  "send-test": "send-test",
};
const unavailable = () => new Error("Pilot scope unavailable");

export function g5StageForPurpose(purpose: unknown): G5Stage {
  if (purpose === "enroll-session") return "bootstrap";
  if (purpose === "observe") return "observe";
  if (purpose === "send-test") return "send-test";
  throw unavailable();
}

/** Throws unless the grant is inside the exact approved G5 stage scope. */
export function assertG5Scope(stage: G5Stage, grant: PilotGrant): void {
  if (!grant || typeof grant !== "object" || !STAGE_PURPOSE[stage])
    throw unavailable();
  if (
    grant.purpose !== STAGE_PURPOSE[stage] ||
    !Number.isInteger(grant.maxPartsPerDay) ||
    grant.maxPartsPerDay < 1 ||
    grant.maxPartsPerDay > G5_MAX_PARTS_PER_DAY ||
    !Number.isInteger(grant.minIntervalMs) ||
    grant.minIntervalMs < 2000 ||
    !Array.isArray(grant.allowedPeerIds)
  )
    throw unavailable();
  const issued = Date.parse(grant.issuedAt);
  const expires = Date.parse(grant.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > G5_SESSION_LIMIT_MS
  )
    throw unavailable();
  if (stage === "bootstrap") {
    if (grant.expectedAccountId !== null || grant.allowedPeerIds.length !== 0)
      throw unavailable();
    return;
  }
  if (
    typeof grant.expectedAccountId !== "string" ||
    !grant.expectedAccountId ||
    grant.allowedPeerIds.length !== G5_MAX_PEERS ||
    grant.allowedPeerIds[0] === grant.expectedAccountId
  )
    throw unavailable();
}

/** Nonsecret summary safe to print to the operator or evidence. */
export function g5ScopeSummary(grant: PilotGrant) {
  const issued = Date.parse(grant.issuedAt);
  const expires = Date.parse(grant.expiresAt);
  return Object.freeze({
    purpose: grant.purpose,
    accountBound: grant.expectedAccountId !== null,
    peerCount: grant.allowedPeerIds.length,
    maxPartsPerDay: grant.maxPartsPerDay,
    minIntervalMs: grant.minIntervalMs,
    lifetimeMs:
      Number.isFinite(issued) && Number.isFinite(expires)
        ? expires - issued
        : null,
  });
}
