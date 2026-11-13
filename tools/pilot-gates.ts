import { readFile } from "node:fs/promises";

/** Emitted by ops/Dockerfile.connector; grants must bind to this image. */
export const BUILD_IDENTITY_PATH = "/app/build-identity.json";
const keys = ["lockSha256", "sdkIntegrity", "sourceCommit", "version"] as const;
const unavailable = () => new Error("Pilot runtime unavailable");

/**
 * Compares the manifest's self-declared build block with the identity emitted
 * by the image build, so a swapped manifest cannot rebind a grant.
 */
export function assertBuildIdentity(
  identity: unknown,
  build: {
    sourceCommit: string;
    lockSha256: string;
    sdkIntegrity: string;
  },
) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity))
    throw unavailable();
  const value = identity as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",") ||
    value.version !== 1 ||
    typeof value.sourceCommit !== "string" ||
    value.sourceCommit !== build?.sourceCommit ||
    typeof value.lockSha256 !== "string" ||
    value.lockSha256 !== build?.lockSha256 ||
    typeof value.sdkIntegrity !== "string" ||
    value.sdkIntegrity !== build?.sdkIntegrity
  )
    throw unavailable();
}

export async function readBuildIdentity(path = BUILD_IDENTITY_PATH) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw unavailable();
  }
}

/**
 * Remote database connections must negotiate TLS. Loopback is permitted for a
 * same-host private deployment where the operator controls the socket.
 *
 * pg-connection-string lets query parameters override the host and takes the
 * last duplicate sslmode, so the URL is admitted only when it contains no
 * target/credential/TLS override. The remaining parameters cannot change the
 * destination or disable TLS.
 */
const DATABASE_PARAMETERS = new Set([
  "sslmode",
  "application_name",
  "connect_timeout",
  "keepalives",
  "keepalives_idle",
  "keepalives_interval",
  "keepalives_count",
  "tcp_user_timeout",
  "options",
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
  "target_session_attrs",
]);
export function requireTlsDatabaseUrl(value: string | undefined) {
  if (typeof value !== "string" || !/^postgres(ql)?:\/\//.test(value))
    throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  if (
    !url.hostname ||
    url.hostname.includes("%") ||
    url.hash ||
    !url.pathname ||
    url.pathname === "/" ||
    !/^\d{1,5}$/.test(url.port || "5432")
  )
    throw unavailable();
  const modes = url.searchParams.getAll("sslmode");
  if (modes.length > 1) throw unavailable();
  for (const [key] of url.searchParams) {
    if (!DATABASE_PARAMETERS.has(key)) throw unavailable();
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (
    !loopback &&
    !["require", "verify-ca", "verify-full"].includes(modes[0] ?? "")
  )
    throw unavailable();
  return value;
}
