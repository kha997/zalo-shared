import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECK_SESSION_URL,
  REDIRECT_DENIED,
  createBootstrapFetch,
  followableLocation,
} from "../../adapters/zalo/redirect-policy.js";

/**
 * Offline proof that the SDK fetch policy admits exactly one redirect hop and
 * nothing else. The real pinned `loginQR` drives the policy, so the assertions
 * cover the code path the connector actually runs; the base fetch is synthetic
 * and no socket, DNS query or provider contact happens.
 *
 * The admitted destination is the one the provider named in the authorized
 * 2026-11-09 attempt (jr.zaloapp.com). The earlier chat.zalo.me hypothesis is
 * kept in the refusal set, so that host cannot become followable again by
 * accident.
 */

const sdkRoot = resolve(process.cwd(), "node_modules/zca-js");
const loginQRModule = pathToFileURL(
  resolve(sdkRoot, "dist/apis/loginQR.js"),
).href;
const REDIRECT = "https://jr.zaloapp.com/index.html";
const PREVIOUS_HYPOTHESIS = "https://chat.zalo.me/index.html";
const REVIEWED_HOSTS = [
  "id.zalo.me",
  "wpa.chat.zalo.me",
  "jr.chat.zalo.me",
  "jr.zaloapp.com",
];
const HOSTS_WITHOUT_REDIRECT = REVIEWED_HOSTS.filter(
  (h) => h !== "jr.zaloapp.com",
);
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

