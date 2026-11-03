import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { readPrivateTextFile } from "../server/private-pilot-files.js";
import {
  validatePilotGrant,
  type PilotConsentScope,
  type PilotGrant,
} from "../server/pilot-policy.js";
import {
  assertBuildIdentity,
  readBuildIdentity,
  requireTlsDatabaseUrl,
} from "./pilot-gates.js";
import {
  assertG5Scope,
  g5ScopeSummary,
  g5StageForPurpose,
} from "./g5-policy.js";

export type PilotCommand =
  | "dry-run"
  | "preflight"
  | "bootstrap"
  | "run-observe"
  | "run-send-test";

export type PilotBuildIdentity = Readonly<{
  sourceCommit: string;
  lockSha256: string;
  sdkIntegrity: string;
}>;

export type PilotManifest = Readonly<{
  version: 1;
  build: PilotBuildIdentity;
  consent: PilotConsentScope;
  grant: PilotGrant;
}>;

export type PilotCliResult = Readonly<{
  exitCode: 0 | 1 | 2;
  stdout?: string;
  stderr?: string;
}>;

export type PilotCommandOutcome = Readonly<{
  halt?: string;
  ticks?: number;
  rejectedInbound?: number;
}>;

export type PilotCommandRunner = (input: {
  command: Exclude<PilotCommand, "dry-run" | "preflight">;
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
}) => Promise<void | PilotCommandOutcome>;

export type PilotCliDependencies = Readonly<{
  readFile?: (path: string) => Promise<string>;
  readBuildIdentity?: () => Promise<unknown>;
  now?: () => Date;
  runCommand?: PilotCommandRunner;
}>;

const COMMANDS: readonly PilotCommand[] = [
  "dry-run",
  "preflight",
  "bootstrap",
  "run-observe",
  "run-send-test",
];
const GRANT_PURPOSE: Readonly<
  Record<Exclude<PilotCommand, "dry-run" | "preflight">, PilotGrant["purpose"]>
> = {
  bootstrap: "enroll-session",
  "run-observe": "observe",
  "run-send-test": "send-test",
};
const MANIFEST_KEYS = ["version", "build", "consent", "grant"] as const;
const BUILD_KEYS = ["sourceCommit", "lockSha256", "sdkIntegrity"] as const;
const MAX_MANIFEST_BYTES = 64 * 1024;
const QUARANTINE_GATE = "quarantine-unconfirmed";
const unavailable = () => new Error("Pilot CLI unavailable");

const object = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
) => {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
};

export type ParsedPilotArgs = Readonly<{
  ok: boolean;
  command: PilotCommand;
  manifestPath?: string;
  acknowledge?: boolean;
}>;

export function parsePilotArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ParsedPilotArgs {
  let index = 0;
  let command: PilotCommand = "dry-run";
  if (argv[0] && !argv[0].startsWith("-")) {
    if (!COMMANDS.includes(argv[0] as PilotCommand))
      return { ok: false, command: "dry-run" };
    command = argv[0] as PilotCommand;
    index = 1;
  }
  let manifestPath: string | undefined;
  let acknowledge = false;
  for (; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--acknowledge-pilot-risk") {
      if (acknowledge) return { ok: false, command };
      acknowledge = true;
      continue;
    }
    if (value === "--manifest") {
      const path = argv[++index];
      if (manifestPath || !path || path.startsWith("-"))
        return { ok: false, command };
      manifestPath = path;
      continue;
    }
    if (value.startsWith("--manifest=")) {
      const path = value.slice("--manifest=".length);
      if (manifestPath || !path) return { ok: false, command };
      manifestPath = path;
      continue;
    }
    return { ok: false, command };
  }
  manifestPath ??= env.PILOT_MANIFEST;
  if (!manifestPath || !isAbsolute(manifestPath))
    return { ok: false, command };
  return { ok: true, command, manifestPath, acknowledge };
}

