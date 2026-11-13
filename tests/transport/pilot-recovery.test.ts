import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePrivateDirectory,
  PrivateSessionFile,
} from "../../server/private-pilot-files.js";
import { bindPilotSession, runPilotLoop } from "../../tools/pilot-runtime.js";
import type { PilotGrant } from "../../server/pilot-policy.js";

const account = "zalo-uid-restore-1";
const session = {
  imei: "synthetic-imei",
  userAgent: "synthetic-user-agent",
  cookie: [
    { key: "synthetic", value: "sentinel", domain: "example.invalid", path: "/" },
  ],
};

function grant(overrides: Partial<PilotGrant> = {}): PilotGrant {
  const now = Date.now();
  return {
    version: 1,
    grantId: "grant-restore-1",
    purpose: "observe",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 7 * 60 * 60 * 1000).toISOString(),
    ownerConsentRef: "owner-consent-restore-1",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: account,
    allowedPeerIds: ["peer-a"],
    maxPartsPerDay: 1,
    minIntervalMs: 2000,
    ...overrides,
  };
}

test("an encrypted session survives a key-and-ciphertext restore drill", async () => {
  const root = await mkdtemp(join(tmpdir(), "zalo-pilot-restore-"));
  try {
    const original = join(root, "original");
    const restored = join(root, "restored");
    await ensurePrivateDirectory(original);
    await ensurePrivateDirectory(restored);
    const key = Buffer.alloc(32, 11);
    const source = new PrivateSessionFile({
      path: join(original, "session.enc"),
      key,
      keyId: "v1",
    });
    await source.write({ version: 1, accountId: account, session });

    await writeFile(join(restored, "session.key"), key, { mode: 0o600 });
    await writeFile(
      join(restored, "session.enc"),
      await readFile(join(original, "session.enc")),
      { mode: 0o600 },
    );
    const loadedKey = await readFile(join(restored, "session.key"));
    const recovered = new PrivateSessionFile({
      path: join(restored, "session.enc"),
      key: loadedKey,
      keyId: "v1",
    });
    assert.equal(
      JSON.stringify(await bindPilotSession(recovered, account).read()),
      JSON.stringify(session),
    );
    await assert.rejects(
      bindPilotSession(recovered, "zalo-uid-other").read(),
    );

    const wrongStore = new PrivateSessionFile({
      path: join(restored, "session.enc"),
      key: Buffer.alloc(32, 12),
      keyId: "v1",
    });
    await assert.rejects(wrongStore.read());
    assert.throws(
      () =>
        new PrivateSessionFile({
          path: join(restored, "session.enc"),
          key: Buffer.alloc(31, 11),
          keyId: "v1",
        }),
      /Private pilot files unavailable/,
    );

    const envelope = JSON.parse(
      await readFile(join(restored, "session.enc"), "utf8"),
    );
    const bytes = Buffer.from(envelope.data, "base64");
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    await writeFile(
      join(restored, "session.enc"),
      JSON.stringify({ ...envelope, data: bytes.toString("base64") }),
      { mode: 0o600 },
    );
    await assert.rejects(recovered.read());

    const truncated = JSON.stringify({ ...envelope, data: "AAAA" });
    await writeFile(join(restored, "session.enc"), truncated, { mode: 0o600 });
    await assert.rejects(recovered.read());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an expired grant never starts the loop or a connector", async () => {
  let started = 0;
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(
    runPilotLoop({
      connector: {
        async start() {
          started++;
        },
        async stop() {},
        async runOnce() {
          return { processed: false };
        },
      },
      mode: "observe",
      grant: grant({
        issuedAt: new Date(Date.now() - 120_000).toISOString(),
        expiresAt: expiredAt,
      }),
      maxTicks: 1,
      tickMs: 0,
    }),
    /Pilot runtime unavailable/,
  );
  assert.equal(started, 0);
});
