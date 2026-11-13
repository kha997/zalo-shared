/**
 * Fetch policy for QR enrollment.
 *
 * The pinned SDK's shared `request()` helper (zca-js@2.2.0 `dist/utils.js`)
 * follows any `Location` header by recursing with the redirect target, before
 * any allowlist is consulted, and does so whatever the status code is. The
 * network boundary would refuse an unadmitted name, but silently: no socket is
 * attempted, so the gateway logs nothing and the login dies with one fixed
 * sentence.
 *
 * This wrapper narrows the SDK itself:
 *
 *   1. a request goes out only to a reviewed provider host, over `https:`,
 *      on port 443, with no userinfo and no IP literal;
 *   2. every request is forced to `redirect: "manual"`, so undici cannot
 *      follow a provider redirect inside fetch where this policy would never
 *      see it;
 *   3. a `Location` is followed only when it answers the exact request that is
 *      allowed to issue it, and only for exactly one use:
 *        - hop 1: the exact `checkSession` response may name `jr.zaloapp.com`;
 *        - hop 2: the authorized hop-1 response may name `jr.chat.zalo.me`;
 *      any other `Location`, on any status, is refused;
 *   4. `jr.zaloapp.com` is never a direct target — even when the runtime
 *      allowlist admits it, the only way in is the validated hop;
 *   5. a third redirect, a wrong source or destination, a loop, a reused or
 *      stale authorization, and a non-3xx carrying a `Location` all fail
 *      closed with a non-secret code and no URL echo.
 *
 * The observed provider chain (2026-11-11) was
 * `id.zalo.me -> jr.zaloapp.com -> jr.chat.zalo.me`; the change admits exactly
 * that sequence and no other. `jr.chat.zalo.me` is already a reviewed static
 * endpoint (the SDK's `/jr/userinfo`), so hop 2 adds no hostname and the
 * four-host allowlist and gateway pinning are unchanged.
 *
 * The hops are bootstrap-scoped in code, not in the network layer. In the
 * prepared compose, `PILOT_EGRESS_HOSTS` is container-wide, so once this
 * admission is deployed the guard and gateway admit those hosts for the whole
 * connector process, not only while `bootstrap` runs. Only the bootstrap path
 * installs this policy; observe and send-test use the SDK facade's own
 * transport.
 *
 * This is not the enforcement boundary. The Docker network topology and the
 * SNI gateway still decide whether a connection is possible; this only keeps
 * the SDK from asking.
 */

import {
  DIAGNOSTIC_INVALID_HOST,
  isSafeHostname,
  safeDestinationHost,
  type DiagnosticDetail,
  type DiagnosticRedirect,
  type DiagnosticRequest,
} from "../../server/pilot-diagnostic.js";

export const CHECK_SESSION_URL =
  "https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html";
/**
 * Hop 1 destination: the host the provider returned on 2026-11-09 and again on
 * 2026-11-11. It is never a direct request target. The `continue` value above
 * is the SDK's own request parameter, so `chat.zalo.me` appears there but is
 * never a destination: it is not admitted, pinable or reachable by this policy.
 */
export const REDIRECT_HOST = "jr.zaloapp.com";
/**
 * Hop 2 destination: the host the authorized hop-1 response named on
 * 2026-11-11. It is also a reviewed static endpoint (`/jr/userinfo`), so
 * direct provider calls keep working; the chain rules govern redirect
 * admission only, and no new host is admitted.
 */
export const CHAIN_HOST = "jr.chat.zalo.me";
export const REDIRECT_DENIED = "PILOT_REDIRECT_DENIED";

export type FetchTransport = (
  url: string,
  options?: unknown,
) => Promise<Response>;
/**
 * The transport plus how the policy last behaved, for non-secret attribution.
 * `denial` is the first refusal only: later consequences of the same refusal
 * cannot replace the root cause.
 */
export type BootstrapFetch = FetchTransport & {
  readonly denied: boolean;
  readonly denial: DiagnosticDetail | null;
};

const CHECK_SESSION = new URL(CHECK_SESSION_URL);
/**
 * The exact reviewed request, byte for byte. Field-wise comparison would accept
 * extra or duplicated query parameters, so only the full href may issue hop 1.
 */
const CHECK_SESSION_HREF = CHECK_SESSION.href;
const MAX_URL_LENGTH = 2048;
/** The chain is exactly two hops; a third is a refusal, not a wider policy. */
const MAX_HOPS = 2;

type Hop = 1 | 2;
type Pending = { href: string; hop: Hop };

function denied(): TypeError {
  const error = new TypeError("fetch failed");
  (error as any).cause = Object.freeze({ code: REDIRECT_DENIED });
  return error;
}

function validHost(host: unknown): host is string {
  return isSafeHostname(host);
}

