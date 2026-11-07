import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECK_SESSION_URL,
  REDIRECT_DENIED,
  createBootstrapFetch,
} from "../../adapters/zalo/redirect-policy.js";
import {
  bootstrapPilotSession,
  type PilotBootstrapError,
} from "../../adapters/zalo/qr-bootstrap.js";
import {
  ensurePrivateDirectory,
  PrivateDiagnosticFile,
} from "../../server/private-pilot-files.js";
import {
  DIAGNOSTIC_REDIRECT_CLASSES,
  DIAGNOSTIC_REQUEST_CATEGORIES,
  isSafeHostname,
  normalizeDiagnosticDetail,
  safeDestinationHost,
  type DiagnosticDetail,
} from "../../server/pilot-diagnostic.js";
import type { PilotGrant } from "../../server/pilot-policy.js";

/**
 * Offline proof that a refused redirect is attributable without exposing the
 * URL, the Location value or any credential. The base fetch is synthetic, so
 * no socket, DNS query or provider contact happens. The real pinned SDK drives
 * the end-to-end cases through the same policy the connector installs.
 */

const POSIX = process.platform !== "win32";
const sdkZalo = pathToFileURL(
  resolve(process.cwd(), "node_modules/zca-js/dist/zalo.js"),
).href;
const CHAT = "https://chat.zalo.me/index.html";
const REVIEWED_HOSTS = [
  "id.zalo.me",
  "wpa.chat.zalo.me",
  "jr.chat.zalo.me",
  "chat.zalo.me",
];
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SENTINEL = "sentinel-must-never-be-logged";
const DETAIL_KEYS = ["destination", "hops", "redirect", "request", "source"];

function html(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}
/** A 3xx whose Location cannot be represented by the Headers API. */
function rawRedirect(location: string) {
  return {
    status: 302,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "location" ? location : null;
      },
    },
  } as unknown as Response;
}

type Session = {
  checksession: () => Response;
  chat?: () => Response;
};

function fixture(session: Session) {
  const calls: string[] = [];
  const base = async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.origin === "https://id.zalo.me") {
      switch (parsed.pathname) {
        case "/account":
          return html(
            '<script src="https://stc-zlogin.zdn.vn/main-687.js"></script>',
          );
        case "/account/logininfo":
        case "/account/verify-client":
          return json({ error_code: 0, data: {} });
        case "/account/authen/qr/generate":
          return json({
            error_code: 0,
            data: { code: "synthetic-qr-code", image: PNG },
          });
        case "/account/authen/qr/waiting-scan":
          return json({
            error_code: 0,
            data: { display_name: "Synthetic Account", avatar: "" },
          });
        case "/account/authen/qr/waiting-confirm":
          return json({ error_code: 0 });
        case "/account/checksession":
          return session.checksession();
        default:
          throw new Error("unexpected provider path");
      }
    }
    if (parsed.origin === "https://chat.zalo.me") {
      if (session.chat) return session.chat();
      return html("<html>synthetic chat</html>");
    }
    if (parsed.origin === "https://jr.chat.zalo.me")
      return json({
        error_code: 0,
        data: { logged: true, info: { uid: "synthetic" } },
      });
    throw new Error(`unexpected destination ${parsed.origin}`);
  };
  return { base, calls };
}

function policyFor(session: Session) {
  const { base, calls } = fixture(session);
  const denials: DiagnosticDetail[] = [];
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
    onDenial: (value) => denials.push(value),
  });
  return { policy, calls, denials };
}

const denied = (error: unknown) =>
  (error as { cause?: { code?: unknown } } | null)?.cause?.code ===
  REDIRECT_DENIED;