export function parsePilotManifest(text: string, now: Date): PilotManifest {
  try {
    const value: unknown = JSON.parse(text);
    if (!object(value) || !exactKeys(value, MANIFEST_KEYS) || value.version !== 1)
      throw unavailable();
    const build = value.build;
    if (!object(build) || !exactKeys(build, BUILD_KEYS)) throw unavailable();
    const grant = validatePilotGrant(
      value.grant,
      {
        sourceCommit: build.sourceCommit as string,
        lockSha256: build.lockSha256 as string,
        sdkIntegrity: build.sdkIntegrity as string,
      },
      value.consent,
      now,
    );
    const consent = value.consent as PilotConsentScope;
    return Object.freeze({
      version: 1 as const,
      build: Object.freeze({
        sourceCommit: build.sourceCommit as string,
        lockSha256: build.lockSha256 as string,
        sdkIntegrity: build.sdkIntegrity as string,
      }),
      consent: Object.freeze({
        ...consent,
        allowedPurposes: Object.freeze([...consent.allowedPurposes]),
        allowedPeerIds: Object.freeze([...consent.allowedPeerIds]),
      }),
      grant,
    });
  } catch {
    throw unavailable();
  }
}

// Any halt not listed here is treated as a safety failure so a new or unknown
// reason can never produce a successful exit. The gate echoed to stdout is
// restricted to these literals: a future runner string must not leak details.
const COMPLETION_HALTS = new Set([
  "tick-limit",
  "grant-expired",
  "session-limit",
  "aborted",
]);
const KNOWN_HALTS = new Set([
  ...COMPLETION_HALTS,
  "connection-lost",
  "runtime-error",
  "already-reserved",
  "reservation-denied",
  "dispatch-uncertain",
]);
const counter = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;

function safeOutcome(
  command: PilotCommand,
  ok: boolean,
  gate: string,
  manifest?: PilotManifest,
  outcome?: PilotCommandOutcome,
): string {
  const ticks = counter(outcome?.ticks);
  const rejectedInbound = counter(outcome?.rejectedInbound);
  return JSON.stringify({
    command,
    ok,
    gate,
    ...(manifest
      ? { purpose: manifest.grant.purpose, expiresAt: manifest.grant.expiresAt }
      : {}),
    ...(ticks !== undefined ? { ticks } : {}),
    ...(rejectedInbound !== undefined ? { rejectedInbound } : {}),
  });
}

/** Dry-run is the default and never reads the vault, imports the SDK, writes a QR, or touches DB/network. */
export async function runPilotCli(options: {
  argv: readonly string[];
  env?: Record<string, string | undefined>;
  dependencies?: PilotCliDependencies;
}): Promise<PilotCliResult> {
  const env = options.env ?? {};
  const readFile =
    options.dependencies?.readFile ??
    ((path: string) => readPrivateTextFile(path, MAX_MANIFEST_BYTES));
  const now = options.dependencies?.now ?? (() => new Date());
  const parsed = parsePilotArgs(options.argv, env);
  if (!parsed.ok)
    return {
      exitCode: 2,
      stderr:
        "Pilot CLI denied: expected [dry-run|preflight|bootstrap|run-observe|run-send-test] [--manifest <private-path>] [--acknowledge-pilot-risk]",
    };

  const command = parsed.command;
  if (
    command !== "dry-run" &&
    command !== "preflight" &&
    parsed.acknowledge !== true
  )
    return {
      exitCode: 1,
      stdout: safeOutcome(command, false, "denied"),
    };

  let manifest: PilotManifest;
  try {
    const text = await readFile(parsed.manifestPath!);
    manifest = parsePilotManifest(text, now());
  } catch {
    return {
      exitCode: 1,
      stdout: safeOutcome(command, false, "denied"),
    };
  }

  if (command === "dry-run")
    return {
      exitCode: 0,
      stdout: safeOutcome(command, true, "admitted", manifest),
    };

  if (command === "preflight") {
    try {
      // A preflight manifest must bind to the image under test, not merely to
      // the shape of a grant. The live command repeats this check before any
      // key, session, database or SDK action.
      const identity =
        options.dependencies?.readBuildIdentity ?? readBuildIdentity;
      assertBuildIdentity(await identity(), manifest.build);
      assertG5Scope(
        g5StageForPurpose(manifest.grant.purpose),
        manifest.grant,
      );
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          command,
          ok: true,
          gate: "admitted",
          ...g5ScopeSummary(manifest.grant),
          expiresAt: manifest.grant.expiresAt,
        }),
      };
    } catch {
      return {
        exitCode: 1,
        stdout: safeOutcome(command, false, "denied", manifest),
      };
    }
  }

  if (manifest.grant.purpose !== GRANT_PURPOSE[command])
    return {
      exitCode: 1,
      stdout: safeOutcome(command, false, "denied", manifest),
    };
  if (!options.dependencies?.runCommand)
    return {
      exitCode: 1,
      stdout: safeOutcome(command, false, "unavailable", manifest),
    };

  try {
    const returned = await options.dependencies.runCommand({
      command,
      manifest,
      env,
    });
    const outcome =
      returned !== null && typeof returned === "object"
        ? (returned as PilotCommandOutcome)
        : undefined;
    const rawHalt =
      outcome && "halt" in outcome
        ? (outcome as { halt?: unknown }).halt
        : undefined;
    // Only the reviewed literals may reach the operator-visible gate. A
    // non-string, future or corrupted reason is a safety failure, never an
    // implicit success, and is collapsed into the generic gate.
    const halt =
      typeof rawHalt === "string" && KNOWN_HALTS.has(rawHalt)
        ? rawHalt
        : undefined;
    if (rawHalt !== undefined && halt === undefined)
      return {
        exitCode: 1,
        stdout: safeOutcome(command, false, "runtime-error", manifest, outcome),
      };
    if (halt !== undefined && !COMPLETION_HALTS.has(halt))
      return {
        exitCode: 1,
        stdout: safeOutcome(command, false, halt, manifest, outcome),
      };
    return {
      exitCode: 0,
      stdout: safeOutcome(command, true, halt ?? "completed", manifest, outcome),
    };
  } catch (error) {
    const gate =
      (error as { code?: unknown } | null)?.code === QUARANTINE_GATE
        ? QUARANTINE_GATE
        : "unavailable";
    return {
      exitCode: 1,
      stdout: safeOutcome(command, false, gate, manifest),
    };
  }
}

