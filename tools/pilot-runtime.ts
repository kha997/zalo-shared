import type pg from "pg";
import { isAbsolute } from "node:path";
import type { OwnershipHandle } from "../server/connector-ownership.js";
import { ProviderNotDispatchedError, type Provider } from "../server/worker.js";
import {
  validatePilotGrant,
  type PilotGrant,
} from "../server/pilot-policy.js";
import type { PilotManifest } from "./pilot-connector.js";
import {
  assertBuildIdentity,
  readBuildIdentity,
  requireTlsDatabaseUrl,
} from "./pilot-gates.js";
import {
  createOwnedConnector,
  type OwnedConnector,
} from "../adapters/zalo/connector-runtime.js";
import {
  createSdkProvider,
  type PilotDispatchHaltReason,
} from "../adapters/zalo/provider.js";

export type PilotMode = "observe" | "send-test";
export type PilotLoopHalt =
  | "tick-limit"
  | "grant-expired"
  | "aborted"
  | "runtime-error"
  | PilotDispatchHaltReason;
export type PilotConnector = Pick<
  OwnedConnector,
  "start" | "stop" | "runOnce"
> & {
  runMediaOnce?(): Promise<unknown>;
  readonly rejectedInbound?: number;
};

const unavailable = () => new Error("Pilot runtime unavailable");
const accountId = /^[A-Za-z0-9_-]{1,200}$/;
const peers = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= 4 &&
  value.every((peer) => typeof peer === "string" && accountId.test(peer)) &&
  new Set(value).size === value.length;
const MODE_PURPOSE: Readonly<Record<PilotMode, PilotGrant["purpose"]>> = {
  observe: "observe",
  "send-test": "send-test",
};
const MAX_TICKS = 7 * 24 * 60 * 60;
const MAX_TICK_MS = 60_000;
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function grantShape(grant: unknown): grant is PilotGrant {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return false;
  const g = grant as Record<string, unknown>;
  const issued = Date.parse(g.issuedAt as string);
  const expires = Date.parse(g.expiresAt as string);
  return (
    g.version === 1 &&
    typeof g.grantId === "string" &&
    accountId.test(g.grantId) &&
    typeof g.ownerConsentRef === "string" &&
    accountId.test(g.ownerConsentRef) &&
    typeof g.expectedAccountId === "string" &&
    accountId.test(g.expectedAccountId) &&
    peers(g.allowedPeerIds) &&
    !g.allowedPeerIds.includes(g.expectedAccountId) &&
    Number.isInteger(g.maxPartsPerDay) &&
    (g.maxPartsPerDay as number) >= 1 &&
    (g.maxPartsPerDay as number) <= 30 &&
    Number.isInteger(g.minIntervalMs) &&
    (g.minIntervalMs as number) >= 2000 &&
    (g.minIntervalMs as number) <= 60000 &&
    Number.isFinite(issued) &&
    Number.isFinite(expires) &&
    expires > issued &&
    expires - issued <= 8 * 60 * 60 * 1000 &&
    g.dedicatedAccountAttested === true &&
    g.unofficialClientRiskAccepted === true
  );
}

function fresh(grant: PilotGrant, now: () => Date) {
  let current: unknown;
  try {
    current = now();
  } catch {
    return false;
  }
  const value = current instanceof Date ? current.getTime() : NaN;
  const issued = Date.parse(grant.issuedAt);
  const expires = Date.parse(grant.expiresAt);
  return (
    Number.isFinite(value) &&
    Number.isFinite(issued) &&
    Number.isFinite(expires) &&
    value < expires &&
    value + 30_000 >= issued
  );
}

/**
 * Bounded driver seam. Observe never dispatches; send-test reserves before
 * every part inside the provider. Any error stops the loop without retrying.
 */
