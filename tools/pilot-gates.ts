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
 */
export function requireTlsDatabaseUrl(value: string | undefined) {
  if (typeof value !== "string" || !/^postgres(ql)?:\/\//.test(value))
    throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  if (!url.hostname || !/^\d{1,5}$/.test(url.port || "5432"))
    throw unavailable();
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (
    !loopback &&
    !["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    )
  )
    throw unavailable();
  if (url.searchParams.get("ssl") === "false") throw unavailable();
  return value;
}
