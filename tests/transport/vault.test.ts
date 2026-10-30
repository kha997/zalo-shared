import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { CredentialVault } from "../../adapters/zalo/vault.js";
test("vault roundtrip encrypted, 0600, overwrite, wrong key and tamper rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zalo-vault-"));
  const path = join(dir, "session");
  const key = randomBytes(32);
  try {
    const vault = new CredentialVault(path, key);
    await vault.write({ cookie: "private-cookie", imei: "private-imei" });
    assert.deepEqual(await vault.read(), {
      cookie: "private-cookie",
      imei: "private-imei",
    });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
      (await readFile(path, "utf8")).includes("private-cookie"),
      false,
    );
    await assert.rejects(new CredentialVault(path, randomBytes(32)).read());
    const bytes = await readFile(path);
    bytes[bytes.length - 2] ^= 1;
    await writeFile(path, bytes);
    await assert.rejects(vault.read());
    await vault.write({ cookie: "replacement" });
    assert.deepEqual(await vault.read(), { cookie: "replacement" });
    assert.throws(() => new CredentialVault(path, Buffer.alloc(16)), /32/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("vault fresh nonce and concurrent replacement leave complete private envelope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zalo-vault-"));
  const path = join(dir, "session");
  const vault = new CredentialVault(path, randomBytes(32));
  try {
    await vault.write({ n: 1 });
    const first = JSON.parse(await readFile(path, "utf8"));
    await vault.write({ n: 1 });
    const second = JSON.parse(await readFile(path, "utf8"));
    assert.notEqual(first.nonce, second.nonce);
    await Promise.all([vault.write({ n: 2 }), vault.write({ n: 3 })]);
    assert.ok([2, 3].includes(((await vault.read()) as { n: number }).n));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