export async function runPilotLoop(input: {
  connector: PilotConnector;
  mode: PilotMode;
  grant: PilotGrant;
  maxTicks: number;
  tickMs?: number;
  media?: boolean;
  now?: () => Date;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  haltReason?: () => PilotDispatchHaltReason | undefined;
}): Promise<{ halt: PilotLoopHalt; ticks: number; rejectedInbound: number }> {
  if (!input || typeof input !== "object") throw unavailable();
  const tickMs = input?.tickMs ?? 500;
  const now = input?.now ?? (() => new Date());
  const sleep = input?.sleep ?? defaultSleep;
  const grant = input?.grant;
  const connector = input?.connector;
  if (
    !connector ||
    typeof connector.start !== "function" ||
    typeof connector.stop !== "function" ||
    typeof connector.runOnce !== "function" ||
    (input.mode !== "observe" && input.mode !== "send-test") ||
    !grantShape(grant) ||
    grant.purpose !== MODE_PURPOSE[input.mode] ||
    !Number.isInteger(input.maxTicks) ||
    input.maxTicks < 1 ||
    input.maxTicks > MAX_TICKS ||
    !Number.isInteger(tickMs) ||
    tickMs < 0 ||
    tickMs > MAX_TICK_MS ||
    (input.media === true && typeof connector.runMediaOnce !== "function") ||
    (input.now !== undefined && typeof input.now !== "function") ||
    (input.sleep !== undefined && typeof input.sleep !== "function") ||
    (input.haltReason !== undefined &&
      typeof input.haltReason !== "function")
  )
    throw unavailable();
  if (!fresh(grant, now)) throw unavailable();

  if (input.signal?.aborted) {
    try {
      await connector.stop();
    } catch {}
    return { halt: "aborted", ticks: 0, rejectedInbound: 0 };
  }

  let ticks = 0;
  let halt: PilotLoopHalt = "tick-limit";
  try {
    await connector.start();
    while (ticks < input.maxTicks) {
      if (input.signal?.aborted) {
        halt = "aborted";
        break;
      }
      if (!fresh(grant, now)) {
        halt = "grant-expired";
        break;
      }
      if (input.mode === "send-test") await connector.runOnce();
      else if (input.media === true) await connector.runMediaOnce!();
      ticks++;
      const policyHalt = input.haltReason?.();
      if (policyHalt) {
        halt = policyHalt;
        break;
      }
      if (ticks < input.maxTicks) await sleep(tickMs);
    }
  } catch {
    let policyHalt: PilotDispatchHaltReason | undefined;
    try {
      policyHalt = input.haltReason?.();
    } catch {}
    halt = policyHalt ?? (input.signal?.aborted ? "aborted" : "runtime-error");
  } finally {
    try {
      await connector.stop();
    } catch {}
  }
  const rejected = (connector as { rejectedInbound?: unknown }).rejectedInbound;
  return {
    halt,
    ticks,
    rejectedInbound:
      Number.isInteger(rejected) && (rejected as number) >= 0
        ? (rejected as number)
        : 0,
  };
}

/** Observe-mode provider: it can never dispatch, even if runOnce is misused. */
export function createObserveProvider(): Provider {
  return {
    async connected() {
      return false;
    },
    async sendPart() {
      throw new ProviderNotDispatchedError();
    },
  };
}

/** Maps the encrypted record shape to the facade's bare credential shape. */
export function bindPilotSession(
  store: { read(): Promise<unknown>; write(value: unknown): Promise<void> },
  expected: string,
) {
  const session = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw unavailable();
    const record = value as Record<string, any>;
    const session = record.session;
    if (
      record.version !== 1 ||
      record.accountId !== expected ||
      !session ||
      typeof session !== "object" ||
      Array.isArray(session) ||
      Object.keys(session).sort().join(",") !== "cookie,imei,userAgent" ||
      typeof session.imei !== "string" ||
      session.imei.length < 1 ||
      session.imei.length > 512 ||
      typeof session.userAgent !== "string" ||
      session.userAgent.length < 1 ||
      session.userAgent.length > 1024 ||
      !Array.isArray(session.cookie)
    )
      throw unavailable();
    return session;
  };
  return {
    async read() {
      return session(await store.read());
    },
    async write(value: unknown) {
      await store.write({ version: 1, accountId: expected, session: value });
    },
  };
}

/**
 * Real pilot host wiring. Refuses anything except a Linux private host, a
 * bound manifest account and an absolute private key/session path.
 */