/** A denial can only ever carry the five reviewed fields and no raw URL. */
function assertClosed(denial: DiagnosticDetail) {
  assert.deepEqual(Object.keys(denial).sort(), DETAIL_KEYS);
  const text = JSON.stringify(denial);
  for (const forbidden of [
    "https",
    "://",
    "?",
    "=",
    "/",
    "\\",
    SENTINEL,
    "@",
  ])
    assert.equal(text.includes(forbidden), false, `${forbidden} in ${text}`);
  assert.ok((DIAGNOSTIC_REQUEST_CATEGORIES as readonly string[]).includes(denial.request));
  assert.ok((DIAGNOSTIC_REDIRECT_CLASSES as readonly string[]).includes(denial.redirect));
  assert.ok(!denial.source || isSafeHostname(denial.source));
  assert.ok(
    !denial.destination ||
      denial.destination === "invalid" ||
      isSafeHostname(denial.destination),
  );
}

// --------------------------------------------------------- closed vocabulary

test("the diagnostic vocabulary is closed and the host grammar is strict", () => {
  assert.deepEqual(DIAGNOSTIC_REQUEST_CATEGORIES, [
    "check-session",
    "provider-direct",
    "redirect-follow",
    "other",
  ]);
  assert.deepEqual(DIAGNOSTIC_REDIRECT_CLASSES, [
    "unexpected-redirect",
    "unexpected-location",
    "redirect-after-hop",
    "direct-redirect-host",
    "stale-hop",
    "malformed-redirect",
    "invalid-target",
    "not-admitted",
  ]);
  for (const host of [
    "chat.zalo.me",
    "a",
    "id.zalo.me",
  ])
    assert.equal(isSafeHostname(host), true, host);
  for (const host of [
    "",
    "Chat.zalo.me",
    "chat.zalo.me.",
    "chat.zalo.me:443",
    "https://chat.zalo.me",
    "chat.zalo.me/index.html",
    "chat.zalo.me?x=1",
    "93.184.216.34",
    "[2001:db8::1]",
    "*.zalo.me",
    "a..b",
    `${"a".repeat(64)}.zalo.me`,
    `${"a".repeat(250)}.zalo.me`,
    7,
  ])
    assert.equal(isSafeHostname(host), false, String(host));

  assert.equal(
    safeDestinationHost("https://chat.zalo.me/index.html?token=SECRET"),
    "chat.zalo.me",
  );
  assert.equal(
    safeDestinationHost("  https://other.example/next  "),
    "other.example",
  );
  assert.equal(safeDestinationHost("http://chat.zalo.me/"), "chat.zalo.me");
  assert.equal(safeDestinationHost("https://user@other.example/"), "other.example");
  // The URL parser rewrites a backslash to a path separator before the host is
  // read, so only the host is ever returned; the policy still refuses the value.
  assert.equal(
    safeDestinationHost("https://chat.zalo.me\\@other.example/"),
    "chat.zalo.me",
  );
  // A control character in the path is discarded with the rest of the path.
  assert.equal(safeDestinationHost("https://other.example/\u0000"), "other.example");
  for (const value of [
    null,
    "",
    "/index.html",
    "//other.example/",
    "https://93.184.216.34/",
    "https://[2001:db8::1]/",
    "file:///etc/passwd",
  ])
    assert.equal(safeDestinationHost(value), "invalid", String(value));
});

test("only the exact reviewed detail shape can reach the sink", () => {
  const base: DiagnosticDetail = {
    request: "check-session",
    redirect: "unexpected-location",
    source: "id.zalo.me",
    destination: "other.example",
    hops: 0,
  };
  assert.deepEqual(normalizeDiagnosticDetail(base), base);
  for (const extra of [
    { url: "https://id.zalo.me/account" },
    { location: "https://other.example/" },
    { cookie: "synthetic" },
    { path: "/index.html" },
    { cid: "00000000-0000-4000-8000-000000000000" },
  ])
    assert.equal(normalizeDiagnosticDetail({ ...base, ...extra }), null);
  for (const field of [
    { request: "login" },
    { request: undefined },
    { redirect: "allowed" },
    { source: "id.zalo.me/account" },
    { source: "ID.ZALO.ME" },
    { source: "https://id.zalo.me" },
    { destination: "https://other.example/" },
    { destination: "other.example/path" },
    { hops: -1 },
    { hops: 1.5 },
    { hops: 9 },
    { hops: "0" },
  ])
    assert.equal(normalizeDiagnosticDetail({ ...base, ...field }), null, String(field));
  assert.equal(
    normalizeDiagnosticDetail({ ...base, source: null, destination: "invalid", hops: 1 })
      ? true
      : false,
    true,
  );
  assert.equal(normalizeDiagnosticDetail(null), null);
  assert.equal(normalizeDiagnosticDetail([]), null);
  assert.equal(normalizeDiagnosticDetail("diagnostic"), null);
});

