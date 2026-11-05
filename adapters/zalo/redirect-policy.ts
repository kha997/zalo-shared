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
 *   2. a `Location` is followed only when it answers the exact `checkSession`
 *      request, is an absolute `https:` URL for exactly `chat.zalo.me`, and is
 *      followed exactly once;
 *   3. the redirect host is never a direct target — even when the runtime
 *      allowlist admits it, the only way in is the validated hop;
 *   4. anything else fails closed with a non-secret code and no URL echo.
 *
 * This is not the enforcement boundary. The Docker network topology and the
 * SNI gateway still decide whether a connection is possible; this only keeps
 * the SDK from asking.
 */

export const CHECK_SESSION_URL =
  "https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html";
export const REDIRECT_HOST = "chat.zalo.me";
export const REDIRECT_DENIED = "PILOT_REDIRECT_DENIED";

export type BootstrapFetch = (
  url: string,
  options?: unknown,
) => Promise<Response>;

const CHECK_SESSION_ORIGIN = "https://id.zalo.me";
const CHECK_SESSION_PATH = "/account/checksession";
const CHECK_SESSION_CONTINUE = "https://chat.zalo.me/index.html";
const MAX_URL_LENGTH = 2048;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d+(?:\.\d+){3}$/;

function denied(): TypeError {
  const error = new TypeError("fetch failed");
  (error as any).cause = Object.freeze({ code: REDIRECT_DENIED });
  return error;
}

function validHost(host: unknown): host is string {
  if (typeof host !== "string") return false;
  if (!host || host.length > 253) return false;
  if (host !== host.toLowerCase()) return false;
  if (host.endsWith(".")) return false;
  if (host.includes(":") || host.includes("%") || IPV4.test(host)) return false;
  return host.split(".").every((label) => HOST_LABEL.test(label));
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
  fetch: BootstrapFetch;
  egressHosts: readonly string[];
}): BootstrapFetch {
  const base = options?.fetch;
  const hosts = options?.egressHosts;
  if (typeof base !== "function") throw denied();
  if (!Array.isArray(hosts) || hosts.length > 32) throw denied();
  const direct = new Set<string>();
  for (const host of hosts) {
    if (!validHost(host)) throw denied();
    if (host !== REDIRECT_HOST) direct.add(host);
  }
  const redirectAdmitted = hosts.includes(REDIRECT_HOST);
  let pending: string | null = null;

  return async function bootstrapFetch(input, init) {
    const raw = typeof input === "string" ? input : null;
    if (raw === null) throw denied();
    const url = target(raw);
    if (direct.has(url.hostname)) {
      // A direct provider request clears any hop that was not taken, so a
      // stale Location can never authorise a later request.
      pending = null;
    } else if (
      redirectAdmitted &&
      url.hostname === REDIRECT_HOST &&
      pending !== null &&
      url.href === pending
    ) {
      pending = null;
    } else {
      pending = null;
      throw denied();
    }
    const checkSession = isCheckSession(url);
    const response = await base(raw, init);
    const status = (response as { status?: unknown } | null)?.status;
    const headers = (response as { headers?: { get?: unknown } } | null)?.headers;
    if (
      checkSession &&
      typeof status === "number" &&
      status >= 300 &&
      status < 400 &&
      typeof headers?.get === "function"
    ) {
      const location = (headers.get as (name: string) => string | null)(
        "location",
      );
      pending = location === null ? null : followableLocation(location);
    } else {
      pending = null;
    }
    return response;
  };
}
