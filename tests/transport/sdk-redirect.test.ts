import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Offline reproduction of the post-confirmation handshake.
 *
 * The 2026-11-09 attempt observed the checkSession redirect naming
 * jr.zaloapp.com; the 2026-11-04 attempt was consistent with the same shape but
 * without host attribution. The pinned SDK is driven through its real `loginQR`
 * implementation with a synthetic `fetch` polyfill, so no socket, DNS query or
 * provider contact happens. The redirect host is deliberately withheld from the
 * child's environment in the guard tests, even though the reviewed four-host
 * allowlist admits it, so the real `ops/pilot-egress-guard.cjs` must refuse it.
 */

const guard = resolve(process.cwd(), "ops/pilot-egress-guard.cjs");
const sdkRoot = resolve(process.cwd(), "node_modules/zca-js");
const loginQRModule = pathToFileURL(
  resolve(sdkRoot, "dist/apis/loginQR.js"),
).href;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type SessionFixture = "redirect-jr" | "redirect-foreign" | "ok";

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

function fixture(session: SessionFixture) {
  const calls: string[] = [];
  const polyfill = async (input: unknown) => {
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
          if (session === "redirect-jr")
            return new Response(null, {
              status: 302,
              headers: { location: "https://jr.zaloapp.com/index.html" },
            });
          if (session === "redirect-foreign")
            return new Response(null, {
              status: 302,
              headers: { location: "https://redirect.example.test/next" },
            });
          return json({ error_code: 0 });
        default:
          throw new Error("unexpected provider path");
      }
    }
    if (
      parsed.origin === "https://jr.zaloapp.com" ||
      parsed.origin === "https://redirect.example.test"
    ) {
      // What the process guard does: fail before any socket is created, so the
      // gateway never sees the destination and logs no denial.
      const error = new TypeError("fetch failed");
      (error as any).cause = { code: "PILOT_EGRESS_DENIED" };
      throw error;
    }
    if (parsed.origin === "https://jr.chat.zalo.me")
      return json({ error_code: 0, data: { logged: true, info: { uid: "synthetic" } } });
    throw new Error("unexpected destination");
  };
  return { polyfill, calls };
}

async function run(fixtureKind: SessionFixture): Promise<{
  value?: any;
  error?: Error;
  calls: string[];
  events: number[];
  LoginQRCallbackEventType: any;
}> {
  const { loginQR, LoginQRCallbackEventType } = await import(loginQRModule);
  const { polyfill, calls } = fixture(fixtureKind);
  const events: number[] = [];
  const ctx = {
    options: { logging: false, selfListen: false, checkUpdate: false, polyfill },
    cookie: null,
  };
  const result = await loginQR(
    ctx,
    { userAgent: "synthetic-agent" },
    (event: { type: number }) => events.push(event.type),
  ).then(
    (value: unknown) => ({ value }),
    (error: Error) => ({ error }),
  );
  return { ...result, calls, events, LoginQRCallbackEventType };
}

function guarded(script: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.DATABASE_URL;
  delete env.PILOT_EGRESS_GATEWAY;
  delete env.PILOT_REQUIRE_INTERNAL_NETWORK;
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "NODE_USE_ENV_PROXY",
  ])
    delete env[key];
  return spawnSync(process.execPath, ["-r", guard, "-e", script], {
    env: {
      ...env,
      PILOT_EGRESS_HOSTS: "id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me",
      PILOT_EGRESS_PORTS: "443",
    },
    encoding: "utf8",
    timeout: 5000,
  });
}

function connect(host: string) {
  return `
try {
  const socket = require("node:net").connect(443, ${JSON.stringify(host)});
  socket.on("connect", () => console.log("CONNECTED"));
  socket.on("error", (error) => console.log("ERROR", error.code || error.message));
} catch (error) {
  console.log("THREW", error.code || error.message);
}
`;
}

test("the pinned SDK follows a checkSession Location to jr.zaloapp.com", async () => {
  const outcome = await run("redirect-jr");
  assert.ok("error" in outcome, "loginQR must fail when the redirect fails");
  assert.match(
    (outcome.error as Error).message,
    /Cannot get session, login failed/,
  );
  const checksession = outcome.calls.findIndex((url) =>
    url.startsWith("https://id.zalo.me/account/checksession"),
  );
  assert.ok(checksession >= 0);
  assert.ok(
    outcome.calls.includes("https://jr.zaloapp.com/index.html"),
    outcome.calls.join("\n"),
  );
  assert.ok(
    outcome.calls.every((url) => !url.startsWith("https://wpa.chat.zalo.me")),
  );
  assert.ok(
    outcome.calls.every((url) => !url.startsWith("https://jr.chat.zalo.me")),
  );
  assert.ok(
    !outcome.events.includes(outcome.LoginQRCallbackEventType.GotLoginInfo),
  );
  // The error text is the SDK's fixed sentence; it never echoes the redirect.
  assert.ok(!(outcome.error as Error).message.includes("jr.zaloapp.com"));
});

test("the SDK follows any Location, so an unlisted redirect is refused too", async () => {
  const outcome = await run("redirect-foreign");
  assert.ok("error" in outcome);
  assert.match(
    (outcome.error as Error).message,
    /Cannot get session, login failed/,
  );
  assert.ok(
    outcome.calls.includes("https://redirect.example.test/next"),
    outcome.calls.join("\n"),
  );
});

test("without a redirect the SDK reaches userinfo and resolves", async () => {
  const outcome = await run("ok");
  assert.ok("value" in outcome, String((outcome as any).error));
  const value = (outcome as any).value;
  assert.ok(Array.isArray(value.cookies));
  assert.equal(value.userInfo.uid, "synthetic");
  assert.ok(
    outcome.calls.includes("https://jr.chat.zalo.me/jr/userinfo"),
    outcome.calls.join("\n"),
  );
});

test("the connector guard refuses the redirect host before any socket", () => {
  for (const host of [
    "jr.zaloapp.com",
    "chat.zalo.me",
    "redirect.example.test",
  ]) {
    const result = guarded(connect(host));
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "THREW PILOT_EGRESS_DENIED", host);
  }
});

test("the installed SDK is the reviewed pin and still uses the observed URL", async () => {
  const pkg = JSON.parse(await readFile(resolve(sdkRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "zca-js");
  assert.equal(pkg.version, "2.2.0");
  const source = await readFile(
    resolve(sdkRoot, "dist/apis/loginQR.js"),
    "utf8",
  );
  assert.ok(
    source.includes(
      "https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html",
    ),
  );
  assert.ok(!/\blogout\b/.test(source));
  const utils = await readFile(resolve(sdkRoot, "dist/utils.js"), "utf8");
  assert.match(utils, /response\.headers\.get\("location"\)/);
});