// ------------------------------------------------- scenario A: Location host

test("A: checkSession answered for an unexpected host is classified without the URL", async () => {
  const { policy, calls, denials } = policyFor({
    checksession: () =>
      redirect(`https://login.example.test/start?token=${SENTINEL}`),
  });
  await assert.rejects(policy(CHECK_SESSION_URL), denied);
  assert.deepEqual(calls, [CHECK_SESSION_URL]);
  assert.deepEqual(denials, [
    {
      request: "check-session",
      redirect: "unexpected-location",
      source: "id.zalo.me",
      destination: "login.example.test",
      hops: 0,
    },
  ]);
  assert.deepEqual(policy.denial, denials[0]);
  assert.equal(policy.denied, true);
  assertClosed(denials[0]);
});

test("A: a lookalike host is recorded as a host, never as a URL", async () => {
  for (const location of [
    "https://chat.zalo.me.evil.test/index.html",
    "https://evil.chat.zalo.me.test/",
    "https://zalo.me/",
  ]) {
    const { policy, calls, denials } = policyFor({
      checksession: () => redirect(location),
    });
    await assert.rejects(policy(CHECK_SESSION_URL), denied);
    assert.equal(calls.length, 1);
    assert.equal(denials.length, 1);
    assert.equal(denials[0].redirect, "unexpected-location");
    assert.equal(denials[0].destination, new URL(location).hostname);
    assertClosed(denials[0]);
  }
});

// ------------------------------------------- scenario B: redirect after hop

test("B: a further redirect after the admitted hop is classified as such", async () => {
  const { policy, calls, denials } = policyFor({
    checksession: () => redirect(CHAT),
    chat: () => redirect(`https://chat.zalo.me/app?next=${SENTINEL}`),
  });
  assert.equal((await policy(CHECK_SESSION_URL)).status, 302);
  await assert.rejects(policy(CHAT), denied);
  assert.deepEqual(calls, [CHECK_SESSION_URL, CHAT]);
  assert.deepEqual(denials, [
    {
      request: "redirect-follow",
      redirect: "redirect-after-hop",
      source: "chat.zalo.me",
      destination: "chat.zalo.me",
      hops: 1,
    },
  ]);
  assertClosed(denials[0]);
});

test("B: a checkout to a third host after the hop stays a post-hop redirect", async () => {
  const { policy, denials } = policyFor({
    checksession: () => redirect(CHAT),
    chat: () => redirect(`https://third.example/next?x=${SENTINEL}`),
  });
  await policy(CHECK_SESSION_URL);
  await assert.rejects(policy(CHAT), denied);
  assert.equal(denials.length, 1);
  assert.equal(denials[0].redirect, "redirect-after-hop");
  assert.equal(denials[0].destination, "third.example");
  assertClosed(denials[0]);
});

// -------------------------------------- scenario C: direct redirect-host hit

test("C: a direct request to the redirect host is classified and never sent", async () => {
  const { policy, calls, denials } = policyFor({
    checksession: () => json({ error_code: 0 }),
  });
  await assert.rejects(policy(CHAT), denied);
  await assert.rejects(policy("https://chat.zalo.me"), denied);
  assert.deepEqual(calls, []);
  assert.deepEqual(denials, [
    {
      request: "redirect-follow",
      redirect: "direct-redirect-host",
      source: null,
      destination: "chat.zalo.me",
      hops: 0,
    },
  ]);
  assertClosed(denials[0]);
});