/** Parse and validate one absolute target. Throws the closed denial error. */
function target(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH)
    throw denied();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw denied();
  }
  if (url.protocol !== "https:") throw denied();
  if (url.username !== "" || url.password !== "") throw denied();
  if (url.port !== "" && url.port !== "443") throw denied();
  if (!validHost(url.hostname)) throw denied();
  return url;
}

/**
 * The exact hop a `Location` may name for the given destination host, or null
 * when it may not be followed. Only the host is pinned; the path and query are
 * the provider's, because they were never recorded.
 */
export function hopTarget(location: string, host: string): string | null {
  if (typeof location !== "string") return null;
  const value = location.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  // Whitespace, controls, and backslashes either smuggle a second URL past a
  // reader or are re-interpreted by the URL parser as a path separator.
  if (/[\u0000-\u0020\u007f]/.test(value) || value.includes("\\")) return null;
  if (!/^https:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = target(value);
  } catch {
    return null;
  }
  if (url.hostname !== host) return null;
  return url.href;
}

/** The single first hop a `Location` may name, or null. */
export function followableLocation(location: string): string | null {
  return hopTarget(location, REDIRECT_HOST);
}

/**
 * The destination host of a well-formed absolute `https:` Location that names
 * a host other than `host`, or null. This only names the refusal class; it
 * never widens what may be followed.
 */
function unexpectedDestination(raw: unknown, host: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  if (/[\u0000-\u0020\u007f]/.test(value) || value.includes("\\")) return null;
  if (!/^https:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = target(value);
  } catch {
    return null;
  }
  if (url.hostname === host) return null;
  return url.hostname;
}

function isCheckSession(url: URL): boolean {
  return url.href === CHECK_SESSION_HREF;
}

/** The SDK sends GET; a write method must never earn the hop authorization. */
function isSafeMethod(method: unknown): boolean {
  if (method === undefined) return true;
  return typeof method === "string" && method.toUpperCase() === "GET";
}

/**
 * @param options.fetch        the real fetch; the only function that may open a
 *                             socket for the SDK
 * @param options.egressHosts  the reviewed host set, from PILOT_EGRESS_HOSTS.
 *                             A redirect host is only followable while it is
 *                             present here, so the runtime configuration — not
 *                             this code — decides admission.
 */
