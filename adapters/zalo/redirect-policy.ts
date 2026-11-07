/**
 * Fetch policy for QR enrollment.
 *
 * The pinned SDK's shared `request()` helper (zca-js@2.2.0 `dist/utils.js`)
 * follows any `Location` header by recursing with the redirect target, before
 * any allowlist is consulted. The network boundary would refuse an unadmitted
 * name, but silently: no socket is attempted, so the gateway logs nothing and
 * the login dies with one fixed sentence.
 *
 * This wrapper narrows the SDK itself:
 *
 *   1. a request goes out only to a reviewed provider host, over `https:`,
 *      on port 443, with no userinfo and no IP literal;
 *   2. every request is forced to `redirect: "manual"`, so undici cannot
 *      follow a provider redirect inside fetch where this policy would never
 *      see it;
 *   3. a `Location` is followed only when it answers the exact `checkSession`
 *      request, is an absolute `https:` URL for exactly `chat.zalo.me`, and is
 *      followed exactly once; any other 3xx — including a checkSession 3xx
 *      whose Location cannot be validated — is refused;
 *   4. the redirect host is never a direct target — even when the runtime
 *      allowlist admits it, the only way in is the validated hop;
 *   5. anything else fails closed with a non-secret code and no URL echo.
 *
 * The hop is bootstrap-scoped in code, not in the network layer. In the
 * prepared compose, `PILOT_EGRESS_HOSTS` is container-wide, so once this
 * admission is deployed the guard and gateway admit `chat.zalo.me:443` for the
 * whole connector process, not only while `bootstrap` runs. Only the bootstrap
 * path installs this policy; observe and send-test use the SDK facade's own
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
export const REDIRECT_HOST = "chat.zalo.me";
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
const CHECK_SESSION_ORIGIN = CHECK_SESSION.origin;
const CHECK_SESSION_PATH = CHECK_SESSION.pathname;
const CHECK_SESSION_CONTINUE = CHECK_SESSION.searchParams.get("continue") ?? "";
const MAX_URL_LENGTH = 2048;

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

/** The single hop a `Location` may name, or null when it may not be followed. */
export function followableLocation(location: string): string | null {
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
  if (url.hostname !== REDIRECT_HOST) return null;
  return url.href;
}

/**
 * The destination host of a well-formed absolute `https:` Location that names
 * a different host, or null. This only names the refusal class; it never
 * widens what may be followed.
 */
function unexpectedDestination(raw: unknown): string | null {
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
  if (url.hostname === REDIRECT_HOST) return null;
  return url.hostname;
}

function isCheckSession(url: URL): boolean {
  return (
    url.origin === CHECK_SESSION_ORIGIN &&
    url.pathname === CHECK_SESSION_PATH &&
    url.searchParams.get("continue") === CHECK_SESSION_CONTINUE
  );
}

/**
 * @param options.fetch        the real fetch; the only function that may open a
 *                             socket for the SDK
 * @param options.egressHosts  the reviewed host set, from PILOT_EGRESS_HOSTS.
 *                             The redirect host is only followable while it is
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
  let pending: string | null = null;
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
    const redirectRequest = url.hostname === REDIRECT_HOST;
    const request: DiagnosticRequest = isCheckSession(url)
      ? "check-session"
      : redirectRequest
        ? "redirect-follow"
        : direct.has(url.hostname)
          ? "provider-direct"
          : "other";
    let hop = false;
    if (direct.has(url.hostname)) {
      // A direct provider request clears any hop that was not taken, so a
      // stale Location can never authorise a later request.
      pending = null;
    } else if (
      redirectAdmitted &&
      redirectRequest &&
      pending !== null &&
      url.href === pending
    ) {
      pending = null;
      hop = true;
      hops = 1;
    } else {
      const wasIssued = issued;
      pending = null;
      throw refuse(
        request,
        redirectRequest
          ? wasIssued
            ? "stale-hop"
            : "direct-redirect-host"
          : "not-admitted",
        null,
        redirectRequest ? REDIRECT_HOST : url.hostname,
      );
    }
    const checkSession = isCheckSession(url);
    // Manual on every request. With the default mode undici follows a provider
    // redirect inside fetch, before this wrapper can inspect the response, so
    // an id.zalo.me endpoint could reach the redirect host without the
    // validated hop. Manual makes this wrapper the only thing that can
    // authorise a second request.
    const requestInit =
      init && typeof init === "object" && !Array.isArray(init)
        ? { ...(init as Record<string, unknown>), redirect: "manual" }
        : { redirect: "manual" };
    const response = await base(url.href, requestInit);
    const status = (response as { status?: unknown } | null)?.status;
    const headers = (response as { headers?: { get?: unknown } } | null)?.headers;
    if (typeof status !== "number" || status < 300 || status >= 400) {
      pending = null;
      return response;
    }
    pending = null;
    const readLocation = (): string | null => {
      try {
        const get = (headers as { get?: unknown } | null | undefined)?.get;
        return typeof get === "function"
          ? (get as (name: string) => string | null).call(headers, "location")
          : null;
      } catch {
        return null;
      }
    };
    if (hop) {
      // Any further 3xx after the admitted hop is refused, whatever it names.
      throw refuse(
        request,
        "redirect-after-hop",
        url.hostname,
        safeDestinationHost(readLocation()),
      );
    }
    if (!checkSession) {
      throw refuse(
        request,
        "unexpected-redirect",
        url.hostname,
        safeDestinationHost(readLocation()),
      );
    }
    if (typeof headers?.get !== "function")
      throw refuse(
        request,
        "malformed-redirect",
        url.hostname,
        DIAGNOSTIC_INVALID_HOST,
      );
    let location: string | null;
    try {
      location = (headers.get as (name: string) => string | null)("location");
    } catch {
      location = null;
    }
    const hopHref = location === null ? null : followableLocation(location);
    // A 3xx the policy cannot validate is a refusal, not an unattributed
    // provider failure. The SDK follows a returned Location itself, so the
    // hop is handed back only after it has been checked here. The class only
    // names what was seen; it never widens what may be followed.
    if (hopHref === null)
      throw refuse(
        request,
        unexpectedDestination(location) === null
          ? "malformed-redirect"
          : "unexpected-location",
        url.hostname,
        safeDestinationHost(location),
      );
    pending = hopHref;
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