// ------------------------------------- stale, malformed and unexpected shapes

test("a stale or reused hop is distinguished from a direct request", async () => {
  const cleared = policyFor({ checksession: () => redirect(CHAT) });
  await cleared.policy(CHECK_SESSION_URL);
  await cleared.policy("https://id.zalo.me/account");
  await assert.rejects(cleared.policy(CHAT), denied);
  assert.equal(cleared.denials[0].redirect, "stale-hop");
  assert.equal(cleared.denials[0].hops, 0);

  const reused = policyFor({ checksession: () => redirect(CHAT) });
  await reused.policy(CHECK_SESSION_URL);
  assert.equal((await reused.policy(CHAT)).status, 200);
  await assert.rejects(reused.policy(CHAT), denied);
  assert.equal(reused.denials[0].redirect, "stale-hop");

  const mismatched = policyFor({ checksession: () => redirect(CHAT) });
  await mismatched.policy(CHECK_SESSION_URL);
  await assert.rejects(mismatched.policy("https://chat.zalo.me/other"), denied);
  assert.equal(mismatched.denials[0].redirect, "stale-hop");
  assert.equal(mismatched.denials[0].destination, "chat.zalo.me");
});

test("malformed and downgraded redirects are named without the raw value", async () => {
  for (const [location, destination] of [
    [null, "invalid"],
    ["", "invalid"],
    ["/index.html", "invalid"],
    ["//chat.zalo.me/index.html", "invalid"],
    ["http://chat.zalo.me/index.html", "chat.zalo.me"],
    ["https://chat.zalo.me:8443/index.html", "chat.zalo.me"],
    ["https://user:pass@chat.zalo.me/index.html", "chat.zalo.me"],
    ["https://93.184.216.34/", "invalid"],
    ["https://[2001:db8::1]/", "invalid"],
    // The URL parser rewrites these before the host is read, so the recorded
    // host is still just the host; the class stays malformed because the
    // policy refuses the value.
    ["https://chat.zalo.me\\@evil.test/", "chat.zalo.me"],
    ["https://chat.zalo.me/index.html\r\nX-Injected: 1", "chat.zalo.me"],
    ["file:///etc/passwd", "invalid"],
  ] as const) {
    const { policy, calls, denials } = policyFor({
      checksession: () =>
        location === null
          ? new Response(null, { status: 302 })
          : location.includes("\r")
            ? rawRedirect(location)
            : redirect(location),
    });
    await assert.rejects(policy(CHECK_SESSION_URL), denied, String(location));
    assert.deepEqual(calls, [CHECK_SESSION_URL]);
    assert.equal(denials.length, 1);
    assert.equal(denials[0].redirect, "malformed-redirect", String(location));
    assert.equal(denials[0].destination, destination, String(location));
    assertClosed(denials[0]);
  }
});

test("a 3xx where no redirect is permitted stays distinct from an unexpected Location", async () => {
  const calls: string[] = [];
  const denials: DiagnosticDetail[] = [];
  const policy = createBootstrapFetch({
    fetch: async (input: unknown) => {
      calls.push(String(input));
      return redirect(CHAT);
    },
    egressHosts: REVIEWED_HOSTS,
    onDenial: (value) => denials.push(value),
  });
  await assert.rejects(
    policy("https://id.zalo.me/account/logininfo"),
    denied,
  );
  assert.deepEqual(calls, ["https://id.zalo.me/account/logininfo"]);
  assert.deepEqual(denials, [
    {
      request: "provider-direct",
      redirect: "unexpected-redirect",
      source: "id.zalo.me",
      destination: "chat.zalo.me",
      hops: 0,
    },
  ]);
  assertClosed(denials[0]);
});

