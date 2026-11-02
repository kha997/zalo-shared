import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { readPrivateTextFile } from "../server/private-pilot-files.js";
import {
  validatePilotGrant,
  type PilotConsentScope,
  type PilotGrant,
} from "../server/pilot-policy.js";

export type PilotCommand =
  | "dry-run"
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

export type PilotCommandRunner = (input: {
  command: Exclude<PilotCommand, "dry-run">;
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
}) => Promise<void>;

export type PilotCliDependencies = Readonly<{
  readFile?: (path: string) => Promise<string>;
  now?: () => Date;
  runCommand?: PilotCommandRunner;
}>;

const COMMANDS: readonly PilotCommand[] = [
  "dry-run",
  "bootstrap",
  "run-observe",
  "run-send-test",
];
const GRANT_PURPOSE: Readonly<
  Record<Exclude<PilotCommand, "dry-run">, PilotGrant["purpose"]>
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

function safeOutcome(
  command: PilotCommand,
  ok: boolean,
  gate: string,
  manifest?: PilotManifest,
): string {
  return JSON.stringify({
    command,
    ok,
    gate,
    ...(manifest
      ? { purpose: manifest.grant.purpose, expiresAt: manifest.grant.expiresAt }
      : {}),
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
        "Pilot CLI denied: expected [dry-run|bootstrap|run-observe|run-send-test] [--manifest <private-path>] [--acknowledge-pilot-risk]",
    };

  const command = parsed.command;
  if (command !== "dry-run" && parsed.acknowledge !== true)
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
    await options.dependencies.runCommand({
      command,
      manifest,
      env,
    });
    return {
      exitCode: 0,
      stdout: safeOutcome(command, true, "completed", manifest),
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
  command: Exclude<PilotCommand, "dry-run">;
  manifest: PilotManifest;
  env: Record<string, string | undefined>;
}) {
  if (input.command !== "bootstrap") throw unavailable();
  if (process.platform !== "linux") throw unavailable();
  const { env, manifest } = input;
  const databaseUrl = env.DATABASE_URL;
  const keyPath = env.PILOT_KEY_FILE;
  const sessionPath = env.PILOT_SESSION_FILE;
  const viewDirectory = env.PILOT_VIEW_DIR;
  if (
    !databaseUrl ||
    !/^postgres(ql)?:\/\//.test(databaseUrl) ||
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
    owner = await ownership.acquireConnectorOwnership(pool, {
      ownerLabel: "pilot-enrollment",
      onRevoked: () => controller.abort(),
    });
    const key = await files.readPrivateKeyFile(keyPath);
    const sessionStore = new files.PrivateSessionFile({
      path: sessionPath,
      key,
    });
    const view = new files.PrivateQrFileView({ directory: viewDirectory });
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

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const result = await runPilotCli({
    argv,
    env,
    dependencies: { runCommand: liveBootstrap },
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