async function liveBootstrap(input: {
  command: Exclude<PilotCommand, "dry-run" | "preflight">;
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
}) {
  if (input.command !== "bootstrap") throw unavailable();
  if (process.platform !== "linux") throw unavailable();
  const { env, manifest } = input;
  try {
    assertG5Scope("bootstrap", manifest.grant);
  } catch {
    throw unavailable();
  }
  // Enrollment must also bind to the reviewed image, not a copied manifest.
  assertBuildIdentity(await readBuildIdentity(), manifest.build);
  const databaseUrl = requireTlsDatabaseUrl(env.DATABASE_URL);
  const keyPath = env.PILOT_KEY_FILE;
  const sessionPath = env.PILOT_SESSION_FILE;
  const viewDirectory = env.PILOT_VIEW_DIR;
  if (
    !keyPath ||
    !isAbsolute(keyPath) ||
    !sessionPath ||
    !isAbsolute(sessionPath) ||
    !viewDirectory ||
    !isAbsolute(viewDirectory)
  )
    throw unavailable();

  const [pgModule, ownership, files, qr] = await Promise.all([
    import("pg"),
    import("../server/connector-ownership.js"),
    import("../server/private-pilot-files.js"),
    import("../adapters/zalo/qr-bootstrap.js"),
  ]);
  const Pool = (pgModule as any).default?.Pool ?? (pgModule as any).Pool;
  if (typeof Pool !== "function") throw unavailable();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let owner: Awaited<
    ReturnType<typeof ownership.acquireConnectorOwnership>
  > | undefined;
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    // Private-file validation must precede ownership: a typo in a key or
    // session path must not bump the epoch or quarantine provider state.
    const key = await files.readPrivateKeyFile(keyPath);
    const sessionStore = new files.PrivateSessionFile({
      path: sessionPath,
      key,
      keyId: env.PILOT_KEY_ID ?? "v1",
    });
    const view = new files.PrivateQrFileView({ directory: viewDirectory });
    // Validate the private destinations before ownership: a wrong session
    // directory or QR view mode must not bump the epoch or quarantine state.
    await files.ensurePrivateDirectory(dirname(sessionPath));
    await files.ensurePrivateDirectory(viewDirectory);
    owner = await ownership.acquireConnectorOwnership(pool, {
      ownerLabel: "pilot-enrollment",
      onRevoked: () => controller.abort(),
    });
    await qr.bootstrapPilotSession({
      grant: manifest.grant,
      owner,
      view,
      sessionStore,
      loader: () => import("zca-js"),
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await owner?.close().catch(() => {});
    await pool.end().catch(() => {});
  }
}

async function liveCommand(input: {
  command: Exclude<PilotCommand, "dry-run" | "preflight">;
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
}) {
  if (input.command === "bootstrap") return liveBootstrap(input);
  const runtime = await import("./pilot-runtime.js");
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await runtime.startPilotRuntime({
      command: input.command,
      manifest: input.manifest,
      env: input.env,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const result = await runPilotCli({
    argv,
    env,
    dependencies: { runCommand: liveCommand },
  });
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  return result.exitCode;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