export function createBootstrapFetch(options: {
  fetch: FetchTransport;
  egressHosts: readonly string[];
  /** Observability only: receives the first refusal's closed classification. */
  onDenial?: (denial: DiagnosticDetail) => void;
}): BootstrapFetch {
  const base = options?.fetch;
  const hosts = options?.egressHosts;
  if (typeof base !== "function") throw denied();
  if (options?.onDenial !== undefined && typeof options.onDenial !== "function")
    throw denied();
  if (!Array.isArray(hosts) || hosts.length > 32) throw denied();
  const direct = new Set<string>();
  for (const host of hosts) {
    if (!validHost(host)) throw denied();
    if (host !== REDIRECT_HOST) direct.add(host);
  }
  const redirectAdmitted = hosts.includes(REDIRECT_HOST);
  const chainAdmitted = direct.has(CHAIN_HOST);
  let pending: Pending | null = null;
  let refused = false;
  let hops = 0;
  let issued = false;
  let denial: DiagnosticDetail | null = null;
  const refuse = (
    request: DiagnosticRequest,
    redirect: DiagnosticRedirect,
    source: string | null,
    destination: string | null,
  ) => {
    if (!refused) {
      refused = true;
      denial = { request, redirect, source, destination, hops };
      try {
        options.onDenial?.(denial);
      } catch {}
    }
    return denied();
  };

  const bootstrapFetch = async function bootstrapFetch(
    input: string,
    init?: unknown,
  ) {
    let url: URL;
    try {
      if (typeof input !== "string") throw denied();
      url = target(input);
    } catch {
      throw refuse("other", "invalid-target", null, null);
    }
    const expected = pending as Pending | null;
    const requestMethod =
      init && typeof init === "object" && !Array.isArray(init)
        ? (init as Record<string, unknown>).method
        : undefined;
    const checkSession = isSafeMethod(requestMethod) && isCheckSession(url);
    const consumes =
      expected !== null &&
      url.href === expected.href &&
      url.hostname === (expected.hop === 1 ? REDIRECT_HOST : CHAIN_HOST);
    // A redirect-follow is only the exact href the policy just authorized;
    // every other request is a provider request or a refusal.
    // A direct request to the redirect host is a bypass attempt, not a
    // redirect-follow: it is recorded as `other` with `direct-redirect-host`,
    // so the evidence never reads as if the chain had authorized it.
    const request: DiagnosticRequest = checkSession
      ? "check-session"
      : consumes
        ? "redirect-follow"
        : direct.has(url.hostname)
          ? "provider-direct"
          : "other";
    let hop = 0;
    if (consumes) {
      // Single use: the authorization is spent by this request whatever the
      // runtime turns out to admit, so it can never be replayed.
      pending = null;
      const admitted = expected.hop === 1 ? redirectAdmitted : chainAdmitted;
      if (!admitted) {
        // The exact authorized href, but this deployment's host list does not
        // admit its destination: a configuration refusal, not a stale hop.
        throw refuse(request, "not-admitted", null, url.hostname);
      }
      hop = expected.hop;
      hops = hop;
    } else {
      if (url.hostname === REDIRECT_HOST) {
        // The redirect host is never a direct target, and a hop that was
        // issued but is not being followed exactly is stale.
        throw refuse(
          request,
          issued ? "stale-hop" : "direct-redirect-host",
          null,
          REDIRECT_HOST,
        );
      }
      if (expected !== null && expected.hop === 2 && url.hostname === CHAIN_HOST) {
        // While the hop-2 authorization is outstanding, the only admissible
        // request to its host is the exact authorized href. A different path is
        // a direct request trying to bypass the chain, and it spends the
        // authorization rather than leaving it usable.
        pending = null;
        throw refuse(request, "stale-hop", null, CHAIN_HOST);
      }
      if (!direct.has(url.hostname)) {
        throw refuse(request, "not-admitted", null, url.hostname);
      }
      // A direct provider request clears any hop that was not taken, so a
      // stale Location can never authorise a later request.
      pending = null;
    }
    // Manual on every request. With the default mode undici follows a provider
    // redirect inside fetch, before this wrapper can inspect the response, so
    // an id.zalo.me endpoint could reach a redirect host without the validated
    // hop. Manual makes this wrapper the only thing that can authorise a
    // second request.
    const requestInit =
      init && typeof init === "object" && !Array.isArray(init)
        ? { ...(init as Record<string, unknown>), redirect: "manual" }
        : { redirect: "manual" };
    const response = await base(url.href, requestInit);
    const status = (response as { status?: unknown } | null)?.status;
    const headers = (response as { headers?: { get?: unknown } } | null)?.headers;
    const headerApi = typeof headers?.get === "function";
    let location: string | null = null;
    if (headerApi) {
      try {
        location = (headers.get as (name: string) => string | null).call(
          headers,
          "location",
        );
      } catch {
        location = null;
      }
    }
    const isRedirectStatus =
      typeof status === "number" && status >= 300 && status < 400;
    if (!isRedirectStatus && location === null) {
      pending = null;
      return response;
    }
    // From here the response is a redirect attempt: a 3xx, or a response whose
    // `Location` the pinned SDK would follow whatever the status is.
    pending = null;
    if (hop === MAX_HOPS) {
      // A third redirect is refused whatever it names; this is also what stops
      // a loop from re-entering the chain.
      throw refuse(
        request,
        "redirect-after-hop",
        url.hostname,
        safeDestinationHost(location),
      );
    }
    if (!isRedirectStatus) {
      // Only a 3xx may authorize a hop, so a 2xx/1xx Location names a redirect
      // that this response cannot grant.
      throw refuse(
        request,
        "unexpected-redirect",
        url.hostname,
        safeDestinationHost(location),
      );
    }
    if (hop === 1) {
      const next = location === null ? null : hopTarget(location, CHAIN_HOST);
      if (next === null) {
        throw refuse(
          request,
          unexpectedDestination(location, CHAIN_HOST) === null
            ? "malformed-redirect"
            : "second-hop-denied",
          url.hostname,
          safeDestinationHost(location),
        );
      }
      pending = { href: next, hop: 2 };
      return response;
    }
    // hop 0: only the exact checkSession request may authorize the first hop.
    if (!checkSession) {
      throw refuse(
        request,
        "unexpected-redirect",
        url.hostname,
        safeDestinationHost(location),
      );
    }
    if (!headerApi)
      throw refuse(
        "check-session",
        "malformed-redirect",
        url.hostname,
        DIAGNOSTIC_INVALID_HOST,
      );
    const next = location === null ? null : hopTarget(location, REDIRECT_HOST);
    if (next === null)
      throw refuse(
        "check-session",
        unexpectedDestination(location, REDIRECT_HOST) === null
          ? "malformed-redirect"
          : "unexpected-location",
        url.hostname,
        safeDestinationHost(location),
      );
    pending = { href: next, hop: 1 };
    issued = true;
    return response;
  };

  Object.defineProperty(bootstrapFetch, "denied", {
    get: () => refused,
    enumerable: false,
  });
  Object.defineProperty(bootstrapFetch, "denial", {
    get: () => denial,
    enumerable: false,
  });
  return bootstrapFetch as BootstrapFetch;
}
