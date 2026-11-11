/**
 * Closed vocabulary and bounded schema for the redirect diagnostics written to
 * the private bootstrap log. Every field is a reviewed literal, a bounded DNS
 * hostname, a small integer or a random correlation id, so a diagnostic can
 * never carry a URL, path, query, `Location` value, cookie, authorization
 * header, QR content, UID, phone number, display name, imei, user agent or
 * session/SDK material.
 *
 * This module only describes what may be recorded. It never decides whether a
 * request or redirect is allowed; that remains the fetch policy's job.
 */

/** Which reviewed request shape the policy was answering when it refused. */
export const DIAGNOSTIC_REQUEST_CATEGORIES = [
  "check-session",
  "provider-direct",
  "redirect-follow",
  "other",
] as const;
export type DiagnosticRequest =
  (typeof DIAGNOSTIC_REQUEST_CATEGORIES)[number];

/**
 * Why the policy refused. Each value names one reviewed failure shape:
 *
 *   unexpected-redirect   a redirect where no redirect is permitted at all
 *                         (a non-checkSession 3xx, or any non-3xx Location)
 *   unexpected-location   checkSession answered with a Location for a host
 *                         other than jr.zaloapp.com
 *   second-hop-denied     the authorized hop-1 response named a well-formed
 *                         Location for a host other than jr.chat.zalo.me
 *   redirect-after-hop    a third redirect after the two admitted hops
 *   direct-redirect-host  the redirect host was requested with no hop at all
 *   stale-hop             a hop was issued but this request cannot use it
 *   malformed-redirect    the response carries no usable Location
 *   invalid-target        the request URL itself failed validation
 *   not-admitted          a host outside the reviewed allowlist was requested
 */
export const DIAGNOSTIC_REDIRECT_CLASSES = [
  "unexpected-redirect",
  "unexpected-location",
  "second-hop-denied",
  "redirect-after-hop",
  "direct-redirect-host",
  "stale-hop",
  "malformed-redirect",
  "invalid-target",
  "not-admitted",
] as const;
export type DiagnosticRedirect =
  (typeof DIAGNOSTIC_REDIRECT_CLASSES)[number];

/**
 * The only redirect detail that may be written. `source` is the host that
 * answered; `destination` is a safe hostname or the closed token `invalid`
 * when the Location could not be reduced to one. `hops` counts admitted
 * redirect requests for this bootstrap (0, 1 or 2 in the reviewed chain).
 */
export interface DiagnosticDetail {
  request: DiagnosticRequest;
  redirect: DiagnosticRedirect;
  source: string | null;
  destination: string | null;
  hops: number;
}

export const DIAGNOSTIC_INVALID_HOST = "invalid";
const DIAGNOSTIC_DETAIL_KEYS = "destination,hops,redirect,request,source";
const MAX_HOST_LENGTH = 253;
const MAX_LOCATION_LENGTH = 2048;
const MAX_HOPS = 2;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d+(?:\.\d+){3}$/;
const CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_REQUEST_CATEGORIES);
const REDIRECT_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_REDIRECT_CLASSES);

/**
 * The exact hostname grammar the fetch policy admits. A recorded host can
 * therefore never be a URL fragment, an IP literal, a wildcard or a name with
 * characters that need encoding.
 */
export function isSafeHostname(host: unknown): host is string {
  if (typeof host !== "string") return false;
  if (!host || host.length > MAX_HOST_LENGTH) return false;
  if (host !== host.toLowerCase()) return false;
  if (host.endsWith(".")) return false;
  if (host.includes(":") || host.includes("%") || IPV4.test(host)) return false;
  return host.split(".").every((label) => HOST_LABEL.test(label));
}

/**
 * Reduce a provider `Location` to a recordable hostname. Only the hostname is
 * ever returned, so a path, query, userinfo or header value cannot reach the
 * log. Anything that does not parse, or whose host is not a plain DNS name, is
 * reported with the closed token `invalid`.
 */
export function safeDestinationHost(location: unknown): string {
  if (
    typeof location !== "string" ||
    location.length === 0 ||
    location.length > MAX_LOCATION_LENGTH
  )
    return DIAGNOSTIC_INVALID_HOST;
  let url: URL;
  try {
    url = new URL(location.trim());
  } catch {
    return DIAGNOSTIC_INVALID_HOST;
  }
  return isSafeHostname(url.hostname)
    ? url.hostname
    : DIAGNOSTIC_INVALID_HOST;
}

export function validCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID.test(value);
}

/**
 * Accept only the exact reviewed shape. Returns the bounded wire object, or
 * null so the caller can refuse the whole write rather than redact a value.
 */
export function normalizeDiagnosticDetail(
  value: unknown,
): DiagnosticDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const detail = value as Record<string, unknown>;
  if (Object.keys(detail).sort().join(",") !== DIAGNOSTIC_DETAIL_KEYS)
    return null;
  const { request, redirect, source, destination, hops } = detail;
  if (typeof request !== "string" || !REQUEST_SET.has(request)) return null;
  if (typeof redirect !== "string" || !REDIRECT_SET.has(redirect)) return null;
  if (source !== null && !isSafeHostname(source)) return null;
  if (
    destination !== null &&
    destination !== DIAGNOSTIC_INVALID_HOST &&
    !isSafeHostname(destination)
  )
    return null;
  if (
    typeof hops !== "number" ||
    !Number.isInteger(hops) ||
    hops < 0 ||
    hops > MAX_HOPS
  )
    return null;
  return {
    request: request as DiagnosticRequest,
    redirect: redirect as DiagnosticRedirect,
    source: source as string | null,
    destination: destination as string | null,
    hops,
  };
}