type Session = {
  checksession: () => Response;
  redirectTarget?: () => Response;
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
    if (parsed.origin === "https://jr.zaloapp.com") {
      if (session.redirectTarget) return session.redirectTarget();
      return html("<html>synthetic redirect target</html>");
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

async function run(
  hosts: string[],
  session: Session,
): Promise<{ value?: any; error?: Error; calls: string[] }> {
  const { loginQR } = await import(loginQRModule);
  const { base, calls } = fixture(session);
  const polyfill = createBootstrapFetch({ fetch: base, egressHosts: hosts });
  const ctx = {
    options: {
      logging: false,
      selfListen: false,
      checkUpdate: false,
      polyfill,
    },
    cookie: null,
  };
  const result = await loginQR(ctx, { userAgent: "synthetic-agent" }, () => {})
    .then(
      (value: unknown) => ({ value }),
      (error: Error) => ({ error }),
    );
  return { ...result, calls };
}

function loginFailed(outcome: { value?: any; error?: Error }) {
  assert.ok("error" in outcome, "the login must fail");
  assert.match((outcome.error as Error).message, /Cannot get session, login failed/);
}

// --------------------------------------------------------------- URL shapes

test("only one exact hop shape is followable", () => {
  assert.equal(followableLocation(REDIRECT), REDIRECT);
  assert.equal(
    followableLocation("https://jr.zaloapp.com:443/index.html"),
    REDIRECT,
  );
  assert.equal(
    followableLocation(" https://jr.zaloapp.com/index.html "),
    REDIRECT,
  );
  for (const refused of [
    "https://jr.zaloapp.com.evil.test/",
    "https://evil.jr.zaloapp.com.test/",
    "https://evil.jr.zaloapp.com/",
    "https://jr.zaloapp.com@evil.test/",
    "https://evil.test@jr.zaloapp.com/",
    "http://jr.zaloapp.com/",
    "https://user@jr.zaloapp.com/",
    "https://user:pass@jr.zaloapp.com/",
    "https://jr.zaloapp.com:8443/",
    "https://jr.zaloapp.com./",
    "https://93.184.216.34/",
    "https://[2001:db8::1]/",
    "//jr.zaloapp.com/index.html",
    "/index.html",
    "https://jr.zaloapp.com\\@evil.test/",
    "https://jr.zaloapp.com/index.html\r\nX-Injected: 1",
    "file:///etc/passwd",
    PREVIOUS_HYPOTHESIS,
    "",
  ])
    assert.equal(followableLocation(refused), null, refused);
});

test("a malformed or over-broad host set is refused at construction", () => {
  const base = async () => new Response(null);
  for (const hosts of [
    ["*.zalo.me"],
    ["jr.zaloapp.com."],
    ["93.184.216.34"],
    ["JR.zaloapp.com"],
    [""],
    ["id.zalo.me", 7 as unknown as string],
  ])
    assert.throws(
      () => createBootstrapFetch({ fetch: base, egressHosts: hosts }),
      (error: any) => error?.cause?.code === REDIRECT_DENIED,
      String(hosts),
    );
  assert.throws(
    () => createBootstrapFetch({ fetch: base, egressHosts: "id.zalo.me" as any }),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.throws(
    () => createBootstrapFetch({ fetch: null as any, egressHosts: [] }),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
});

// --------------------------------------------------------- policy behaviour

test("an empty host set admits no request at all", async () => {
  const { base, calls } = fixture({
    checksession: () => json({ error_code: 0 }),
  });
  const policy = createBootstrapFetch({ fetch: base, egressHosts: [] });
  await assert.rejects(
    policy("https://id.zalo.me/account"),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.deepEqual(calls, []);
});

test("the redirect host is never a direct request target", async () => {
  const { base, calls } = fixture({
    checksession: () => json({ error_code: 0 }),
  });
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  await assert.rejects(
    policy(REDIRECT),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  await assert.rejects(
    policy("https://jr.zaloapp.com"),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.deepEqual(calls, []);
});

test("a 3xx that is not checksession is refused, not handed to the SDK", async () => {
  const calls: string[] = [];
  const base = async (input: unknown) => {
    calls.push(String(input));
    return redirect(REDIRECT);
  };
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  await assert.rejects(
    policy("https://id.zalo.me/account/logininfo"),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.equal(policy.denied, true);
  await assert.rejects(
    policy(REDIRECT),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.deepEqual(calls, ["https://id.zalo.me/account/logininfo"]);
});

test("a stale hop is cleared by an unrelated provider request", async () => {
  const { base } = fixture({
    checksession: () => redirect(REDIRECT),
  });
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  const first = await policy(CHECK_SESSION_URL);
  assert.equal(first.status, 302);
  await policy("https://id.zalo.me/account");
  await assert.rejects(
    policy(REDIRECT),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
});

test("the hop is single-use", async () => {
  const { base } = fixture({
    checksession: () => redirect(REDIRECT),
  });
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  assert.equal((await policy(CHECK_SESSION_URL)).status, 302);
  assert.equal((await policy(REDIRECT)).status, 200);
  await assert.rejects(
    policy(REDIRECT),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
});

test("an invalid Location is refused at the checkSession call", async () => {
  for (const location of [
    "https://jr.zaloapp.com.evil.test/",
    "https://evil.jr.zaloapp.com/",
    "http://jr.zaloapp.com/",
    "https://jr.zaloapp.com:8443/",
    "https://user@jr.zaloapp.com/",
    "https://jr.zaloapp.com./",
    "https://evil.test@jr.zaloapp.com/",
    PREVIOUS_HYPOTHESIS,
    "/index.html",
  ]) {
    const { base, calls } = fixture({ checksession: () => redirect(location) });
    const policy = createBootstrapFetch({
      fetch: base,
      egressHosts: REVIEWED_HOSTS,
    });
    await assert.rejects(
      policy(CHECK_SESSION_URL),
      (error: any) => error?.cause?.code === REDIRECT_DENIED,
      location,
    );
    assert.equal(policy.denied, true, location);
    assert.equal(calls.includes(REDIRECT), false, location);
    assert.equal(calls.includes(PREVIOUS_HYPOTHESIS), false, location);
  }
});

test("an admitted host set cannot make a 3xx without a Location followable", async () => {
  const { base, calls } = fixture({
    checksession: () => new Response(null, { status: 302 }),
  });
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  await assert.rejects(
    policy(CHECK_SESSION_URL),
    (error: any) => error?.cause?.code === REDIRECT_DENIED,
  );
  assert.deepEqual(calls, [CHECK_SESSION_URL]);
});

test("every request is forced to manual so undici cannot follow a redirect unseen", async () => {
  const modes: unknown[] = [];
  const { base } = fixture({ checksession: () => json({ error_code: 0 }) });
  const policy = createBootstrapFetch({
    fetch: async (input, init) => {
      modes.push((init as { redirect?: unknown } | undefined)?.redirect);
      return base(input);
    },
    egressHosts: REVIEWED_HOSTS,
  });
  // The SDK omits the option on most calls and sets it only on checkSession.
  await policy("https://id.zalo.me/account", { headers: { accept: "*/*" } });
  await policy(CHECK_SESSION_URL, { redirect: "follow", headers: {} });
  await policy(CHECK_SESSION_URL, undefined);
  assert.deepEqual(modes, ["manual", "manual", "manual"]);

  const caller = { redirect: "follow", headers: {} };
  await policy(CHECK_SESSION_URL, caller);
  assert.equal(caller.redirect, "follow");
});

test("the real SDK never leaves the fetch mode to undici", async () => {
  const { loginQR } = await import(loginQRModule);
  const { base, calls } = fixture({ checksession: () => redirect(REDIRECT) });
  const modes: unknown[] = [];
  const policy = createBootstrapFetch({
    fetch: async (input, init) => {
      modes.push((init as { redirect?: unknown } | undefined)?.redirect);
      return base(input);
    },
    egressHosts: REVIEWED_HOSTS,
  });
  const ctx = {
    options: {
      logging: false,
      selfListen: false,
      checkUpdate: false,
      polyfill: policy,
    },
    cookie: null,
  };
  await loginQR(ctx, { userAgent: "synthetic-agent" }, () => {}).catch(
    () => undefined,
  );
  assert.equal(modes.length, calls.length);
  assert.ok(modes.length >= 2, String(modes.length));
  assert.deepEqual([...new Set(modes)], ["manual"]);
});

test("the policy reports a refusal without exposing the URL", async () => {
  const { base } = fixture({
    checksession: () => json({ error_code: 0 }),
  });
  const policy = createBootstrapFetch({
    fetch: base,
    egressHosts: REVIEWED_HOSTS,
  });
  assert.equal(policy.denied, false);
  await assert.rejects(policy(REDIRECT));
  assert.equal(policy.denied, true);
  const error = await policy(REDIRECT).catch((value) => value);
  assert.equal(error.message, "fetch failed");
  assert.equal(error.message.includes("jr.zaloapp.com"), false);
  assert.deepEqual(Object.keys(error.cause), ["code"]);
  assert.equal(error.cause.code, REDIRECT_DENIED);
});

// ------------------------------------------------------------ SDK end-to-end

test("the redirect observed on 2026-11-09 resolves the real SDK login", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => redirect(REDIRECT),
  });
  assert.ok("value" in outcome, String(outcome.error));
  assert.equal(outcome.value.userInfo.uid, "synthetic");
  assert.equal(outcome.calls.filter((url) => url === REDIRECT).length, 1);
  assert.ok(outcome.calls.includes("https://jr.chat.zalo.me/jr/userinfo"));
});

test("without the host in the runtime allowlist the same redirect fails closed", async () => {
  const outcome = await run(HOSTS_WITHOUT_REDIRECT, {
    checksession: () => redirect(REDIRECT),
  });
  loginFailed(outcome);
  assert.ok(!outcome.calls.includes(REDIRECT), outcome.calls.join("\n"));
  assert.ok(
    outcome.calls.every((url) => !url.startsWith("https://wpa.chat.zalo.me")),
  );
});

test("the previously assumed chat.zalo.me redirect is now refused", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => redirect(PREVIOUS_HYPOTHESIS),
  });
  loginFailed(outcome);
  assert.ok(
    outcome.calls.every((url) => !url.startsWith("https://chat.zalo.me")),
    outcome.calls.join("\n"),
  );
});

test("a lookalike or downgraded Location fails before the socket", async () => {
  for (const location of [
    "https://jr.zaloapp.com.evil.test/",
    "https://evil.jr.zaloapp.com.test/",
    "https://evil.jr.zaloapp.com/",
    "http://jr.zaloapp.com/",
    "https://user@jr.zaloapp.com/",
    "https://jr.zaloapp.com:8443/",
    "https://jr.zaloapp.com./",
    "https://93.184.216.34/",
    "/index.html",
  ]) {
    const outcome = await run(REVIEWED_HOSTS, {
      checksession: () => redirect(location),
    });
    loginFailed(outcome);
    assert.ok(
      outcome.calls.every((url) => !url.startsWith("https://jr.zaloapp.com.")),
      outcome.calls.join("\n"),
    );
    assert.ok(
      outcome.calls.every(
        (url) =>
          !url.startsWith("https://jr.zaloapp.com:") &&
          !url.startsWith("http://") &&
          !url.startsWith("https://evil."),
      ),
      outcome.calls.join("\n"),
    );
    assert.ok(
      outcome.calls.every((url) => url !== "https://93.184.216.34/"),
      outcome.calls.join("\n"),
    );
  }
});

test("a second hop is refused even when it stays on the redirect host", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => redirect(REDIRECT),
    redirectTarget: () => redirect("https://jr.zaloapp.com/app"),
  });
  loginFailed(outcome);
  assert.equal(outcome.calls.filter((url) => url === REDIRECT).length, 1);
  assert.ok(!outcome.calls.includes("https://jr.zaloapp.com/app"));
});

test("a second hop back to the old hypothesis host is refused", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => redirect(REDIRECT),
    redirectTarget: () => redirect(PREVIOUS_HYPOTHESIS),
  });
  loginFailed(outcome);
  assert.equal(outcome.calls.filter((url) => url === REDIRECT).length, 1);
  assert.ok(!outcome.calls.includes(PREVIOUS_HYPOTHESIS));
});

