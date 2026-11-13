/**
 * Closed, non-secret vocabulary for the single enrollment bootstrap. No code
 * can carry a UID, QR, cookie, imei, user agent or provider text, so a reason
 * can be echoed to the operator and written to a private log without redaction.
 */
export const BOOTSTRAP_REASONS = [
  "input-invalid",
  "grant-invalid",
  "grant-expired",
  "scope-denied",
  "build-mismatch",
  "database-url-invalid",
  "aborted",
  "deadline",
  "owner-lost",
  "ownership-denied",
  "sdk-load-failed",
  "sdk-invalid",
  "login-failed",
  "login-version-failed",
  "login-qr-generate-failed",
  "login-session-unconfirmed",
  "redirect-denied",
  "login-userinfo-failed",
  "qr-missing",
  "qr-expired",
  "qr-declined",
  "callback-invalid",
  "uid-invalid",
  "uid-mismatch",
  "login-info-invalid",
  "identity-declined",
  "cookie-invalid",
  "view-failed",
  "session-write-failed",
  "quarantine-unconfirmed",
  "internal",
] as const;
export type PilotReason = (typeof BOOTSTRAP_REASONS)[number];

/** Ordered stages of a bootstrap; the last stage names where it stopped. */
export const BOOTSTRAP_STAGES = [
  "start",
  "ownership-acquired",
  "owner-checked",
  "sdk-loaded",
  "login-requested",
  "qr-shown",
  "scanned",
  "login-resolved",
  "uid-verified",
  "identity-confirmed",
  "cookie-captured",
  "session-written",
  "qr-cleared",
  "completed",
  "failed",
] as const;
export type BootstrapStage = (typeof BOOTSTRAP_STAGES)[number];

export const PILOT_REASON_SET: ReadonlySet<string> = new Set(BOOTSTRAP_REASONS);
export const BOOTSTRAP_STAGE_SET: ReadonlySet<string> = new Set(
  BOOTSTRAP_STAGES,
);