test("an invalid or unadmitted request target is classified without a socket", async () => {
  const { policy, calls, denials } = policyFor({
    checksession: () => json({ error_code: 0 }),
  });
  await assert.rejects(policy(123 as unknown as string), denied);
  assert.deepEqual(denials[0], {
    request: "other",
    redirect: "invalid-target",
    source: null,
    destination: null,
    hops: 0,
  });
  assert.equal(calls.length, 0);

  await assert.rejects(policy("https://unreviewed.example/path"), denied);
  assert.deepEqual(calls, []);
  // Only the first refusal is kept; later consequences cannot replace it.
  assert.equal(denials.length, 1);
  assert.equal(denials[0].redirect, "invalid-target");
});

// ------------------------------------------------------- sink shape and limits

test("the sink writes the reviewed detail, one correlation id per file", async () => {
  const root = await mkdtemp(join(tmpdir(), "zalo-pilot-diagnostic-"));
  try {
    const directory = join(root, "state");
    await ensurePrivateDirectory(directory);
    const path = join(directory, "diagnostic.jsonl");
    const log = new PrivateDiagnosticFile({ path });
    await log.append("start");
    const detail: DiagnosticDetail = {
      request: "check-session",
      redirect: "unexpected-location",
      source: "id.zalo.me",
      destination: "other.example",
      hops: 0,
    };
    await log.append("failed", "redirect-denied", detail);
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.match(first.cid, /^[0-9a-f-]{36}$/);
    assert.equal(first.cid, second.cid);
    assert.equal(first.stage, "start");
    assert.equal("reason" in first, false);
    assert.equal(second.stage, "failed");
    assert.equal(second.reason, "redirect-denied");
    for (const key of DETAIL_KEYS)
      assert.deepEqual(second[key], (detail as unknown as Record<string, unknown>)[key]);
    assert.deepEqual(
      Object.keys(second).sort(),
      ["at", "cid", "destination", "hops", "reason", "redirect", "request", "source", "stage"],
    );
    if (POSIX) assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);

    // Refuse rather than redact: an extra key, a URL, a path or a bad integer
    // must not be written at all.
    for (const bad of [
      { ...detail, url: "https://other.example/" },
      { ...detail, source: "id.zalo.me/account" },
      { ...detail, destination: "other.example/path" },
      { ...detail, destination: "other.example?token=1" },
      { ...detail, hops: -1 },
      { ...detail, hops: 9 },
      { ...detail, request: "login" },
      { ...detail, redirect: "allowed" },
    ])
      await assert.rejects(
        log.append("failed", "redirect-denied", bad as DiagnosticDetail),
      );
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);

    const uuid = "11111111-2222-4333-8444-555555555555";
    const explicit = new PrivateDiagnosticFile({ path, correlationId: uuid });
    await explicit.append("start");
    const last = JSON.parse((await readFile(path, "utf8")).trim().split("\n").at(-1)!);
    assert.equal(last.cid, uuid);
    for (const bad of ["relative", "../../etc/passwd", "ABCDEF", `${uuid}0`])
      assert.throws(() => new PrivateDiagnosticFile({ path, correlationId: bad }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ----------------------------------------- real pinned SDK, end-to-end denial

const grant = (): PilotGrant =>
  ({
    version: 1,
    grantId: "grant-synthetic-diagnostic",
    purpose: "enroll-session",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ownerConsentRef: "owner-consent-synthetic",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: null,
    allowedPeerIds: [],
    maxPartsPerDay: 1,
    minIntervalMs: 2000,
  }) as PilotGrant;

function ownerProbe() {
  const probe = {
    checks: 0,
    invalidations: 0,
    admitted: true,
    handle: {
      token: Object.freeze({
        accountId: "00000000-0000-4000-8000-000000000001",
        ownerId: "00000000-0000-4000-8000-000000000002",
        epoch: "1",
      }),
      get admitted() {
        return probe.admitted;
      },
      async assertCurrent() {
        probe.checks++;
      },
      async markActive() {},
      async invalidate() {
        probe.invalidations++;
      },
      async close() {},
    },
  };
  return probe;
}

async function bootstrapThroughSdk(session: Session) {
  const { base, calls } = fixture(session);
  const owner = ownerProbe();
  const shown: Uint8Array[] = [];
  let confirmed = 0;
  const writes: unknown[] = [];
  const result = await bootstrapPilotSession({
    grant: grant(),
    owner: owner.handle as never,
    view: {
      async showPng(bytes) {
        shown.push(new Uint8Array(bytes));
      },
      async clear() {},
      async confirmIdentity() {
        confirmed++;
        return true;
      },
    },
    sessionStore: {
      async read() {
        return null;
      },
      async write(value) {
        writes.push(value);
      },
      async quarantine() {},
    },
    loader: () => import(sdkZalo),
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
    signal: new AbortController().signal,
    deadlineMs: 10_000,
  }).then(
    (value) => ({ value, error: undefined }),
    (error: PilotBootstrapError) => ({ value: undefined, error }),
  );
  return { ...result, calls, owner, shown, writes, confirmed };
}

test("end-to-end A: the pinned SDK denial carries the unexpected destination", async () => {
  const outcome = await bootstrapThroughSdk({
    checksession: () =>
      redirect(`https://login.example.test/enter?token=${SENTINEL}`),
  });
  assert.equal(outcome.error?.code, "redirect-denied");
  assert.deepEqual(outcome.error?.detail, {
    request: "check-session",
    redirect: "unexpected-location",
    source: "id.zalo.me",
    destination: "login.example.test",
    hops: 0,
  });
  assert.ok(outcome.calls.includes(CHECK_SESSION_URL));
  assert.ok(
    outcome.calls.every((url) => !url.startsWith("https://login.example.test")),
  );
  assert.equal(outcome.confirmed, 0);
  assert.equal(outcome.writes.length, 0);
  assert.ok(outcome.owner.checks >= 1);
  assert.equal(outcome.owner.invalidations, 0);
});

test("end-to-end B: the pinned SDK denial names the post-hop redirect", async () => {
  const outcome = await bootstrapThroughSdk({
    checksession: () => redirect(CHAT),
    chat: () => redirect(`https://chat.zalo.me/app?next=${SENTINEL}`),
  });
  assert.equal(outcome.error?.code, "redirect-denied");
  assert.deepEqual(outcome.error?.detail, {
    request: "redirect-follow",
    redirect: "redirect-after-hop",
    source: "chat.zalo.me",
    destination: "chat.zalo.me",
    hops: 1,
  });
  assert.equal(outcome.calls.filter((url) => url === CHAT).length, 1);
  assert.ok(!outcome.calls.includes("https://chat.zalo.me/app"));
  assert.equal(outcome.writes.length, 0);
});

test("end-to-end C: a direct redirect-host request is named before any socket", async () => {
  const calls: string[] = [];
  const owner = ownerProbe();
  let confirmed = 0;
  const result = await bootstrapPilotSession({
    grant: grant(),
    owner: owner.handle as never,
    view: {
      async showPng() {},
      async clear() {},
      async confirmIdentity() {
        confirmed++;
        return true;
      },
    },
    sessionStore: {
      async read() {
        return null;
      },
      async write() {},
      async quarantine() {},
    },
    loader: async () => ({
      Zalo: class {
        private readonly options: { polyfill?: (input: string) => Promise<unknown> };
        constructor(options: { polyfill?: (input: string) => Promise<unknown> }) {
          this.options = options;
        }
        async loginQR() {
          // The SDK requests the redirect-only host directly, with no hop.
          await this.options.polyfill?.(CHAT).catch(() => {});
          throw new Error("Cannot get session, login failed");
        }
      },
    }),
    // The wrapper must expose the policy the bootstrap installed.
    fetch: async (input: unknown) => {
      calls.push(String(input));
      return new Response("ok", { status: 200 });
    },
    egressHosts: REVIEWED_HOSTS,
    signal: new AbortController().signal,
  }).then(
    (value) => ({ value, error: undefined }),
    (error: PilotBootstrapError) => ({ value: undefined, error }),
  );
  assert.equal(result.error?.code, "redirect-denied");
  assert.equal(result.error?.detail?.redirect, "direct-redirect-host");
  assert.deepEqual(result.error?.detail, {
    request: "redirect-follow",
    redirect: "direct-redirect-host",
    source: null,
    destination: "chat.zalo.me",
    hops: 0,
  });
  assert.deepEqual(calls, []);
  assert.equal(confirmed, 0);
});

// ------------------------------------------------------ durability and limits

test("the classified denial survives process exit and never carries a secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "zalo-pilot-exit-diag-"));
  try {
    const directory = join(root, "state");
    await ensurePrivateDirectory(directory);
    const diagnostic = join(directory, "diagnostic.jsonl");
    const script = join(root, "run.mts");
    const bootstrapUrl = pathToFileURL(
      resolve("adapters/zalo/qr-bootstrap.ts"),
    ).href;
    const filesUrl = pathToFileURL(
      resolve("server/private-pilot-files.ts"),
    ).href;
    const source = [
      `const { bootstrapPilotSession } = await import(${JSON.stringify(bootstrapUrl)});`,
      `const { PrivateDiagnosticFile } = await import(${JSON.stringify(filesUrl)});`,
      `const diagnostic = new PrivateDiagnosticFile({ path: ${JSON.stringify(diagnostic)} });`,
      `await diagnostic.ready();`,
      `const owner = { admitted: true, async assertCurrent() {} };`,
      `const view = { async showPng() {}, async clear() {}, async confirmIdentity() { return true; } };`,
      `const sessionStore = { async read() { return null; }, async write() {}, async quarantine() {} };`,
      `class Zalo {`,
      `  constructor(options) { this.options = options; }`,
      `  async loginQR() {`,
      `    await this.options.polyfill("https://chat.zalo.me/index.html?leak=${SENTINEL}").catch(() => {});`,
      `    throw new Error("Cannot get session, login failed");`,
      `  }`,
      `}`,
      `const result = await bootstrapPilotSession({`,
      `  grant: ${JSON.stringify(grant())},`,
      `  owner, view, sessionStore,`,
      `  loader: async () => ({ Zalo }),`,
      `  egressHosts: ["id.zalo.me", "wpa.chat.zalo.me", "jr.chat.zalo.me", "chat.zalo.me"],`,
      `  fetch: async () => new Response("ok", { status: 200 }),`,
      `  signal: new AbortController().signal,`,
      `}).then(() => null, (error) => error);`,
      `await diagnostic.append("failed", result.code, result.detail);`,
      `process.stdout.write(JSON.stringify({ code: result.code, detail: result.detail }));`,
    ].join("\n");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(script, source, { mode: 0o600 });
    const child = spawnSync(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.code, "redirect-denied");
    assert.equal(report.detail.redirect, "direct-redirect-host");

    // Read only after the child exited: the awaited line outlived the process.
    const text = await readFile(diagnostic, "utf8");
    const line = JSON.parse(text.trim());
    assert.equal(line.stage, "failed");
    assert.equal(line.reason, "redirect-denied");
    assert.equal(line.redirect, "direct-redirect-host");
    assert.equal(line.request, "redirect-follow");
    assert.equal(line.source, null);
    assert.equal(line.destination, "chat.zalo.me");
    assert.equal(line.hops, 0);
    assert.match(line.cid, /^[0-9a-f-]{36}$/);
    for (const secret of [
      SENTINEL,
      "https",
      "/index.html",
      "?leak",
      "Cannot get session",
    ])
      assert.equal(text.includes(secret), false, secret);
    if (POSIX) assert.equal((await stat(diagnostic)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