test("a checkout to another host after the hop is refused", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => redirect(REDIRECT),
    redirectTarget: () => redirect("https://other.example/next"),
  });
  loginFailed(outcome);
  assert.ok(!outcome.calls.includes("https://other.example/next"));
});

test("a session that needs no redirect still resolves", async () => {
  const outcome = await run(REVIEWED_HOSTS, {
    checksession: () => json({ error_code: 0 }),
  });
  assert.ok("value" in outcome, String(outcome.error));
  assert.ok(!outcome.calls.includes(REDIRECT));
});

// ------------------------------------------------------- guard classification

function classified(hosts: string) {
  const script = `
const { _internal } = require(${JSON.stringify(
    resolve(process.cwd(), "ops/pilot-egress-guard.cjs"),
  )});
const t = _internal.classifyTarget;
process.stdout.write(JSON.stringify({
  jr443: t("jr.zaloapp.com", 443),
  jr8443: t("jr.zaloapp.com", 8443),
  chat443: t("chat.zalo.me", 443),
  suffix: t("jr.zaloapp.com.evil.test", 443),
  prefix: t("evil.jr.zaloapp.com.test", 443),
  userinfoLike: t("evil.test@jr.zaloapp.com", 443),
  ip: t("93.184.216.34", 443),
  subdomain: t("evil.jr.zaloapp.com", 443),
}));
`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "NODE_OPTIONS",
    "DATABASE_URL",
    "PILOT_EGRESS_GATEWAY",
    "PILOT_REQUIRE_INTERNAL_NETWORK",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "NODE_USE_ENV_PROXY",
  ])
    delete env[key];
  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...env, PILOT_EGRESS_HOSTS: hosts, PILOT_EGRESS_PORTS: "443" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, string | null>;
}

test("the guard admits the redirect host only when it is in the runtime allowlist", () => {
  const admitted = classified(REVIEWED_HOSTS.join(","));
  assert.equal(admitted.jr443, "provider");
  assert.equal(admitted.jr8443, null);
  assert.equal(admitted.chat443, null);
  assert.equal(admitted.suffix, null);
  assert.equal(admitted.prefix, null);
  assert.equal(admitted.userinfoLike, null);
  assert.equal(admitted.ip, null);
  assert.equal(admitted.subdomain, null);

  const withheld = classified(HOSTS_WITHOUT_REDIRECT.join(","));
  assert.equal(withheld.jr443, null);
});
