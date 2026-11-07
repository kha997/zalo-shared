import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Synthetic CI-only manifest. It contains no account, peer, key or session
// material and is accepted only for the offline dry-run gate.
const output =
  process.argv[2] ?? "docs/evidence/pilot-manifest.synthetic.json";
const lock = await readFile("connector/package-lock.json");
const locked = JSON.parse(lock.toString("utf8"));
const sdkIntegrity = locked.packages?.["node_modules/zca-js"]?.integrity;
if (typeof sdkIntegrity !== "string" || !/^sha512-/.test(sdkIntegrity))
  throw new Error("Connector lock is missing the reviewed zca-js integrity");
const commit = process.env.GITHUB_SHA ?? "a".repeat(40);
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error("CI source commit must be a 40-character lowercase SHA");
const now = Date.now();
const consent = {
  consentRef: "ci-synthetic-consent",
  notAfter: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  expectedAccountId: "ci-account-synthetic",
  allowedPurposes: ["observe"],
  allowedPeerIds: ["ci-peer-synthetic"],
  maxPartsPerDay: 1,
  minIntervalMs: 2000,
};
const grant = {
  version: 1,
  grantId: "ci-synthetic-grant",
  purpose: "observe",
  sourceCommit: commit,
  lockSha256: createHash("sha256").update(lock).digest("hex"),
  sdkIntegrity,
  issuedAt: new Date(now - 60 * 1000).toISOString(),
  expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
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
  JSON.stringify({ version: 1, build: { sourceCommit: commit, lockSha256: grant.lockSha256, sdkIntegrity }, consent, grant }, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ manifest: output, purpose: grant.purpose }));
