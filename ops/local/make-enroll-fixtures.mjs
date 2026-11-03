// Build the private enrollment manifest template and synthetic G5 fixtures.
//
// The build block is taken from the reviewed connector image itself, so the
// template cannot drift from the artifact that preflight and the live command
// will compare against. The template keeps the Owner's consent placeholders: it
// is inert and carries no grant. Every fixture under fixtures/ uses synthetic
// identifiers and timestamps for offline admission tests only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const repo = dirname(dirname(dirname(new URL(import.meta.url).pathname)));
const image = process.env.PILOT_CONNECTOR_IMAGE ?? "zalo-shared-connector:g5-local";
const base = process.env.PILOT_PRIVATE_DIR ?? join(homedir(), "pilot-private", "zalo-shared");
const root = join(base, "g5-enroll");
const fixtures = join(root, "fixtures");

const identity = JSON.parse(
  execFileSync(
    "docker",
    [
      "run", "--rm", "--network", "none", "--entrypoint", "/nodejs/bin/node",
      image,
      "-e",
      'process.stdout.write(require("fs").readFileSync("/app/build-identity.json","utf8"))',
    ],
    { encoding: "utf8" },
  ),
);
const lock = await readFile(join(repo, "connector", "package-lock.json"));
const lockSha256 = createHash("sha256").update(lock).digest("hex");
const sdkIntegrity = JSON.parse(lock.toString("utf8")).packages?.["node_modules/zca-js"]?.integrity;
if (!/^[a-f0-9]{40}$/.test(identity.sourceCommit ?? ""))
  throw new Error("the connector image has no reviewed source commit");
if (identity.lockSha256 !== lockSha256) throw new Error("the image lock does not match connector/package-lock.json");
if (identity.sdkIntegrity !== sdkIntegrity) throw new Error("the image SDK integrity does not match the lock");
const build = Object.freeze({
  sourceCommit: identity.sourceCommit,
  lockSha256: identity.lockSha256,
  sdkIntegrity: identity.sdkIntegrity,
});

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const minute = 60 * 1000;

const consent = (over) => ({
  consentRef: "synthetic-consent-enroll",
  notAfter: iso(now + 120 * minute),
  expectedAccountId: null,
  allowedPurposes: ["enroll-session"],
  allowedPeerIds: [],
  maxPartsPerDay: 10,
  minIntervalMs: 2000,
  ...over,
});
const grant = (over) => ({
  version: 1,
  grantId: "synthetic-enroll-grant",
  purpose: "enroll-session",
  ...build,
  issuedAt: iso(now - 5 * minute),
  expiresAt: iso(now + 30 * minute),
  ownerConsentRef: "synthetic-consent-enroll",
  dedicatedAccountAttested: true,
  unofficialClientRiskAccepted: true,
  expectedAccountId: null,
  allowedPeerIds: [],
  maxPartsPerDay: 10,
  minIntervalMs: 2000,
  ...over,
});
const manifest = (c, g) => ({ version: 1, build, consent: c, grant: g });

const template = {
  version: 1,
  build,
  consent: {
    consentRef: "<OWNER_CONSENT_REF>",
    notAfter: "<YYYY-MM-DDTHH:MM:SS.sssZ>",
    expectedAccountId: null,
    allowedPurposes: ["enroll-session"],
    allowedPeerIds: [],
    maxPartsPerDay: 10,
    minIntervalMs: 2000,
  },
  grant: {
    version: 1,
    grantId: "<OWNER_GRANT_ID>",
    purpose: "enroll-session",
    ...build,
    issuedAt: "<YYYY-MM-DDTHH:MM:SS.sssZ>",
    expiresAt: "<YYYY-MM-DDTHH:MM:SS.sssZ>",
    ownerConsentRef: "<OWNER_CONSENT_REF>",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: null,
    allowedPeerIds: [],
    maxPartsPerDay: 10,
    minIntervalMs: 2000,
  },
};

const cases = {
  "enroll.synthetic.json": manifest(consent({}), grant({})),
  "deny-observe-purpose.json": manifest(
    consent({}),
    grant({ purpose: "observe", expectedAccountId: "synthetic-account-a", allowedPeerIds: ["synthetic-peer-b"] }),
  ),
  "deny-send-purpose.json": manifest(
    consent({}),
    grant({ purpose: "send-test", expectedAccountId: "synthetic-account-a", allowedPeerIds: ["synthetic-peer-b"] }),
  ),
  "deny-enroll-account.json": manifest(consent({}), grant({ expectedAccountId: "synthetic-account-a" })),
  "deny-enroll-peer.json": manifest(consent({}), grant({ allowedPeerIds: ["synthetic-peer-b"] })),
  "deny-expired.json": manifest(
    consent({}),
    grant({ issuedAt: iso(now - 5 * minute), expiresAt: iso(now - minute) }),
  ),
  "deny-future-issued.json": manifest(
    consent({}),
    grant({ issuedAt: iso(now + 10 * minute), expiresAt: iso(now + 40 * minute) }),
  ),
  "deny-lifetime.json": manifest(
    consent({ notAfter: iso(now + 3 * 60 * minute) }),
    grant({ issuedAt: iso(now - minute), expiresAt: iso(now + 61 * minute) }),
  ),
  "deny-build-mismatch.json": (() => {
    const other = {
      sourceCommit: "0".repeat(40),
      lockSha256: "0".repeat(64),
      sdkIntegrity: "sha512-AAAA",
    };
    return {
      version: 1,
      build: other,
      consent: consent({}),
      grant: { ...grant({}), ...other },
    };
  })(),
  "deny-consent-expired.json": manifest(
    consent({ notAfter: iso(now - minute) }),
    grant({ expiresAt: iso(now + 30 * minute) }),
  ),
  "deny-consent-ref.json": manifest(consent({}), grant({ ownerConsentRef: "synthetic-consent-other" })),
  "deny-two-peers.json": manifest(
    consent({
      consentRef: "synthetic-consent-peer",
      expectedAccountId: "synthetic-account-a",
      allowedPurposes: ["observe"],
      allowedPeerIds: ["synthetic-peer-b", "synthetic-peer-c"],
    }),
    grant({
      grantId: "synthetic-observe-grant",
      purpose: "observe",
      ownerConsentRef: "synthetic-consent-peer",
      expectedAccountId: "synthetic-account-a",
      allowedPeerIds: ["synthetic-peer-b", "synthetic-peer-c"],
    }),
  ),
};

await mkdir(fixtures, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
await chmod(fixtures, 0o700);
const write = async (path, value) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
};
await write(join(root, "manifest.enroll.template.json"), template);
for (const [name, value] of Object.entries(cases))
  await write(join(fixtures, name), value);
// The connector runs as UID 65532 and must read a 0600 fixture; ownership
// changes only mode-preserving access, never readability by anyone else.
execFileSync("sudo", ["chown", "65532:65532", ...Object.keys(cases).map((name) => join(fixtures, name))]);

process.stdout.write(
  `${JSON.stringify({
    image,
    build,
    template: join(root, "manifest.enroll.template.json"),
    fixtures: Object.keys(cases).sort(),
  }, null, 1)}\n`,
);
