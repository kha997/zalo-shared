import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Synthetic G5 manifest for offline preflight only. It contains no real
// account, peer, key or session material and must never be used live.
const [output, stageArg, invalidFlag] = process.argv.slice(2);
const stages = ["bootstrap", "observe", "send-test"] as const;
type Stage = (typeof stages)[number];
if (!output || !stages.includes(stageArg as Stage))
  throw new Error(
    "Usage: g5-synthetic-manifest.ts OUTPUT bootstrap|observe|send-test [--invalid-scope]",
  );
const stage = stageArg as Stage;
if (invalidFlag && invalidFlag !== "--invalid-scope")
  throw new Error("Unknown option");

const lock = await readFile("connector/package-lock.json");
const locked = JSON.parse(lock.toString("utf8"));
const sdkIntegrity = locked.packages?.["node_modules/zca-js"]?.integrity;
if (typeof sdkIntegrity !== "string" || !/^sha512-/.test(sdkIntegrity))
  throw new Error("Connector lock is missing the reviewed zca-js integrity");
const commit =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error("Source commit must be a 40-character lowercase SHA");

const now = Date.now();
const invalid = invalidFlag === "--invalid-scope";
const bootstrap = stage === "bootstrap";
const account = bootstrap ? null : "g5-synthetic-account-a";
const peers = bootstrap
  ? []
  : [invalid ? "g5-synthetic-peer-c" : "g5-synthetic-peer-b"];
const invalidBootstrap = invalid && bootstrap;
const consent = {
  consentRef: "g5-synthetic-consent",
  notAfter: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  expectedAccountId: invalidBootstrap ? "g5-synthetic-account-a" : account,
  allowedPurposes: bootstrap
    ? (["enroll-session"] as const)
    : (["observe", "send-test"] as const),
  allowedPeerIds: invalidBootstrap
    ? ["g5-synthetic-peer-b"]
    : invalid
      ? ["g5-synthetic-peer-b", "g5-synthetic-peer-c"]
      : peers,
  maxPartsPerDay: invalid ? 11 : 10,
  minIntervalMs: 2000,
};
const grant = {
  version: 1,
  grantId: `g5-synthetic-${stage}-grant`,
  purpose: bootstrap ? "enroll-session" : stage,
  sourceCommit: commit,
  lockSha256: createHash("sha256").update(lock).digest("hex"),
  sdkIntegrity,
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(
    now + (bootstrap ? 60 : 120) * 60 * 1000,
  ).toISOString(),
  ownerConsentRef: consent.consentRef,
  dedicatedAccountAttested: true,
  unofficialClientRiskAccepted: true,
  expectedAccountId: consent.expectedAccountId,
  allowedPeerIds: consent.allowedPeerIds,
  maxPartsPerDay: consent.maxPartsPerDay,
  minIntervalMs: consent.minIntervalMs,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      version: 1,
      build: {
        sourceCommit: commit,
        lockSha256: grant.lockSha256,
        sdkIntegrity,
      },
      consent,
      grant,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ manifest: output, stage, invalid }));