export async function startPilotRuntime(input: {
  command: "run-observe" | "run-send-test";
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}): Promise<{ halt: PilotLoopHalt; ticks: number; rejectedInbound: number }> {
  if (process.platform !== "linux") throw unavailable();
  if (
    !input ||
    typeof input !== "object" ||
    (input.command !== "run-observe" && input.command !== "run-send-test")
  )
    throw unavailable();
  const mode: PilotMode =
    input.command === "run-send-test" ? "send-test" : "observe";
  const manifest = input.manifest;
  if (!manifest || typeof manifest !== "object") throw unavailable();
  // Re-validate the complete manifest: the runtime must never accept a bare
  // grant-shaped object that skipped the consent scope or build binding.
  // Collapse policy-module errors into the single boundary error so callers
  // cannot distinguish grant, consent or identity failures.
  let grant: ReturnType<typeof validatePilotGrant>;
  try {
    grant = validatePilotGrant(
      manifest.grant,
      manifest.build,
      manifest.consent,
      new Date(),
    );
  } catch {
    throw unavailable();
  }
  if (
    grant.purpose !== MODE_PURPOSE[mode] ||
    !grantShape(grant) ||
    !fresh(grant, () => new Date())
  )
    throw unavailable();
  let identity: unknown;
  try {
    identity = await readBuildIdentity();
  } catch {
    throw unavailable();
  }
  assertBuildIdentity(identity, manifest.build);
  const env = input.env ?? {};
  const databaseUrl = env.DATABASE_URL;
  const keyPath = env.PILOT_KEY_FILE;
  const sessionPath = env.PILOT_SESSION_FILE;
  if (
    !databaseUrl ||
    !keyPath ||
    !isAbsolute(keyPath) ||
    !sessionPath ||
    !isAbsolute(sessionPath)
  )
    throw unavailable();
  requireTlsDatabaseUrl(databaseUrl);

  // Preflight module loading and pool construction must also fail closed:
  // a missing compiled module or a bad driver shape is indistinguishable to
  // the caller from any other unavailable runtime.
  let loaded: {
    files: typeof import("../server/private-pilot-files.js");
    facadeModule: typeof import("../adapters/zalo/sdk-facade.js");
    ownership: typeof import("../server/connector-ownership.js");
    pool: pg.Pool;
  };
  try {
    const [pgModule, files, facadeModule, ownership] = await Promise.all([
      import("pg"),
      import("../server/private-pilot-files.js"),
      import("../adapters/zalo/sdk-facade.js"),
      import("../server/connector-ownership.js"),
    ]);
    const Pool = (pgModule as any).default?.Pool ?? (pgModule as any).Pool;
    if (typeof Pool !== "function") throw unavailable();
    loaded = {
      files,
      facadeModule,
      ownership,
      pool: new Pool({ connectionString: databaseUrl, max: 4 }),
    };
  } catch {
    throw unavailable();
  }
  const { files, facadeModule, ownership, pool } = loaded;
  const controller = new AbortController();
  if (input.signal?.aborted) controller.abort();
  const forwardAbort = () => controller.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let policyHalt: PilotDispatchHaltReason | undefined;
  let connector: OwnedConnector | undefined;
  try {
    const key = await files.readPrivateKeyFile(keyPath);
    const store = new files.PrivateSessionFile({
      path: sessionPath,
      key,
      keyId: env.PILOT_KEY_ID ?? "v1",
    });
    const sessionStore = bindPilotSession(store, grant.expectedAccountId!);
    connector = createOwnedConnector({
      pool,
      ownerLabel: mode === "observe" ? "pilot-observe" : "pilot-send-test",
      transportOptions: { reconnectDelayMs: 5000 },
      inbound: {
        accountId: grant.expectedAccountId!,
        allowedPeerIds: grant.allowedPeerIds,
      },
      publishConnected: true,
      guard: () => {
        try {
          return !controller.signal.aborted && fresh(grant, () => new Date());
        } catch {
          return false;
        }
      },
      // Both modes keep any accidental worker claim inside the grant peers;
      // observe never constructs a dispatching provider, but its interrupted
      // sweep must also stay scoped.
      dispatchPeers: grant.allowedPeerIds,
      createFacade: () =>
        facadeModule.createBoundSdkFacade({
          sessionStore,
          expectedAccountId: grant.expectedAccountId!,
          allowNetworkLogin: true,
          loginTimeoutMs: 30_000,
        }),
      createProvider: (pool, transport, owner) =>
        mode === "send-test"
          ? createSdkProvider(pool, transport, owner, {
              grant,
              onHalt: (reason) => {
                policyHalt = reason;
                controller.abort();
              },
            })
          : createObserveProvider(),
      acquireOwnership: ownership.acquireConnectorOwnership,
    });
    return await runPilotLoop({
      connector,
      mode,
      grant,
      maxTicks: MAX_TICKS,
      tickMs:
        mode === "observe" ? 1000 : Math.max(2000, grant.minIntervalMs),
      media: false,
      signal: controller.signal,
      haltReason: () => policyHalt,
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    await pool.end().catch(() => {});
  }
}
